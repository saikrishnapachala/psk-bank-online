package com.pskbank.demo.fiserv;

import com.pskbank.demo.banking.Models.Account;
import com.pskbank.demo.banking.Models.AcctRef;
import com.pskbank.demo.banking.Models.Txn;
import com.pskbank.demo.core.Json;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;

import static com.pskbank.demo.core.Json.obj;

/**
 * Anti-corruption layer: EFX request builders and EFX -> clean domain mapping.
 * Tolerant by design: field presence differs by core (Premier, DNA, Signature...) and account type.
 */
public final class EfxMapper {
    private EfxMapper() {}

    // ---------- requests ----------
    public static Map<String, Object> accountInquiry(AcctRef ref) {
        return obj("AcctSel", obj("AcctKeys", keys(ref)));
    }

    public static Map<String, Object> historyInquiry(AcctRef ref, LocalDate from, LocalDate to, int maxRecords) {
        return obj(
                "RecCtrlIn", obj("MaxRecLimit", maxRecords),
                "AcctTrnSel", obj(
                        "AcctKeys", keys(ref),
                        "DtRange", List.of(obj("StartDt", from.toString(), "EndDt", to.toString()))));
    }

    public static Map<String, Object> addTransfer(AcctRef from, AcctRef to, BigDecimal amount) {
        return obj("XferInfo", obj(
                "FromAcctRef", obj("AcctKeys", keys(from)),
                "ToAcctRef", obj("AcctKeys", keys(to)),
                "CurAmt", obj("Amt", amount)));
    }

    private static Map<String, Object> keys(AcctRef ref) {
        return obj("AcctId", ref.acctId(), "AcctType", ref.acctType());
    }

    // ---------- responses ----------
    @SuppressWarnings("unchecked")
    public static Account toAccount(AcctRef ref, Map<String, Object> reply) {
        Map<String, Object> rec = (Map<String, Object>) Json.at(reply, "AcctRec");
        Object info = null;
        if (rec != null) {
            for (Map.Entry<String, Object> e : rec.entrySet()) { // DepositAcctInfo, LoanAcctInfo, ...
                if (e.getKey().endsWith("AcctInfo")) { info = e.getValue(); break; }
            }
        }
        BigDecimal available = null, current = null, first = null;
        for (Object b : Json.list(info, "AcctBal")) {
            String type = String.valueOf(Json.str(b, "BalType"));
            BigDecimal amt = Json.num(b, "CurAmt.Amt");
            if (amt == null) continue;
            if (first == null) first = amt;
            if (type.equalsIgnoreCase("Avail") && available == null) available = amt;
            else if (current == null && (type.equalsIgnoreCase("Ledger") || type.equalsIgnoreCase("Current")
                    || type.toLowerCase().startsWith("princ") || type.toLowerCase().startsWith("outstanding"))) current = amt;
        }
        if (current == null) current = first;
        String nickname = firstNonBlank(Json.str(info, "Nickname"), ref.nickname());
        return new Account(
                ref.id(), ref.acctType(), typeLabel(ref.acctType()), nickname,
                firstNonBlank(Json.str(info, "ProductIdent"), Json.str(info, "Desc")),
                ref.masked(), available, current, Json.num(info, "Rate"),
                Json.str(info, "OpenDt"), Json.str(info, "MaturityDt"),
                Json.str(reply, "AcctRec.AcctStatus.AcctStatusCode"),
                canTransferFrom(ref.acctType()), canTransferTo(ref.acctType()), null);
    }

    public static Account unavailable(AcctRef ref, String reason) {
        return new Account(ref.id(), ref.acctType(), typeLabel(ref.acctType()), ref.nickname(), null, ref.masked(),
                null, null, null, null, null, null, false, false, reason);
    }

    public static List<Txn> toTxns(Map<String, Object> reply) {
        List<Txn> out = new ArrayList<>();
        int i = 0;
        for (Object r : Json.list(reply, "AcctTrnRec")) {
            Object info = Json.at(r, "AcctTrnInfo");
            BigDecimal amt = Json.num(info, "TrnAmt.Amt");
            if (amt == null) continue;
            String drCr = String.valueOf(Json.str(info, "DrCrType"));
            boolean debit = drCr.equalsIgnoreCase("Debit") || drCr.equalsIgnoreCase("Dr");
            List<Object> running = Json.list(info, "StmtRunningBal");
            out.add(new Txn(
                    firstNonBlank(Json.str(r, "AcctTrnKeys.AcctTrnIdent"), "t" + (i++)),
                    firstNonBlank(Json.str(info, "PostedDt"), Json.str(info, "EffDt"), Json.str(info, "TrnDt")),
                    description(Json.at(info, "Desc")),
                    debit ? amt.abs().negate() : amt.abs(),
                    debit ? "debit" : "credit",
                    running.isEmpty() ? null : Json.num(running.get(0), "Amt"),
                    Boolean.TRUE.equals(Json.at(info, "MemoPostInd"))));
        }
        return out;
    }

    @SuppressWarnings("unchecked")
    private static String description(Object desc) {
        if (desc == null) return "Transaction";
        if (desc instanceof List<?> l) {
            List<String> parts = new ArrayList<>();
            for (Object o : l) {
                if (o instanceof String s && !s.isBlank()) parts.add(s.trim());
                else if (o instanceof Map<?, ?> m && !m.isEmpty()) parts.add(String.valueOf(((Map<String, Object>) m).values().iterator().next()));
            }
            return parts.isEmpty() ? "Transaction" : String.join(" ", parts);
        }
        return String.valueOf(desc);
    }

    public static String typeLabel(String t) {
        return switch (t) {
            case "SDA" -> "Savings";
            case "DDA" -> "Checking";
            case "CDA" -> "Certificate of Deposit";
            case "LOAN" -> "Loan";
            default -> t;
        };
    }

    public static boolean canTransferFrom(String t) { return t.equals("SDA") || t.equals("DDA"); }

    public static boolean canTransferTo(String t) { return t.equals("SDA") || t.equals("DDA") || t.equals("LOAN"); }

    private static String firstNonBlank(String... v) {
        for (String s : v) if (s != null && !s.isBlank()) return s;
        return null;
    }
}
