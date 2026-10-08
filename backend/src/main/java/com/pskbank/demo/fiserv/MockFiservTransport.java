package com.pskbank.demo.fiserv;

import com.pskbank.demo.core.HttpJson.UpstreamException;
import com.pskbank.demo.core.Json;

import java.math.BigDecimal;
import java.math.RoundingMode;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Random;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicLong;

import static com.pskbank.demo.core.Json.obj;

/**
 * An in-memory stand-in for a Premier core behind Banking Hub. It answers the same three paths with
 * EFX-shaped JSON (Status envelope, AcctRec, AcctTrnRec, XferStatusRec), so the mapping code is exercised
 * exactly as it would be against the real sandbox. State changes (transfers) persist for the process lifetime.
 */
public final class MockFiservTransport implements FiservTransport {

    private static final class Acct {
        final String id, type, product, desc;
        BigDecimal avail, ledger;
        final BigDecimal rate;
        final LocalDate openDt, maturityDt;
        final List<Map<String, Object>> trns = new ArrayList<>();

        Acct(String id, String type, String product, String desc, String bal, String hold, String rate,
             LocalDate openDt, LocalDate maturityDt) {
            this.id = id; this.type = type; this.product = product; this.desc = desc;
            this.ledger = new BigDecimal(bal);
            this.avail = ledger.subtract(new BigDecimal(hold));
            this.rate = rate == null ? null : new BigDecimal(rate);
            this.openDt = openDt; this.maturityDt = maturityDt;
        }
    }

    private final Map<String, Acct> accounts = new LinkedHashMap<>();
    private final AtomicBoolean outage = new AtomicBoolean(false);
    private final AtomicLong seq = new AtomicLong(90_000);

    public MockFiservTransport() {
        LocalDate today = LocalDate.now();
        add(new Acct("4100012345", "SDA", "SAV", "Personal Savings", "18520.55", "100.00", "3.75",
                today.minusYears(3), null));
        add(new Acct("4100067890", "SDA", "MMA", "Personal Money Market", "52300.00", "0", "4.05",
                today.minusYears(1), null));
        add(new Acct("6200045678", "CDA", "CD12", "Certificate of Deposit", "25000.00", "0", "4.60",
                today.minusMonths(7), today.minusMonths(7).plusMonths(12)));
        add(new Acct("7300098765", "LOAN", "MTG30", "Residential Mortgage", "312480.19", "0", "6.125",
                today.minusYears(2), today.minusYears(2).plusYears(30)));
        seedHistory(today);
    }

    private void add(Acct a) { accounts.put(key(a.type, a.id), a); }

    private static String key(String type, String id) { return type + ":" + id; }

    /** Demo helper: flip on to watch the app fall back to cached balances and block transfers. */
    public void setOutage(boolean on) { outage.set(on); }
    public boolean outage() { return outage.get(); }

    @Override public String mode() { return "mock"; }

    @Override public long tokenCheck() { return 899; }

    @Override
    public synchronized Map<String, Object> post(String path, Map<String, Object> body) {
        if (outage.get()) throw new UpstreamException("Simulated Banking Hub outage (mock mode)");
        sleepQuietly(60);
        return switch (path) {
            case FiservPaths.ACCOUNT_INQUIRY -> inquiry(body);
            case FiservPaths.TRANSACTION_HISTORY -> history(body);
            case FiservPaths.ADD_TRANSFER -> transfer(body);
            default -> error("100", "Mock core does not implement " + path);
        };
    }

    // ---- Get Account Details ----
    private Map<String, Object> inquiry(Map<String, Object> body) {
        Acct a = find(Json.str(body, "AcctSel.AcctKeys.AcctType"), Json.str(body, "AcctSel.AcctKeys.AcctId"));
        if (a == null) return error("1120", "Account not found");
        List<Object> bals = new ArrayList<>();
        if (a.type.equals("LOAN")) {
            bals.add(bal("Principal", a.ledger));
        } else {
            bals.add(bal("Avail", a.avail));
            bals.add(bal("Ledger", a.ledger));
        }
        Map<String, Object> info = obj(
                "ProductIdent", a.product,
                "Desc", a.desc,
                "OpenDt", a.openDt.toString(),
                "MaturityDt", a.maturityDt == null ? null : a.maturityDt.toString(),
                "Rate", a.rate,
                "AcctBal", bals);
        return obj(
                "Status", ok(),
                "AcctRec", obj(
                        "AcctKeys", obj("AcctId", a.id, "AcctType", a.type),
                        a.type.equals("LOAN") ? "LoanAcctInfo" : "DepositAcctInfo", info,
                        "AcctStatus", obj("AcctStatusCode", "Open", "EffDt", a.openDt.toString())));
    }

