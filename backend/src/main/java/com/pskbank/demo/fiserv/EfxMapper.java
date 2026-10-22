package com.pskbank.demo.fiserv;

import com.pskbank.demo.banking.Models.Account;
import com.pskbank.demo.banking.Models.AcctRef;
import com.pskbank.demo.banking.Models.Fact;
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

    /**
     * One-time, immediate transfer. Premier rejects a bare XferInfo ("Next Transfer Date Required") because it
     * treats it as a recurring transfer; ExpediteInd + per-leg TrnCode makes it post now (Fiserv "TMS" sample).
     */
    public static Map<String, Object> addTransfer(AcctRef from, AcctRef to, BigDecimal amount) {
        return addTransfer(from, to, amount, "To " + to.nickname(), "From " + from.nickname());
    }

    /** fromDesc / toDesc are what each side sees in its Fiserv transaction history (kept under 32 chars). */
    public static Map<String, Object> addTransfer(AcctRef from, AcctRef to, BigDecimal amount, String fromDesc, String toDesc) {
        return obj("OvrdAutoAckInd", false, "XferInfo", obj(
                "CurAmt", obj("Amt", amount),
                "ExpediteInd", true,
                "FromAcctRef", leg(from, DEBIT_CODES),
                "ToAcctRef", leg(to, CREDIT_CODES),
                "XferFromDesc", List.of(clip(fromDesc)),
                "XferToDesc", List.of(clip(toDesc))));
    }

    private static String clip(String s) {
        return s.length() <= 32 ? s : s.substring(0, 32);
    }

    // Premier transaction codes from Fiserv's Banking Hub Postman samples (DDA 47/20, SDA 120 credit; 147 SDA
    // debit verified against the sandbox). LOAN has no published code, so a loan leg is sent without one.
    private static final Map<String, String> DEBIT_CODES = Map.of("DDA", "47", "SDA", "147");
    private static final Map<String, String> CREDIT_CODES = Map.of("DDA", "20", "SDA", "120");

    private static Map<String, Object> leg(AcctRef ref, Map<String, String> codes) {
        String code = codes.get(ref.acctType());
        return code == null ? obj("AcctKeys", keys(ref)) : obj("AcctKeys", keys(ref), "TrnCode", code);
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
        String dtlStatus = Json.str(info, "AcctDtlStatus"); // Premier denies postings to Dormant/Closed (EFX 2365)
        boolean usable = dtlStatus == null || dtlStatus.equals("Active");
        return new Account(
                ref.id(), ref.acctType(), typeLabel(ref.acctType()), nickname,
                firstNonBlank(Json.str(info, "Desc"), Json.str(info, "ProductIdent")),
                ref.masked(), available, current, Json.num(info, "Rate"),
                Json.str(info, "OpenDt"), Json.str(info, "MaturityDt"),
                firstNonBlank(Json.str(info, "AcctDtlStatus"), Json.str(reply, "AcctRec.AcctStatus.AcctStatusCode")),
                usable && canTransferFrom(ref.acctType()), usable && canTransferTo(ref.acctType()), null,
                details(ref.acctType(), info), balances(info));
    }

    // Balance types worth naming for a customer; everything else still shows in the full balances list.
    private static final Map<String, String> BAL_LABELS = Map.ofEntries(
            Map.entry("Avail", "Available"), Map.entry("Ledger", "Ledger"), Map.entry("PrevLedger", "Ledger, prior day"), Map.entry("Current", "Current"),
            Map.entry("InterestAccrued", "Interest accrued (unpaid)"), Map.entry("PrevInterestAccrued", "Interest accrued, prior cycle"),
            Map.entry("Redemption", "Redemption value today"), Map.entry("Principal", "Principal"),
            Map.entry("Orig", "Original amount"), Map.entry("PastDue", "Past due"), Map.entry("LateFee", "Late fees"),
            Map.entry("Escrow", "Escrow"), Map.entry("LoanExposure", "Total exposure"), Map.entry("Hold", "Holds"),
            Map.entry("BalanceLastStatement", "Last statement balance"), Map.entry("CreditLimit", "Credit limit"));

    private static final BigDecimal SENTINEL = new BigDecimal("99999999999.99"); // Premier's "not set" filler

    static List<Fact> balances(Object info) {
        List<Fact> out = new ArrayList<>();
        for (Object b : Json.list(info, "AcctBal")) {
            String type = String.valueOf(Json.str(b, "BalType"));
            BigDecimal amt = Json.num(b, "CurAmt.Amt");
            if (amt == null || amt.signum() == 0 || amt.compareTo(SENTINEL) == 0) continue;
            out.add(new Fact(BAL_LABELS.getOrDefault(type, type), amt.toPlainString(), "money"));
        }
        return out;
    }

    static List<Fact> details(String acctType, Object info) {
        List<Fact> f = new ArrayList<>();
        add(f, "Product", Json.str(info, "Desc"), "text");
        add(f, "Account status", Json.str(info, "AcctDtlStatus"), "text");
        add(f, "Opened", Json.str(info, "OpenDt"), "date");
        add(f, acctType.equals("LOAN") ? "APR" : "Interest rate", Json.str(info, "Rate"), "rate");
        BigDecimal eff = Json.num(info, "EffectiveRate"), nominal = Json.num(info, "Rate");
        if (eff != null && (nominal == null || eff.compareTo(nominal) != 0)) add(f, "Effective rate", eff.toPlainString(), "rate");
        if (Json.at(info, "Term.Count") != null)
            add(f, "Term", Json.str(info, "Term.Count") + " " + Json.str(info, "Term.TermUnits").toLowerCase(), "text");
        if (Json.at(info, "TermToMaturity.Count") != null)
            add(f, "Time to maturity", Json.str(info, "TermToMaturity.Count") + " " + Json.str(info, "TermToMaturity.TermUnits").toLowerCase(), "text");
        add(f, acctType.equals("LOAN") ? "Final payment due" : "Maturity date", Json.str(info, "MaturityDt"), "date");
        BigDecimal initial = Json.num(info, "InitialAmount.Amt");
        if (initial != null && initial.signum() != 0)
            add(f, acctType.equals("LOAN") ? "Original loan amount" : "Opening deposit", initial.toPlainString(), "money");
        add(f, "Interest method", Json.str(info, "IntRateData.AccrualMethod"), "text");
        for (Object d : Json.list(info, "DateData")) {
            String t = String.valueOf(Json.str(d, "DateType"));
            if (t.equals("LastTrn")) add(f, "Last activity", Json.str(d, "DateValue"), "date");
            if (t.equals("Contract")) add(f, "Contract date", Json.str(d, "DateValue"), "date");
        }
        add(f, "Last statement", Json.str(info, "AcctStmtData.LastStmtDt"), "date");
        String fdic = Json.str(info, "FederalInsuranceEligibility");
        if ("Eligible".equals(fdic)) add(f, "FDIC insurance", "Eligible", "text");
        String tax = Json.str(info, "TaxIncentiveType");
        if (tax != null && !tax.equals("None")) add(f, "Tax status", tax, "text");
        return f;
    }

    private static void add(List<Fact> f, String label, String value, String kind) {
        if (value != null && !value.isBlank()) f.add(new Fact(label, value.trim(), kind));
    }

    public static Account unavailable(AcctRef ref, String reason) {
        return new Account(ref.id(), ref.acctType(), typeLabel(ref.acctType()), ref.nickname(), null, ref.masked(),
                null, null, null, null, null, null, false, false, reason, List.of(), List.of());
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
            return parts.isEmpty() ? "Transaction" : String.join(" ", parts.stream().distinct().toList()); // Premier repeats lines
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
