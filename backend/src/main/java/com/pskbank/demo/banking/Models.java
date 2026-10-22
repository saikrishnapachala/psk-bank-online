package com.pskbank.demo.banking;

import java.math.BigDecimal;
import java.util.List;

/** API shapes returned to the BFF. Opaque ids only: raw core account numbers never leave the Java tier. */
public final class Models {
    private Models() {}

    /** Server-side link between an opaque id the browser sees and the real core account keys. */
    public record AcctRef(String id, String acctType, String acctId, String nickname) {
        public String masked() { return "••" + acctId.substring(Math.max(0, acctId.length() - 4)); }
    }

    public record Account(String id, String type, String typeLabel, String nickname, String product,
                          String maskedNumber, BigDecimal available, BigDecimal current, BigDecimal rate,
                          String openDate, String maturityDate, String status,
                          boolean canTransferFrom, boolean canTransferTo, String error,
                          List<Fact> details, List<Fact> balances) {}

    /** One labelled value straight from the core record. kind = text | money | date | rate. */
    public record Fact(String label, String value, String kind) {}

    public record AccountsView(List<Account> accounts, boolean stale, String asOf, String source, String notice) {}

    public record Txn(String id, String date, String description, BigDecimal amount, String direction,
                      BigDecimal runningBalance, boolean pending) {}

    public record TransferResult(String confirmation, String status, String fromId, String toId, BigDecimal amount,
                                 String effectiveDate, boolean replayed, String coreStatusCode) {}

    /** Another PSK Bank customer the user can send to. The real account number never leaves Java. */
    public record Payee(String id, String name, String account) {}

    public record ExternalAccount(String id, String itemId, String institution, String name, String mask,
                                  String subtype, BigDecimal available, BigDecimal current) {}

    public record LinkedItem(String itemId, String institution, int accountCount) {}

    public record FundingResult(String confirmation, String status, String fromExternal, String toId,
                                BigDecimal amount, String expectedSettlement, String routingMasked,
                                String accountMasked, boolean replayed, String note) {}

    public record AuditEvent(String ts, String type, String summary, String status, String ref) {}
}
