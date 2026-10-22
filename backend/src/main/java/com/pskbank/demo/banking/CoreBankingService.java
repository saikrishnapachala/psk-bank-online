package com.pskbank.demo.banking;

import com.pskbank.demo.banking.Models.Account;
import com.pskbank.demo.banking.Models.AccountsView;
import com.pskbank.demo.banking.Models.AcctRef;
import com.pskbank.demo.banking.Models.Txn;
import com.pskbank.demo.core.ApiException;
import com.pskbank.demo.core.CircuitBreaker;
import com.pskbank.demo.core.HttpJson.UpstreamException;
import com.pskbank.demo.core.Json;
import com.pskbank.demo.core.Trace;
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

    private final Map<String, java.util.concurrent.CompletableFuture<Map<String, Object>>> pending = new ConcurrentHashMap<>();

    private Map<String, Object> read(String path, Map<String, Object> body) {
        if (!"live".equals(fiserv.mode())) return call(path, body);
        String key = path + Json.write(body);
        Cached c = reads.get(key);
        if (c != null && c.at().plus(READ_TTL).isAfter(Instant.now())) {
            Trace.record(Instant.now(), "java-fiserv", "POST", path, "cache", "Served from 60s read cache, no Fiserv call");
            return c.reply();
        }
        // Coalesce: many customers opening the same account at once share one Fiserv call.
        var mine = new java.util.concurrent.CompletableFuture<Map<String, Object>>();
        var existing = pending.putIfAbsent(key, mine);
        if (existing != null) {
            Instant t0 = Instant.now();
            try {
                Map<String, Object> reply = existing.join();
                Trace.record(t0, "java-fiserv", "POST", path, "cache", "Joined an identical in-flight Fiserv call");
                return reply;
            } catch (java.util.concurrent.CompletionException e) {
                if (e.getCause() instanceof RuntimeException re) throw re;
                throw e;
            }
        }
        try {
            Map<String, Object> reply = readWithRetry(path, body, c);
            reads.put(key, new Cached(Instant.now(), reply));
            mine.complete(reply);
            return reply;
        } catch (RuntimeException e) {
            mine.completeExceptionally(e);
            throw e;
        } finally {
            pending.remove(key, mine);
        }
    }

    /** Reads are safe to retry: one jittered retry on 429, then the last good reply if we have one. Writes never come here. */
    private Map<String, Object> readWithRetry(String path, Map<String, Object> body, Cached last) {
        try {
            return call(path, body);
        } catch (FiservException e) {
            if (!"429".equals(e.efxCode())) throw e;
            if (last != null) {
                Trace.record(Instant.now(), "java-fiserv", "POST", path, "cache", "Rate limited (429), served last good reply");
                return last.reply();
            }
            try {
                Thread.sleep(400 + java.util.concurrent.ThreadLocalRandom.current().nextInt(600));
            } catch (InterruptedException ie) {
                Thread.currentThread().interrupt();
                throw e;
            }
            return call(path, body);
        }
    }

    /** Drop cached reads so the next page shows post-transfer balances. */
    public void invalidateReads() { reads.clear(); }

    /** Call Banking Hub through the breaker. */
    // At most N Fiserv calls in flight; extra requests queue briefly instead of tripping the provider's rate limit.
    // ponytail: fixed at 4 for the shared trial sandbox; make it config when a production quota is known.
    private final java.util.concurrent.Semaphore gate = new java.util.concurrent.Semaphore(4, true);

    public Map<String, Object> call(String path, Map<String, Object> body) {
        Instant t0 = Instant.now();
        try {
            if (!gate.tryAcquire(10, java.util.concurrent.TimeUnit.SECONDS)) {
                Trace.record(t0, "java-fiserv", "POST", path, "BUSY", "Waited 10s for a free Fiserv slot · " + fiserv.mode());
                throw ApiException.unavailable("Core banking is busy. Please try again in a moment.");
            }
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            throw ApiException.unavailable("Interrupted");
        }
        try {
            Map<String, Object> reply = breaker.call(() -> fiserv.post(path, body));
            Trace.record(t0, "java-fiserv", "POST", path, "EFX " + Json.str(reply, "Status.StatusCode"),
                    Json.str(reply, "Status.StatusDesc") + " · " + fiserv.mode() + " · " + Json.str(reply, "Status.SvcProviderName"));
            return reply;
        } catch (FiservException e) {
            Trace.record(t0, "java-fiserv", "POST", path, "EFX " + e.efxCode(), e.efxDesc() + " · " + fiserv.mode());
            throw e;
        } catch (RuntimeException e) {
            Trace.record(t0, "java-fiserv", "POST", path, "ERROR", e.getMessage() + " · " + fiserv.mode());
            throw e;
        } finally {
            gate.release();
        }
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
        // The shared sandbox doesn't always honour DtRange, so enforce the window here too. Future-dated rows are
        // other developers' scheduled transfers that haven't posted; a statement shows only what has happened.
        String from = to.minusDays(window).toString();
        // The core's business date can run a day ahead of this server's clock, so allow today + 1.
        String until = to.plusDays(1).toString();
        List<Txn> rows = EfxMapper.toTxns(reply).stream()
                .filter(t -> {
                    if (t.date() == null) return true;
                    String d = t.date().substring(0, Math.min(10, t.date().length()));
                    return d.compareTo(from) >= 0 && d.compareTo(until) <= 0;
                })
                .toList();
        // Premier lists days newest-first but rows within a day oldest-first; show the latest transfer on top.
        List<Integer> idx = new ArrayList<>();
        for (int i = 0; i < rows.size(); i++) idx.add(i);
        idx.sort((x, y) -> {
            String dx = String.valueOf(rows.get(x).date()), dy = String.valueOf(rows.get(y).date());
            int byDate = dy.substring(0, Math.min(10, dy.length())).compareTo(dx.substring(0, Math.min(10, dx.length())));
            return byDate != 0 ? byDate : Integer.compare(y, x);
        });
        return idx.stream().map(rows::get).toList();
    }
}