    // ---- Get Account Transaction History ----
    private Map<String, Object> history(Map<String, Object> body) {
        Acct a = find(Json.str(body, "AcctTrnSel.AcctKeys.AcctType"), Json.str(body, "AcctTrnSel.AcctKeys.AcctId"));
        if (a == null) return error("1120", "Account not found");
        List<Object> ranges = Json.list(body, "AcctTrnSel.DtRange");
        LocalDate from = LocalDate.MIN, to = LocalDate.MAX;
        if (!ranges.isEmpty()) {
            String s = Json.str(ranges.get(0), "StartDt"), e = Json.str(ranges.get(0), "EndDt");
            if (s != null) from = LocalDate.parse(s);
            if (e != null) to = LocalDate.parse(e);
        }
        BigDecimal maxRec = Json.num(body, "RecCtrlIn.MaxRecLimit");
        int limit = maxRec == null || maxRec.intValue() <= 0 ? 100 : maxRec.intValue();
        List<Object> recs = new ArrayList<>();
        for (Map<String, Object> t : a.trns) {
            LocalDate d = LocalDate.parse(Json.str(t, "AcctTrnInfo.PostedDt"));
            if (d.isBefore(from) || d.isAfter(to)) continue;
            recs.add(t);
            if (recs.size() >= limit) break;
        }
        return obj("Status", ok(), "RecCtrlOut", obj("SentRecCount", recs.size()), "AcctTrnRec", recs);
    }

    // ---- Add Transfer ----
    private Map<String, Object> transfer(Map<String, Object> body) {
        Acct from = find(Json.str(body, "XferInfo.FromAcctRef.AcctKeys.AcctType"), Json.str(body, "XferInfo.FromAcctRef.AcctKeys.AcctId"));
        Acct to = find(Json.str(body, "XferInfo.ToAcctRef.AcctKeys.AcctType"), Json.str(body, "XferInfo.ToAcctRef.AcctKeys.AcctId"));
        BigDecimal amt = Json.num(body, "XferInfo.CurAmt.Amt");
        if (from == null || to == null) return error("1120", "Account not found");
        if (amt == null || amt.signum() <= 0) return error("1730", "Invalid transfer amount");
        if (from.type.equals("CDA") || from.type.equals("LOAN")) return error("1740", "Transfers not allowed from this account type");
        if (from.avail.compareTo(amt) < 0) return error("1750", "Insufficient available funds");

        LocalDate today = LocalDate.now();
        from.avail = from.avail.subtract(amt);
        from.ledger = from.ledger.subtract(amt);
        if (to.type.equals("LOAN")) { // payment reduces principal
            to.ledger = to.ledger.subtract(amt);
            to.avail = to.ledger;
        } else {
            to.avail = to.avail.add(amt);
            to.ledger = to.ledger.add(amt);
        }
        String memoFrom = "ONLINE TRANSFER TO " + to.type + " x" + last4(to.id);
        String memoTo = "ONLINE TRANSFER FROM " + from.type + " x" + last4(from.id);
        from.trns.add(0, trn(today, "Debit", amt, memoFrom, from.ledger, true));
        to.trns.add(0, trn(today, "Credit", amt, memoTo, to.ledger, true));
        return obj("Status", ok(),
                "XferStatusRec", obj(
                        "XferKeys", obj("AcctKeys", obj("AcctId", from.id, "AcctType", from.type)),
                        "XferStatus", obj("XferStatusCode", "Valid", "EffDt", today.toString())));
    }

    // ---- helpers ----
    private Acct find(String type, String id) {
        if (type == null || id == null) return null;
        return accounts.get(key(type, id));
    }

