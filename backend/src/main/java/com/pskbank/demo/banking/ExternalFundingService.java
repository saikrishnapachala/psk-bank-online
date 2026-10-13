package com.pskbank.demo.banking;

import com.pskbank.demo.banking.Models.AcctRef;
import com.pskbank.demo.banking.Models.ExternalAccount;
import com.pskbank.demo.banking.Models.FundingResult;
import com.pskbank.demo.core.ApiException;
import com.pskbank.demo.plaid.PlaidException;
import com.pskbank.demo.plaid.PlaidService;

import java.math.BigDecimal;
import java.time.DayOfWeek;
import java.time.LocalDate;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;

/**
 * "Move money in from my other bank": Plaid verifies the external account (balance + ACH numbers),
 * then an ACH debit is originated. Banking Hub's Premier API set has no ACH origination endpoint, so the
 * ACH leg here is SIMULATED and labelled as such. In production it goes to your ACH originator (Fiserv or
 * another provider) and lands on the core as a credit when it settles.
 */
public final class ExternalFundingService {
    private final PlaidService plaid;
    private final Entitlements entitlements;
    private final AuditLog audit;
    private final BigDecimal limit;
    private final Map<String, FundingResult> idempotency = new ConcurrentHashMap<>();
    private final Set<String> inFlight = ConcurrentHashMap.newKeySet();

    public ExternalFundingService(PlaidService plaid, Entitlements entitlements, AuditLog audit, BigDecimal limit) {
        this.plaid = plaid;
        this.entitlements = entitlements;
        this.audit = audit;
        this.limit = limit;
    }

    public FundingResult fund(String userId, String requestId, String idemKey, String extId, String toId, BigDecimal amount) {
        if (idemKey == null || idemKey.isBlank()) throw ApiException.badRequest("Idempotency-Key header is required");
        String key = userId + "|" + idemKey;
        FundingResult prior = idempotency.get(key);
        if (prior != null) return replay(prior);
        if (!inFlight.add(key)) throw new ApiException(409, "IN_PROGRESS", "This transfer is already being processed");
        try {
            TransferService.validateAmount(amount, limit);
            AcctRef to = entitlements.require(userId, toId);
            if (!(to.acctType().equals("SDA") || to.acctType().equals("DDA"))) {
                throw ApiException.badRequest("External deposits can go to savings or checking only");
            }
            String into = " into " + to.nickname() + " " + to.masked();
            String summary = "$" + amount.toPlainString() + " from a linked account" + into;
            try {
                ExternalAccount ext = plaid.account(userId, extId); // fresh balance from Plaid
                summary = "$" + amount.toPlainString() + " from " + ext.institution() + " " + ext.name() + " ••" + ext.mask() + into;
                BigDecimal spendable = ext.available() != null ? ext.available() : ext.current();
                if (spendable != null && spendable.compareTo(amount) < 0) {
                    throw new ApiException(422, "INSUFFICIENT_EXTERNAL_FUNDS",
                            "Your " + ext.institution() + " account shows $" + spendable.toPlainString() + " available");
                }
                String[] ach = plaid.achNumbers(userId, extId); // proves ACH capability; numbers stay server-side
                FundingResult result = new FundingResult(TransferService.confirmation("ACH"), "PENDING_ACH_SIMULATED",
                        ext.institution() + " " + ext.name() + " ••" + ext.mask(), toId, amount,
                        addBusinessDays(LocalDate.now(), 2).toString(), "•••••" + tail(ach[0], 4), "••" + tail(ach[1], 4), false,
                        "Simulated ACH: Banking Hub's Premier API set has no ACH origination endpoint. "
                                + "Production routes this to your ACH originator; the core is credited on settlement.");
                idempotency.put(key, result);
                audit.record(userId, requestId, "EXTERNAL_FUNDING", summary, result.status(), result.confirmation());
                return result;
            } catch (PlaidException e) {
                audit.record(userId, requestId, "EXTERNAL_FUNDING", summary, "REJECTED: " + e.errorCode(), null);
                throw new ApiException(422, "PLAID_" + e.errorCode(), e.safeMessage());
            } catch (ApiException e) {
                audit.record(userId, requestId, "EXTERNAL_FUNDING", summary, "REJECTED: " + e.getMessage(), null);
                throw e;
            }
        } finally {
            inFlight.remove(key);
        }
    }

    private static LocalDate addBusinessDays(LocalDate d, int days) {
        LocalDate r = d;
        int added = 0;
        while (added < days) {
            r = r.plusDays(1);
            if (r.getDayOfWeek() != DayOfWeek.SATURDAY && r.getDayOfWeek() != DayOfWeek.SUNDAY) added++;
        }
        return r;
    }

    private static String tail(String s, int n) {
        return s == null ? "????" : s.substring(Math.max(0, s.length() - n));
    }

    private static FundingResult replay(FundingResult r) {
        return new FundingResult(r.confirmation(), r.status(), r.fromExternal(), r.toId(), r.amount(), r.expectedSettlement(),
                r.routingMasked(), r.accountMasked(), true, r.note());
    }
}
