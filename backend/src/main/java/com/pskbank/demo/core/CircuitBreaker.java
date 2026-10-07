package com.pskbank.demo.core;

import com.pskbank.demo.core.HttpJson.UpstreamException;

import java.time.Duration;
import java.time.Instant;
import java.util.function.Supplier;

/**
 * Opens after N consecutive transport failures and fails fast for a cool-down window, so a Fiserv outage
 * doesn't pile up hanging requests. Business rejections (EFX Severity=Error) do not count as failures.
 * Production: use Resilience4j; this keeps the demo dependency-free.
 */
public final class CircuitBreaker {
    private final String name;
    private final int threshold;
    private final Duration coolDown;
    private int consecutiveFailures;
    private Instant openUntil = Instant.EPOCH;

    public CircuitBreaker(String name, int threshold, Duration coolDown) {
        this.name = name;
        this.threshold = threshold;
        this.coolDown = coolDown;
    }

    public <T> T call(Supplier<T> action) {
        synchronized (this) {
            if (Instant.now().isBefore(openUntil)) {
                throw new UpstreamException(name + " circuit open; failing fast");
            }
        }
        try {
            T result = action.get();
            synchronized (this) { consecutiveFailures = 0; }
            return result;
        } catch (UpstreamException e) {
            synchronized (this) {
                if (++consecutiveFailures >= threshold) openUntil = Instant.now().plus(coolDown);
            }
            throw e;
        }
    }

    public synchronized boolean isOpen() { return Instant.now().isBefore(openUntil); }

    public synchronized void reset() { consecutiveFailures = 0; openUntil = Instant.EPOCH; }
}
