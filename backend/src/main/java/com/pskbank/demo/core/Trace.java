package com.pskbank.demo.core;

import java.time.Duration;
import java.time.Instant;
import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;

/**
 * In-memory hop log for the /logs observer page: every BFF -> Java request and every Java -> Fiserv / Plaid call,
 * tagged with the request id the BFF sent so one page load reads as one trace.
 * ponytail: last 500 events in process memory; production = OpenTelemetry spans to a collector.
 */
public final class Trace {
    private Trace() {}

    /** Request id of the BFF call being served; inherited by the virtual threads that fan out core calls. */
    public static final InheritableThreadLocal<String> RID = new InheritableThreadLocal<>();

    private static final int MAX = 500;
    private static final ArrayDeque<Map<String, Object>> EVENTS = new ArrayDeque<>();

    public static void record(Instant start, String hop, String method, String target, String status, String detail) {
        Map<String, Object> e = Json.obj(
                "ts", start.toString(), "rid", RID.get(), "hop", hop, "method", method, "target", target,
                "status", status, "ms", Duration.between(start, Instant.now()).toMillis(), "detail", detail);
        synchronized (EVENTS) {
            EVENTS.addLast(e);
            if (EVENTS.size() > MAX) EVENTS.removeFirst();
        }
    }

    public static List<Map<String, Object>> snapshot() {
        synchronized (EVENTS) { return new ArrayList<>(EVENTS); }
    }
}
