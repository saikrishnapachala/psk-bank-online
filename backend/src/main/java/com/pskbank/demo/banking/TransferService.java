package com.pskbank.demo.banking;

import com.pskbank.demo.banking.Models.Account;
import com.pskbank.demo.banking.Models.AcctRef;
import com.pskbank.demo.banking.Models.Payee;
import com.pskbank.demo.banking.Models.TransferResult;
import com.pskbank.demo.core.ApiException;
import com.pskbank.demo.core.HttpJson.UpstreamException;
import com.pskbank.demo.core.Json;
import com.pskbank.demo.core.RateLimiter;
import com.pskbank.demo.fiserv.EfxMapper;
import com.pskbank.demo.fiserv.FiservException;
import com.pskbank.demo.fiserv.FiservPaths;

import java.math.BigDecimal;
import java.security.SecureRandom;
import java.time.Duration;
import java.time.LocalDate;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;

/**
 * Money movement on the core (Banking Hub "Add Transfer"): between a customer's own accounts, and to another
 * PSK Bank customer. The rules live here, not in Fiserv: entitlements, limits, velocity, idempotency, audit.
 */
public final class TransferService {
    private final CoreBankingService core;
    private final Entitlements entitlements;
    private final AuditLog audit;
    private final BigDecimal perTransferLimit;
    private final BigDecimal memberLimit;
    private final BigDecimal memberDailyLimit;
    private final RateLimiter velocity;
    private final Map<String, TransferResult> idempotency = new ConcurrentHashMap<>();
    private final Set<String> inFlight = ConcurrentHashMap.newKeySet();
    // ponytail: in-memory per process; production = Postgres rows (idempotency key unique, daily totals per customer).
    private final Map<String, BigDecimal> sentToday = new ConcurrentHashMap<>();
    private static final SecureRandom RANDOM = new SecureRandom();

    public TransferService(CoreBankingService core, Entitlements entitlements, AuditLog audit, BigDecimal perTransferLimit,
                           BigDecimal memberLimit, BigDecimal memberDailyLimit, int transfersPerMinute) {
        this.core = core;
        this.entitlements = entitlements;
        this.audit = audit;
        this.perTransferLimit = perTransferLimit;
        this.memberLimit = memberLimit;
        this.memberDailyLimit = memberDailyLimit;
        this.velocity = new RateLimiter(transfersPerMinute, Duration.ofMinutes(1));
    }

    /** Between two of the customer's own accounts. */
    public TransferResult internal(String userId, String requestId, String idemKey, String fromId, String toId, BigDecimal amount) {
        return once(userId, idemKey, () -> {
            validateAmount(amount, perTransferLimit);
            if (fromId == null || toId == null || fromId.equals(toId)) throw ApiException.badRequest("Choose two different accounts");
            AcctRef from = entitlements.require(userId, fromId);
            AcctRef to = entitlements.require(userId, toId);
            String summary = "$" + amount.toPlainString() + " from " + from.nickname() + " " + from.masked() + " to " + to.nickname() + " " + to.masked();
            return move(userId, requestId, "INTERNAL_TRANSFER", summary, from, to, amount, toId, null);
        });
    }

    /** Other PSK Bank customers this user can send to. Only a name and a masked account cross the boundary. */
    public List<Payee> payees(String userId) {
        return entitlements.users().stream()
                .filter(u -> !u.equals(userId))
                .flatMap(u -> entitlements.receivingAccount(u).stream()
                        .map(acct -> new Payee("payee-" + u, entitlements.name(u), EfxMapper.typeLabel(acct.acctType()) + " " + acct.masked())))
                .toList();
    }

    /** To another PSK Bank customer: the money lands in their receiving account on the same core. */
    public TransferResult toMember(String userId, String requestId, String idemKey, String fromId, String payeeId, BigDecimal amount) {
        return once(userId, idemKey, () -> {
            validateAmount(amount, memberLimit);
            AcctRef from = entitlements.require(userId, fromId);
            String recipient = payeeId != null && payeeId.startsWith("payee-") ? payeeId.substring(6) : "";
            if (recipient.equals(userId)) throw ApiException.badRequest("To move money between your own accounts, use Between your accounts");
            if (!entitlements.users().contains(recipient)) throw ApiException.badRequest("Choose a recipient from your list");
            AcctRef to = entitlements.receivingAccount(recipient)
                    .orElseThrow(() -> ApiException.badRequest(entitlements.name(recipient) + " can't receive transfers right now"));

            String dayKey = userId + "|" + LocalDate.now();
            reserveDaily(dayKey, amount);
            String summary = "$" + amount.toPlainString() + " to " + entitlements.name(recipient) + " from " + from.nickname() + " " + from.masked();
            try {
                TransferResult r = move(userId, requestId, "MEMBER_TRANSFER", summary, from, to, amount, payeeId, recipient);
                audit.record(recipient, requestId, "MEMBER_RECEIVED",
                        "$" + amount.toPlainString() + " from " + entitlements.name(userId) + " to " + to.nickname() + " " + to.masked(),
                        "COMPLETED", r.confirmation());
                return r;
            } catch (ApiException e) {
                if (e.status() != 503) sentToday.merge(dayKey, amount.negate(), BigDecimal::add); // not sent: give the allowance back
                throw e; // 503 = outcome unknown: keep the reservation so a blind retry can't exceed the daily limit
            }
        });
    }

