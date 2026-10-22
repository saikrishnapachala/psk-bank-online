package com.pskbank.demo;

import com.sun.net.httpserver.HttpServer;
import com.pskbank.demo.banking.AuditLog;
import com.pskbank.demo.banking.CoreBankingService;
import com.pskbank.demo.banking.Entitlements;
import com.pskbank.demo.banking.ExternalFundingService;
import com.pskbank.demo.banking.Models.AcctRef;
import com.pskbank.demo.banking.TransferService;
import com.pskbank.demo.core.ApiException;
import com.pskbank.demo.core.Config;
import com.pskbank.demo.core.HttpJson.UpstreamException;
import com.pskbank.demo.core.Json;
import com.pskbank.demo.core.Router;
import com.pskbank.demo.fiserv.EfxMapper;
import com.pskbank.demo.fiserv.FiservException;
import com.pskbank.demo.fiserv.FiservPaths;
import com.pskbank.demo.fiserv.FiservTransport;
import com.pskbank.demo.fiserv.LiveFiservTransport;
import com.pskbank.demo.fiserv.MockFiservTransport;
import com.pskbank.demo.plaid.LivePlaidTransport;
import com.pskbank.demo.plaid.MockPlaidTransport;
import com.pskbank.demo.plaid.PlaidException;
import com.pskbank.demo.plaid.PlaidService;
import com.pskbank.demo.plaid.PlaidTransport;

import java.io.FileDescriptor;
import java.io.FileOutputStream;
import java.io.PrintStream;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.nio.file.Path;
import java.util.Map;
import java.util.concurrent.Executors;

import static com.pskbank.demo.core.Json.obj;

/**
 * PSK Bank demo banking service: the ONLY component that holds Fiserv and Plaid credentials.
 *
 *   browser -> Next.js (UI + BFF, session cookie) -> this service (private, shared secret) -> Fiserv / Plaid
 *
 * Run: ./run.sh            (mock mode by default; see backend/.env.example)
 *      ./run.sh --check    (live mode smoke test: token + account inquiry for each configured account)
 */
public final class App {

    static final String DEFAULT_ACCOUNTS =
            "SDA:4100012345:Everyday Savings;SDA:4100067890:Money Market;CDA:6200045678:12-Month CD;LOAN:7300098765:Home Mortgage";

