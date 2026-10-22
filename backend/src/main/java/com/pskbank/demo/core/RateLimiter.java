package com.pskbank.demo.core;

import java.time.Duration;
import java.util.ArrayDeque;
import java.util.Deque;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

/**
 * Sliding-window limiter: at most `max` events per key within `window`. Used for per-customer transfer velocity.
 * ponytail: per process; behind a load balancer use Redis (INCR + EXPIRE) or the API gateway's limiter.
 */
public final class RateLimiter {
    private final int max;
    private final long windowNanos;
    private final Map<String, Deque<Long>> hits = new ConcurrentHashMap<>();

    public RateLimiter(int max, Duration window) {
        this.max = max;
        this.windowNanos = window.toNanos();
    }

    public boolean tryAcquire(String key) {
        long now = System.nanoTime();
        Deque<Long> q = hits.computeIfAbsent(key, k -> new ArrayDeque<>());
        synchronized (q) {
            while (!q.isEmpty() && now - q.peekFirst() > windowNanos) q.pollFirst();
            if (q.size() >= max) return false;
            q.addLast(now);
            return true;
        }
    }

    public static void main(String[] args) { // self-check: java -cp out com.pskbank.demo.core.RateLimiter
        RateLimiter r = new RateLimiter(2, Duration.ofMillis(200));
        if (!r.tryAcquire("a") || !r.tryAcquire("a")) throw new AssertionError("first two should pass");
        if (r.tryAcquire("a")) throw new AssertionError("third within window should fail");
        if (!r.tryAcquire("b")) throw new AssertionError("keys are independent");
        try { Thread.sleep(250); } catch (InterruptedException e) { Thread.currentThread().interrupt(); }
        if (!r.tryAcquire("a")) throw new AssertionError("window should slide");
        System.out.println("RateLimiter OK");
    }
}