    private synchronized void reserveDaily(String dayKey, BigDecimal amount) {
        BigDecimal used = sentToday.getOrDefault(dayKey, BigDecimal.ZERO);
        if (used.add(amount).compareTo(memberDailyLimit) > 0) {
            throw new ApiException(422, "DAILY_LIMIT", "That would pass your $" + memberDailyLimit.toPlainString()
                    + " daily limit for sending to other customers. $" + memberDailyLimit.subtract(used).max(BigDecimal.ZERO).toPlainString() + " left today.");
        }
        sentToday.put(dayKey, used.add(amount));
    }

    /** Idempotency + in-flight de-duplication + per-customer velocity, shared by every kind of transfer. */
    private TransferResult once(String userId, String idemKey, java.util.function.Supplier<TransferResult> work) {
        if (idemKey == null || idemKey.isBlank()) throw ApiException.badRequest("Idempotency-Key header is required");
        String scopedKey = userId + "|" + idemKey;
        TransferResult prior = idempotency.get(scopedKey);
        if (prior != null) return withReplay(prior);
        if (!inFlight.add(scopedKey)) throw new ApiException(409, "IN_PROGRESS", "This transfer is already being processed");
        try {
            if (!velocity.tryAcquire(userId)) {
                throw new ApiException(429, "TOO_MANY_TRANSFERS", "You've made a lot of transfers in the last minute. Wait a moment and try again.");
            }
            TransferResult r = work.get();
            idempotency.put(scopedKey, r);
            return r;
        } finally {
            inFlight.remove(scopedKey);
        }
    }

    private TransferResult move(String userId, String requestId, String type, String summary,
                                AcctRef from, AcctRef to, BigDecimal amount, String toLabel, String recipient) {
        if (!EfxMapper.canTransferFrom(from.acctType())) throw ApiException.badRequest(EfxMapper.typeLabel(from.acctType()) + " accounts can't be a transfer source");
        if (!EfxMapper.canTransferTo(to.acctType())) throw ApiException.badRequest(EfxMapper.typeLabel(to.acctType()) + " accounts can't receive transfers");
        if (core.breaker().isOpen()) throw ApiException.unavailable("Transfers are paused while core banking is unavailable");
        try {
            // Pre-check gives a friendly message; the core re-checks atomically.
            core.invalidateReads(); // funds check must see the core's current balance
            Account src = core.account(userId, from.id());
            if (src.error() != null || !src.canTransferFrom()) throw ApiException.badRequest(from.nickname() + " can't send money right now");
            if (src.available() != null && src.available().compareTo(amount) < 0) {
                throw new ApiException(422, "INSUFFICIENT_FUNDS", "Available balance is $" + src.available().toPlainString());
            }
            // Money movement is NOT retried automatically: a timeout here is "unknown", not "failed".
            Map<String, Object> reply = core.call(FiservPaths.ADD_TRANSFER, recipient == null
                    ? EfxMapper.addTransfer(from, to, amount)
                    : EfxMapper.addTransfer(from, to, amount, "To " + entitlements.name(recipient), "From " + entitlements.name(userId)));
            String coreStatus = Json.str(reply, "XferStatusRec.XferStatus.XferStatusCode");
            String effDt = Json.str(reply, "XferStatusRec.XferStatus.EffDt");
            TransferResult result = new TransferResult(confirmation(recipient == null ? "TRF" : "P2P"), "COMPLETED", from.id(), toLabel, amount,
                    effDt != null ? effDt : LocalDate.now().toString(), false, coreStatus);
            core.invalidateReads();
            audit.record(userId, requestId, type, summary, "COMPLETED", result.confirmation());
            return result;
        } catch (FiservException e) {
            audit.record(userId, requestId, type, summary, "REJECTED: " + e.efxDesc(), null);
            throw new ApiException(422, "CORE_REJECTED", e.efxDesc() + " (EFX " + e.efxCode() + ")");
        } catch (UpstreamException e) {
            audit.record(userId, requestId, type, summary, "UNKNOWN: " + e.getMessage(), null);
            throw ApiException.unavailable("We couldn't confirm this transfer. Check your activity before retrying.");
        } catch (ApiException e) {
            audit.record(userId, requestId, type, summary, "REJECTED: " + e.getMessage(), null);
            throw e;
        }
    }

    static void validateAmount(BigDecimal amount, BigDecimal limit) {
        if (amount == null || amount.signum() <= 0) throw ApiException.badRequest("Enter an amount greater than $0");
        if (amount.scale() > 2) throw ApiException.badRequest("Amounts can have at most 2 decimal places");
        if (amount.compareTo(limit) > 0) throw ApiException.badRequest("Online limit is $" + limit.toPlainString() + " per transfer");
    }

    /** Time-ordered and unique under load: millis in base 36 plus 4 random characters. */
    static String confirmation(String prefix) {
        String rnd = Integer.toString(RANDOM.nextInt(36 * 36 * 36 * 36), 36);
        return prefix + "-" + Long.toString(System.currentTimeMillis(), 36).toUpperCase() + "-" + ("0000" + rnd).substring(rnd.length()).toUpperCase();
    }

    private static TransferResult withReplay(TransferResult r) {
        return new TransferResult(r.confirmation(), r.status(), r.fromId(), r.toId(), r.amount(), r.effectiveDate(), true, r.coreStatusCode());
    }
}
