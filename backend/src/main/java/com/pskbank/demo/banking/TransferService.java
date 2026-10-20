package com.pskbank.demo.banking;

import com.pskbank.demo.banking.Models.Account;
import com.pskbank.demo.banking.Models.AcctRef;
import com.pskbank.demo.banking.Models.TransferResult;
import com.pskbank.demo.core.ApiException;
import com.pskbank.demo.core.HttpJson.UpstreamException;
import com.pskbank.demo.core.Json;
import com.pskbank.demo.fiserv.EfxMapper;
import com.pskbank.demo.fiserv.FiservException;
import com.pskbank.demo.fiserv.FiservPaths;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;

/**
 * Internal transfers between a customer's own accounts on the core (Banking Hub "Add Transfer").
 * The rules live here, not in Fiserv: entitlements, limits, account-type rules, idempotency, audit.
 */
public final class TransferService {
    private final CoreBankingService core;
    private final Entitlements entitlements;
    private final AuditLog audit;
    private final BigDecimal perTransferLimit;
    private final Map<String, TransferResult> idempotency = new ConcurrentHashMap<>();
    private final Set<String> inFlight = ConcurrentHashMap.newKeySet();

    public TransferService(CoreBankingService core, Entitlements entitlements, AuditLog audit, BigDecimal perTransferLimit) {
        this.core = core;
        this.entitlements = entitlements;
        this.audit = audit;
        this.perTransferLimit = perTransferLimit;
    }

    public TransferResult internal(String userId, String requestId, String idemKey,
                                   String fromId, String toId, BigDecimal amount) {
        if (idemKey == null || idemKey.isBlank()) throw ApiException.badRequest("Idempotency-Key header is required");
        String scopedKey = userId + "|" + idemKey;
        TransferResult prior = idempotency.get(scopedKey);
        if (prior != null) return withReplay(prior);
        if (!inFlight.add(scopedKey)) throw new ApiException(409, "IN_PROGRESS", "This transfer is already being processed");
        try {
            return doInternal(userId, requestId, scopedKey, fromId, toId, amount);
        } finally {
            inFlight.remove(scopedKey);
        }
    }

    private TransferResult doInternal(String userId, String requestId, String scopedKey,
                                      String fromId, String toId, BigDecimal amount) {
        validateAmount(amount, perTransferLimit);
        if (fromId == null || toId == null || fromId.equals(toId)) throw ApiException.badRequest("Choose two different accounts");
        AcctRef from = entitlements.require(userId, fromId);
        AcctRef to = entitlements.require(userId, toId);
        if (!EfxMapper.canTransferFrom(from.acctType())) throw ApiException.badRequest(EfxMapper.typeLabel(from.acctType()) + " accounts can't be a transfer source");
        if (!EfxMapper.canTransferTo(to.acctType())) throw ApiException.badRequest(EfxMapper.typeLabel(to.acctType()) + " accounts can't receive transfers");
        if (core.breaker().isOpen()) throw ApiException.unavailable("Transfers are paused while core banking is unavailable");

        String summary = "$" + amount.toPlainString() + " from " + from.nickname() + " " + from.masked() + " to " + to.nickname() + " " + to.masked();
        try {
            // Pre-check gives a friendly message; the core re-checks atomically.
            core.invalidateReads(); // funds check must see the core's current balance
            Account src = core.account(userId, fromId);
            if (src.available() != null && src.available().compareTo(amount) < 0) {
                throw new ApiException(422, "INSUFFICIENT_FUNDS", "Available balance is $" + src.available().toPlainString());
            }
            // Money movement is NOT retried automatically: a timeout here is "unknown", not "failed".
            Map<String, Object> reply = core.call(FiservPaths.ADD_TRANSFER, EfxMapper.addTransfer(from, to, amount));
            String coreStatus = Json.str(reply, "XferStatusRec.XferStatus.XferStatusCode");
            String effDt = Json.str(reply, "XferStatusRec.XferStatus.EffDt");
            TransferResult result = new TransferResult(confirmation("TRF"), "COMPLETED", fromId, toId, amount,
                    effDt != null ? effDt : LocalDate.now().toString(), false, coreStatus);
            core.invalidateReads();
            idempotency.put(scopedKey, result);
            audit.record(userId, requestId, "INTERNAL_TRANSFER", summary, "COMPLETED", result.confirmation());
            return result;
        } catch (FiservException e) {
            audit.record(userId, requestId, "INTERNAL_TRANSFER", summary, "REJECTED: " + e.efxDesc(), null);
            throw new ApiException(422, "CORE_REJECTED", e.efxDesc() + " (EFX " + e.efxCode() + ")");
        } catch (UpstreamException e) {
            audit.record(userId, requestId, "INTERNAL_TRANSFER", summary, "UNKNOWN: " + e.getMessage(), null);
            throw ApiException.unavailable("We couldn't confirm this transfer. Check your activity before retrying.");
        } catch (ApiException e) {
            audit.record(userId, requestId, "INTERNAL_TRANSFER", summary, "REJECTED: " + e.getMessage(), null);
            throw e;
        }
    }

    static void validateAmount(BigDecimal amount, BigDecimal limit) {
        if (amount == null || amount.signum() <= 0) throw ApiException.badRequest("Enter an amount greater than $0");
        if (amount.scale() > 2) throw ApiException.badRequest("Amounts can have at most 2 decimal places");
        if (amount.compareTo(limit) > 0) throw ApiException.badRequest("Online limit is $" + limit.toPlainString() + " per transfer");
    }

    static String confirmation(String prefix) {
        return prefix + "-" + Long.toString(System.currentTimeMillis(), 36).toUpperCase();
    }

    private static TransferResult withReplay(TransferResult r) {
        return new TransferResult(r.confirmation(), r.status(), r.fromId(), r.toId(), r.amount(), r.effectiveDate(), true, r.coreStatusCode());
    }
}
