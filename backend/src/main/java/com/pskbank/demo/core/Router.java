package com.pskbank.demo.core;

import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpHandler;

import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.URLDecoder;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.function.Function;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Tiny router on the JDK HTTP server. Every /api route requires the BFF's shared secret and a user id
 * header: this service sits on a private network and trusts only the BFF, never the browser.
 */
public final class Router implements HttpHandler {

    public record Req(String method, String path, List<String> params, Map<String, String> query,
                      Map<String, Object> body, String userId, String requestId, HttpExchange exchange) {
        public String header(String name) { return exchange.getRequestHeaders().getFirst(name); }
        public String param(int i) { return params.get(i); }
    }

    public interface ErrorMapper { Map<String, Object> map(Throwable t, String requestId, int[] statusOut); }

    private record Route(String method, Pattern pattern, boolean authenticated, Function<Req, Object> handler) {}

    private final List<Route> routes = new ArrayList<>();
    private final byte[] sharedSecret;
    private final ErrorMapper errorMapper;

    public Router(String sharedSecret, ErrorMapper errorMapper) {
        this.sharedSecret = sharedSecret.getBytes(StandardCharsets.UTF_8);
        this.errorMapper = errorMapper;
    }

    public Router get(String path, Function<Req, Object> h) { return add("GET", path, true, h); }
    public Router post(String path, Function<Req, Object> h) { return add("POST", path, true, h); }
    public Router publicGet(String path, Function<Req, Object> h) { return add("GET", path, false, h); }

    private Router add(String method, String path, boolean auth, Function<Req, Object> h) {
        String regex = "^" + path.replaceAll("\\{[^/]+}", "([^/]+)") + "$";
        routes.add(new Route(method, Pattern.compile(regex), auth, h));
        return this;
    }

    @Override
    public void handle(HttpExchange ex) throws IOException {
        long start = System.nanoTime();
        java.time.Instant startedAt = java.time.Instant.now();
        String requestId = headerOr(ex, "X-Request-Id", UUID.randomUUID().toString());
        Trace.RID.set(requestId);
        String method = ex.getRequestMethod();
        String path = ex.getRequestURI().getPath();
        int status = 200;
        Object out;
        try {
            Route route = null;
            Matcher m = null;
            boolean pathMatched = false;
            for (Route r : routes) {
                Matcher mm = r.pattern().matcher(path);
                if (mm.matches()) {
                    pathMatched = true;
                    if (r.method().equals(method)) { route = r; m = mm; break; }
                }
            }
            if (route == null) {
                throw new ApiException(pathMatched ? 405 : 404, pathMatched ? "METHOD_NOT_ALLOWED" : "NOT_FOUND", "No route for " + method + " " + path);
            }
            String userId = null;
            if (route.authenticated()) {
                String token = ex.getRequestHeaders().getFirst("X-Internal-Token");
                if (token == null || !MessageDigest.isEqual(sharedSecret, token.getBytes(StandardCharsets.UTF_8))) {
                    throw new ApiException(401, "UNAUTHENTICATED", "Missing or invalid internal token");
                }
                userId = ex.getRequestHeaders().getFirst("X-User-Id");
                if (userId == null || userId.isBlank()) throw new ApiException(401, "UNAUTHENTICATED", "Missing user");
            }
            List<String> params = new ArrayList<>();
            for (int i = 1; i <= m.groupCount(); i++) params.add(URLDecoder.decode(m.group(i), StandardCharsets.UTF_8));
            Map<String, Object> body = method.equals("POST") ? readBody(ex) : Map.of();
            out = route.handler().apply(new Req(method, path, params, query(ex), body, userId, requestId, ex));
        } catch (Throwable t) {
            int[] s = {500};
            out = errorMapper.map(t, requestId, s);
            status = s[0];
        }
        byte[] bytes = Json.write(out).getBytes(StandardCharsets.UTF_8);
        ex.getResponseHeaders().set("Content-Type", "application/json; charset=utf-8");
        ex.getResponseHeaders().set("X-Request-Id", requestId);
        ex.getResponseHeaders().set("Cache-Control", "no-store");
        ex.sendResponseHeaders(status, bytes.length);
        try (OutputStream os = ex.getResponseBody()) { os.write(bytes); }
        long ms = (System.nanoTime() - start) / 1_000_000;
        System.out.printf("%s %s %s -> %d (%d ms) rid=%s%n", java.time.LocalTime.now().withNano(0), method, path, status, ms, requestId);
        if (!path.equals("/health") && !path.equals("/api/dev/trace")) {
            Trace.record(startedAt, "bff-java", method, path, String.valueOf(status), null);
        }
        Trace.RID.remove();
    }

    private static Map<String, Object> readBody(HttpExchange ex) throws IOException {
        try (InputStream in = ex.getRequestBody()) {
            byte[] raw = in.readNBytes(64 * 1024 + 1);
            if (raw.length > 64 * 1024) throw ApiException.badRequest("Request body too large");
            String s = new String(raw, StandardCharsets.UTF_8);
            return s.isBlank() ? Map.of() : Json.parseObject(s);
        }
    }

    private static Map<String, String> query(HttpExchange ex) {
        Map<String, String> q = new HashMap<>();
        String raw = ex.getRequestURI().getRawQuery();
        if (raw == null) return q;
        for (String pair : raw.split("&")) {
            int eq = pair.indexOf('=');
            if (eq > 0) q.put(URLDecoder.decode(pair.substring(0, eq), StandardCharsets.UTF_8),
                    URLDecoder.decode(pair.substring(eq + 1), StandardCharsets.UTF_8));
        }
        return q;
    }

    private static String headerOr(HttpExchange ex, String name, String def) {
        String v = ex.getRequestHeaders().getFirst(name);
        return (v == null || v.isBlank() || v.length() > 100) ? def : v;
    }
}