    public static void main(String[] args) throws Exception {
        System.setOut(new PrintStream(new FileOutputStream(FileDescriptor.out), true, StandardCharsets.UTF_8));
        Config cfg = Config.load(Path.of(".env"));

        FiservTransport fiserv = buildFiserv(cfg);
        PlaidTransport plaidTransport = buildPlaid(cfg);
        Entitlements entitlements = Entitlements.fromConfig(cfg, DEFAULT_ACCOUNTS);

        if (args.length > 0 && args[0].equals("--check")) {
            System.exit(check(fiserv, entitlements));
        }

        AuditLog audit = new AuditLog();
        CoreBankingService core = new CoreBankingService(fiserv, entitlements);
        TransferService transfers = new TransferService(core, entitlements, audit, cfg.getDecimal("TRANSFER_LIMIT_USD", "25000"),
                cfg.getDecimal("MEMBER_TRANSFER_LIMIT_USD", "5000"), cfg.getDecimal("MEMBER_DAILY_LIMIT_USD", "10000"),
                cfg.getInt("TRANSFERS_PER_MINUTE", 6));
        PlaidService plaid = new PlaidService(plaidTransport, cfg.get("PLAID_CLIENT_NAME", "PSK Bank Online Banking Demo"));
        ExternalFundingService funding = new ExternalFundingService(plaid, entitlements, audit, cfg.getDecimal("ACH_FUNDING_LIMIT_USD", "10000"));

        String secret = cfg.get("BFF_SHARED_SECRET", "dev-only-change-me");
        if (secret.equals("dev-only-change-me")) System.out.println("WARN using default BFF_SHARED_SECRET; set your own in backend/.env");

        Router r = new Router(secret, App::mapError);
        r.publicGet("/health", q -> obj("status", "ok", "fiserv", fiserv.mode(), "plaid", plaidTransport.mode(),
                "fiservCircuitOpen", core.breaker().isOpen()));

        // ---- core banking (Fiserv Banking Hub) ----
        r.get("/api/accounts", q -> core.accounts(q.userId()));
        r.get("/api/accounts/{id}", q -> core.account(q.userId(), q.param(0)));
        r.get("/api/accounts/{id}/transactions", q ->
                obj("transactions", core.transactions(q.userId(), q.param(0), Integer.parseInt(q.query().getOrDefault("days", "60")))));
        r.post("/api/transfers/internal", q -> transfers.internal(q.userId(), q.requestId(), q.header("Idempotency-Key"),
                Json.str(q.body(), "fromId"), Json.str(q.body(), "toId"), Json.num(q.body(), "amount")));
        r.get("/api/payees", q -> obj("payees", transfers.payees(q.userId())));
        r.post("/api/transfers/member", q -> transfers.toMember(q.userId(), q.requestId(), q.header("Idempotency-Key"),
                Json.str(q.body(), "fromId"), Json.str(q.body(), "payeeId"), Json.num(q.body(), "amount")));

        // ---- external accounts (Plaid) ----
        r.post("/api/plaid/link-token", q -> plaid.linkToken(q.userId()));
        r.post("/api/plaid/exchange", q -> plaid.exchange(q.userId(), Json.str(q.body(), "publicToken"), Json.str(q.body(), "institution")));
        r.post("/api/plaid/sandbox-link", q -> plaid.sandboxLink(q.userId()));
        r.get("/api/plaid/accounts", q -> obj("accounts", plaid.accounts(q.userId()), "items", plaid.items(q.userId()), "mode", plaid.mode()));
        r.post("/api/plaid/unlink", q -> { plaid.unlink(q.userId(), Json.str(q.body(), "itemId")); return obj("ok", true); });
        r.post("/api/transfers/external", q -> funding.fund(q.userId(), q.requestId(), q.header("Idempotency-Key"),
                Json.str(q.body(), "externalId"), Json.str(q.body(), "toId"), Json.num(q.body(), "amount")));

        r.get("/api/activity", q -> obj("events", audit.recent(q.userId(), 20)));

        // ---- dev tools ----
        r.get("/api/dev/trace", q -> obj("events", com.pskbank.demo.core.Trace.snapshot()));
        // Debug › Test accounts: every demo customer with live balances (masked numbers only). Not a customer API.
        r.get("/api/dev/customers", q -> obj("customers", entitlements.users().stream().map(u -> obj(
                "userId", u, "name", entitlements.name(u), "accounts", core.accounts(u).accounts())).toList()));
        r.get("/api/dev/status", q -> obj("fiserv", fiserv.mode(), "plaid", plaidTransport.mode(),
                "circuitOpen", core.breaker().isOpen(),
                "mockOutage", fiserv instanceof MockFiservTransport m && m.outage()));
        r.post("/api/dev/mock-outage", q -> {
            if (!(fiserv instanceof MockFiservTransport m)) throw ApiException.badRequest("Only available in FISERV_MODE=mock");
            boolean on = Boolean.TRUE.equals(q.body().get("on"));
            m.setOutage(on);
            if (!on) core.breaker().reset();
            return obj("mockOutage", on);
        });

        String host = cfg.get("BIND_HOST", "127.0.0.1");
        int port = cfg.getInt("PORT", 8081);
        HttpServer server = HttpServer.create(new InetSocketAddress(host, port), 0);
        server.createContext("/", r);
        server.setExecutor(Executors.newVirtualThreadPerTaskExecutor());
        server.start();
        System.out.printf("PSK Bank banking service on http://%s:%d  (fiserv=%s, plaid=%s, customers=%s)%n",
                host, port, fiserv.mode(), plaidTransport.mode(),
                entitlements.users().stream().map(u -> u + ":" + entitlements.list(u).size()).toList());
    }

