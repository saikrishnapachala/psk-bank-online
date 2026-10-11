package com.pskbank.demo.banking;

import com.pskbank.demo.banking.Models.AuditEvent;
import com.pskbank.demo.core.Json;

import java.time.Instant;
import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.Deque;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

/**
 * Append-only record of every money-movement attempt. Demo: memory + one JSON line on stdout per event.
 * Production: immutable store (WORM bucket / append-only table) shipped to the SIEM.
 */
public final class AuditLog {
    private final Map<String, Deque<AuditEvent>> byUser = new ConcurrentHashMap<>();

    public void record(String userId, String requestId, String type, String summary, String status, String ref) {
        AuditEvent ev = new AuditEvent(Instant.now().toString(), type, summary, status, ref);
        Deque<AuditEvent> q = byUser.computeIfAbsent(userId, k -> new ArrayDeque<>());
        synchronized (q) {
            q.addFirst(ev);
            while (q.size() > 50) q.removeLast();
        }
        System.out.println("AUDIT " + Json.write(Json.obj(
                "ts", ev.ts(), "user", userId, "requestId", requestId, "type", type,
                "summary", summary, "status", status, "ref", ref)));
    }

    public List<AuditEvent> recent(String userId, int max) {
        Deque<AuditEvent> q = byUser.get(userId);
        if (q == null) return List.of();
        synchronized (q) {
            List<AuditEvent> out = new ArrayList<>(q);
            return out.subList(0, Math.min(max, out.size()));
        }
    }
}
