package com.pskbank.demo.banking;

import com.pskbank.demo.banking.Models.Account;
import com.pskbank.demo.banking.Models.AccountsView;
import com.pskbank.demo.banking.Models.AcctRef;
import com.pskbank.demo.banking.Models.Txn;
import com.pskbank.demo.core.ApiException;
import com.pskbank.demo.core.CircuitBreaker;
import com.pskbank.demo.core.HttpJson.UpstreamException;
import com.pskbank.demo.core.Json;
import com.pskbank.demo.fiserv.EfxMapper;
import com.pskbank.demo.fiserv.FiservException;
import com.pskbank.demo.fiserv.FiservPaths;
import com.pskbank.demo.fiserv.FiservTransport;

import java.time.Duration;
import java.time.Instant;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutionException;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;

/**
 * Reads from the core via Banking Hub, enforcing entitlements, with a circuit breaker and a last-good
 * read model so customers still see (clearly labelled) balances during a Fiserv outage.
 */
public final class CoreBankingService {
    private final FiservTransport fiserv;
    private final Entitlements entitlements;
    private final CircuitBreaker breaker = new CircuitBreaker("fiserv", 3, Duration.ofSeconds(30));
    private final Map<String, AccountsView> lastGood = new ConcurrentHashMap<>();

    public CoreBankingService(FiservTransport fiserv, Entitlements entitlements) {
        this.fiserv = fiserv;
        this.entitlements = entitlements;
    }

    public String mode() { return fiserv.mode(); }

    public CircuitBreaker breaker() { return breaker; }

    // The shared trial sandbox throttles hard (HTTP 429), so live reads are cached briefly and a 429 falls back
    // to the last good reply. Mock mode skips this so the outage simulation stays instant.
    // ponytail: in-memory per process; production = a shared cache with per-user keys and push invalidation.
    private record Cached(Instant at, Map<String, Object> reply) {}
    private static final Duration READ_TTL = Duration.ofSeconds(60);
    private final Map<String, Cached> reads = new ConcurrentHashMap<>();

    private Map<String, Object> read(String path, Map<String, Object> body) {
        if (!"live".equals(fiserv.mode())) return call(path, body);
        String key = path + Json.write(body);
        Cached c = reads.get(key);
        if (c != null && c.at().plus(READ_TTL).isAfter(Instant.now())) return c.reply();
        try {
            Map<String, Object> reply = call(path, body);
            reads.put(key, new Cached(Instant.now(), reply));
            return reply;
        } catch (FiservException e) {
            if ("429".equals(e.efxCode()) && c != null) return c.reply();
            throw e;
        }
    }

    /** Drop cached reads so the next page shows post-transfer balances. */
    public void invalidateReads() { reads.clear(); }

    /** Call Banking Hub through the breaker. */
    public Map<String, Object> call(String path, Map<String, Object> body) {
        return breaker.call(() -> fiserv.post(path, body));
    }

    public AccountsView accounts(String userId) {
        List<AcctRef> refs = entitlements.list(userId);
        try (ExecutorService pool = Executors.newVirtualThreadPerTaskExecutor()) {
            List<Future<Account>> futures = new ArrayList<>();
            for (AcctRef ref : refs) {
                futures.add(pool.submit(() -> {
                    try {
                        return EfxMapper.toAccount(ref, read(FiservPaths.ACCOUNT_INQUIRY, EfxMapper.accountInquiry(ref)));
                    } catch (FiservException e) { // business-level: show the row as unavailable with the reason
                        return EfxMapper.unavailable(ref, e.efxDesc() + " (EFX " + e.efxCode() + ")");
                    }
                }));
            }
            List<Account> accounts = new ArrayList<>();
            for (Future<Account> f : futures) accounts.add(f.get());
            AccountsView view = new AccountsView(accounts, false, Instant.now().toString(), fiserv.mode(), null);
            lastGood.put(userId, view);
            return view;
        } catch (ExecutionException e) {
            Throwable cause = e.getCause();
            if (cause instanceof UpstreamException) return staleOrFail(userId);
            if (cause instanceof RuntimeException re) throw re;
            throw new IllegalStateException(cause);
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            throw ApiException.unavailable("Interrupted");
        }
    }

    private AccountsView staleOrFail(String userId) {
        AccountsView cached = lastGood.get(userId);
        if (cached == null) throw ApiException.unavailable("Core banking is temporarily unavailable. Please try again shortly.");
        return new AccountsView(cached.accounts(), true, cached.asOf(), cached.source(),
                "We can't reach core banking right now, so these are your last known balances. "
                        + "Transfers are paused until service is restored.");
    }

    public Account account(String userId, String opaqueId) {
        AcctRef ref = entitlements.require(userId, opaqueId);
        return EfxMapper.toAccount(ref, read(FiservPaths.ACCOUNT_INQUIRY, EfxMapper.accountInquiry(ref)));
    }

    public List<Txn> transactions(String userId, String opaqueId, int days) {
        AcctRef ref = entitlements.require(userId, opaqueId);
        int window = Math.max(1, Math.min(days, 365));
        LocalDate to = LocalDate.now();
        Map<String, Object> reply = read(FiservPaths.TRANSACTION_HISTORY,
                EfxMapper.historyInquiry(ref, to.minusDays(window), to, 100));
        // The shared sandbox doesn't always honour DtRange, so enforce the window here too.
        String from = to.minusDays(window).toString();
        return EfxMapper.toTxns(reply).stream().filter(t -> t.date() == null || t.date().compareTo(from) >= 0).toList();
    }
}