    private static FiservTransport buildFiserv(Config cfg) {
        if (!cfg.get("FISERV_MODE", "mock").equalsIgnoreCase("live")) return new MockFiservTransport();
        return new LiveFiservTransport(
                cfg.get("FISERV_HOST_URL", "https://bankinghub-cert.fiservapis.com/banking/efx/v1"),
                cfg.get("FISERV_TOKEN_URL", "https://bankinghub-cert.fiservapis.com/fts-apim/oauth2/v2"),
                cfg.require("FISERV_API_KEY"),
                cfg.require("FISERV_API_SECRET"),
                cfg.require("FISERV_ORG_ID"),
                cfg.get("FISERV_VENDOR_ID", null),
                cfg.get("FISERV_CHANNEL", "WEB"),
                cfg.get("FISERV_CLIENT_APP_NAME", "PSK-Bank-Online-Demo"));
    }

    private static PlaidTransport buildPlaid(Config cfg) {
        if (!cfg.get("PLAID_MODE", "mock").equalsIgnoreCase("live")) return new MockPlaidTransport();
        return new LivePlaidTransport(cfg.get("PLAID_ENV", "sandbox"), cfg.get("PLAID_BASE_URL", null),
                cfg.require("PLAID_CLIENT_ID"), cfg.require("PLAID_SECRET"));
    }

    /** Maps exceptions to safe JSON errors. Upstream details are logged, not leaked. */
    private static Map<String, Object> mapError(Throwable t, String requestId, int[] status) {
        String code;
        String message;
        if (t instanceof ApiException e) {
            status[0] = e.status(); code = e.code(); message = e.getMessage();
        } else if (t instanceof FiservException e) {
            status[0] = 422; code = "CORE_REJECTED"; message = e.efxDesc() + " (EFX " + e.efxCode() + ")";
        } else if (t instanceof PlaidException e) {
            status[0] = 422; code = "PLAID_" + e.errorCode(); message = e.safeMessage();
        } else if (t instanceof UpstreamException e) {
            status[0] = 503; code = "UPSTREAM_UNAVAILABLE"; message = "A banking provider is temporarily unavailable";
            System.out.println("UPSTREAM rid=" + requestId + " " + e.getMessage());
        } else if (t instanceof NumberFormatException || t instanceof IllegalArgumentException) {
            status[0] = 400; code = "BAD_REQUEST"; message = "Malformed request";
        } else {
            status[0] = 500; code = "INTERNAL"; message = "Unexpected error";
            System.out.println("ERROR rid=" + requestId + " " + t);
            t.printStackTrace(System.out);
        }
        return obj("error", obj("code", code, "message", message, "requestId", requestId));
    }

    /** Live-mode smoke test you can run before starting the UI. */
    private static int check(FiservTransport fiserv, Entitlements ent) {
        System.out.println("Fiserv mode: " + fiserv.mode());
        try {
            System.out.println("Token OK, expires in ~" + fiserv.tokenCheck() + "s");
        } catch (RuntimeException e) {
            System.out.println("Token FAILED: " + e.getMessage());
            return 1;
        }
        int failures = 0;
        for (AcctRef ref : ent.users().stream().flatMap(u -> ent.list(u).stream()).toList()) {
            try {
                Thread.sleep(400); // the shared trial sandbox rate-limits back-to-back calls
                Map<String, Object> reply = fiserv.post(FiservPaths.ACCOUNT_INQUIRY, EfxMapper.accountInquiry(ref));
                var a = EfxMapper.toAccount(ref, reply);
                System.out.printf("  %-5s %s  OK  available=%s current=%s provider=%s%n", ref.acctType(), ref.masked(),
                        a.available(), a.current(), Json.str(reply, "Status.SvcProviderName"));
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
                return 3;
            } catch (FiservException e) {
                failures++;
                System.out.printf("  %-5s %s  REJECTED  %s%n", ref.acctType(), ref.masked(), e.getMessage());
            } catch (RuntimeException e) {
                failures++;
                System.out.printf("  %-5s %s  ERROR  %s%n", ref.acctType(), ref.masked(), e.getMessage());
            }
        }
        System.out.println(failures == 0 ? "All account inquiries succeeded." : failures + " account inquiry(ies) failed. Check FISERV_DEMO_ACCOUNTS against your sandbox's test accounts.");
        return failures == 0 ? 0 : 2;
    }
}