    private static Map<String, Object> ok() {
        return obj("StatusCode", "0", "StatusDesc", "Success", "Severity", "Info", "SvcProviderName", "Premier");
    }

    private static Map<String, Object> error(String code, String desc) {
        return obj("Status", obj("StatusCode", code, "StatusDesc", desc, "Severity", "Error", "SvcProviderName", "Premier"));
    }

    private static Map<String, Object> bal(String type, BigDecimal amt) {
        return obj("BalType", type, "CurAmt", obj("Amt", amt,
                "CurCode", obj("CurCodeType", "ISO4217-Alpha", "CurCodeValue", "USD")));
    }

    private Map<String, Object> trn(LocalDate d, String drCr, BigDecimal amt, String desc, BigDecimal runningBal, boolean memo) {
        return obj(
                "AcctTrnKeys", obj("AcctTrnIdent", String.valueOf(seq.incrementAndGet())),
                "AcctTrnInfo", obj(
                        "DrCrType", drCr,
                        "MemoPostInd", memo,
                        "PostedDt", d.toString(),
                        "EffDt", d.toString(),
                        "TrnDt", d.toString(),
                        "TrnAmt", obj("Amt", amt),
                        "Desc", List.of(desc),
                        "StmtRunningBal", List.of(obj("Amt", runningBal, "StmtRunningBalType", "Ledger"))),
                "AcctTrnStatus", obj("AcctTrnStatusCode", memo ? "Memo" : "Posted"));
    }

    private void seedHistory(LocalDate today) {
        Random rnd = new Random(42); // deterministic demo data
        for (Acct a : accounts.values()) {
            List<Map<String, Object>> list = new ArrayList<>();
            BigDecimal running = a.ledger;
            for (int day = 1; day <= 90; day++) {
                LocalDate d = today.minusDays(day);
                List<Object[]> entries = new ArrayList<>();
                switch (a.type) {
                    case "SDA" -> {
                        if (d.getDayOfMonth() == 1) entries.add(new Object[]{"Credit", interest(a, running), "INTEREST CREDIT"});
                        if (d.getDayOfMonth() == 15 || d.getDayOfMonth() == 30)
                            entries.add(new Object[]{"Credit", new BigDecimal(a.product.equals("MMA") ? "1500.00" : "750.00"), "ACH DEPOSIT PAYROLL"});
                        if (rnd.nextInt(9) == 0)
                            entries.add(new Object[]{"Debit", money(rnd, 40, 600), "ONLINE TRANSFER TO EXTERNAL ACCT"});
                    }
                    case "CDA" -> {
                        if (d.getDayOfMonth() == 1) entries.add(new Object[]{"Credit", interest(a, running), "INTEREST CREDIT"});
                    }
                    case "LOAN" -> {
                        if (d.getDayOfMonth() == 1) entries.add(new Object[]{"Credit", new BigDecimal("1985.42"), "PAYMENT RECEIVED - PRINCIPAL"});
                    }
                    default -> { }
                }
                for (Object[] e : entries) {
                    BigDecimal amt = (BigDecimal) e[1];
                    list.add(trn(d, (String) e[0], amt, (String) e[2], running, false));
                    // walk the running balance backwards in time
                    boolean credit = e[0].equals("Credit");
                    if (a.type.equals("LOAN")) running = running.add(amt);
                    else running = credit ? running.subtract(amt) : running.add(amt);
                }
            }
            list.sort(Comparator.comparing((Map<String, Object> t) -> Json.str(t, "AcctTrnInfo.PostedDt")).reversed());
            a.trns.addAll(list);
        }
    }

    private static BigDecimal interest(Acct a, BigDecimal bal) {
        return bal.multiply(a.rate).divide(new BigDecimal("1200"), 2, RoundingMode.HALF_UP);
    }

    private static BigDecimal money(Random r, int lo, int hi) {
        return new BigDecimal(lo + r.nextInt(hi - lo)).add(new BigDecimal(r.nextInt(100)).movePointLeft(2));
    }

    private static String last4(String id) { return id.substring(Math.max(0, id.length() - 4)); }

    private static void sleepQuietly(long ms) {
        try { Thread.sleep(ms); } catch (InterruptedException e) { Thread.currentThread().interrupt(); }
    }
}
