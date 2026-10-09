package com.pskbank.demo.fiserv;

import com.pskbank.demo.core.HttpJson;
import com.pskbank.demo.core.HttpJson.UpstreamException;
import com.pskbank.demo.core.Json;

import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.time.Instant;
import java.util.Base64;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.UUID;

/**
 * Real Fiserv Banking Hub transport.
 *
 * Per Fiserv Developer Studio docs (Banking Hub > Getting Started):
 *  - Token: POST {tokenUrl} with Basic auth (API key = username, API secret = password),
 *    form body grant_type=client_credentials. Token lives ~15 minutes; expires_in is reported in milliseconds.
 *  - Calls: POST {hostUrl}{apiPath} with "Authorization: Bearer ..." and an "EFXHeader" header holding JSON
 *    (OrganizationId required; TrnId, VendorId, Context optional).
 *  - Every operation is POST or PUT; reads use the ".../secured" paths so account numbers never sit in URLs.
 */
public final class LiveFiservTransport implements FiservTransport {
    private final String hostUrl;
    private final String tokenUrl;
    private final String basicAuth;
    private final String orgId;
    private final String vendorId;
    private final String channel;
    private final String clientAppName;
    private final Duration timeout = Duration.ofSeconds(15);

    private volatile String token;
    private volatile Instant tokenExpiresAt = Instant.EPOCH;

    public LiveFiservTransport(String hostUrl, String tokenUrl, String apiKey, String apiSecret,
                               String orgId, String vendorId, String channel, String clientAppName) {
        this.hostUrl = stripTrailingSlash(hostUrl);
        this.tokenUrl = tokenUrl;
        this.basicAuth = "Basic " + Base64.getEncoder()
                .encodeToString((apiKey + ":" + apiSecret).getBytes(StandardCharsets.UTF_8));
        this.orgId = orgId;
        this.vendorId = vendorId;
        this.channel = channel;
        this.clientAppName = clientAppName;
    }

    @Override
    public String mode() { return "live"; }

    @Override
    public long tokenCheck() {
        invalidate();
        bearer();
        return Duration.between(Instant.now(), tokenExpiresAt).toSeconds();
    }

    @Override
    public Map<String, Object> post(String path, Map<String, Object> body) {
        HttpJson.Result r = send(path, body);
        if (r.status() == 401) { // token revoked or expired early: refresh once
            invalidate();
            r = send(path, body);
        }
        Map<String, Object> reply;
        try {
            reply = Json.parseObject(r.body());
        } catch (IllegalArgumentException e) {
            throw new UpstreamException("Banking Hub returned HTTP " + r.status() + " with a non-JSON body");
        }
        String severity = Json.str(reply, "Status.Severity");
        if ("Error".equalsIgnoreCase(severity)) {
            throw new FiservException(Json.str(reply, "Status.StatusCode"), Json.str(reply, "Status.StatusDesc"),
                    Json.str(reply, "Status.SvcProviderName"));
        }
        if (r.status() >= 500) throw new UpstreamException("Banking Hub HTTP " + r.status());
        if (!r.ok()) {
            String desc = Json.str(reply, "Status.StatusDesc");
            throw new FiservException(String.valueOf(r.status()), desc != null ? desc : "HTTP " + r.status(), null);
        }
        return reply;
    }

    private HttpJson.Result send(String path, Map<String, Object> body) {
        Map<String, String> headers = new LinkedHashMap<>();
        headers.put("Authorization", "Bearer " + bearer());
        headers.put("EFXHeader", efxHeader());
        return HttpJson.post(hostUrl + path, headers, Json.write(body), "application/json", timeout);
    }

    private String efxHeader() {
        Map<String, Object> ctx = Json.obj("Channel", channel, "ClientAppName", clientAppName);
        Map<String, Object> h = Json.obj(
                "OrganizationId", orgId,
                "TrnId", UUID.randomUUID().toString(),
                "VendorId", vendorId, // optional; omitted when null
                "Context", ctx);
        return Json.write(h);
    }

    private String bearer() {
        if (token != null && Instant.now().isBefore(tokenExpiresAt.minusSeconds(60))) return token;
        synchronized (this) {
            if (token != null && Instant.now().isBefore(tokenExpiresAt.minusSeconds(60))) return token;
            HttpJson.Result r = HttpJson.post(tokenUrl, Map.of("Authorization", basicAuth),
                    "grant_type=client_credentials", "application/x-www-form-urlencoded", timeout);
            if (!r.ok()) {
                throw new FiservException("TOKEN_" + r.status(),
                        "Token request rejected. Check FISERV_API_KEY / FISERV_API_SECRET and FISERV_TOKEN_URL.", null);
            }
            Map<String, Object> t = Json.parseObject(r.body());
            String access = Json.str(t, "access_token");
            if (access == null) throw new UpstreamException("Token response had no access_token");
            long raw = Long.parseLong(String.valueOf(t.getOrDefault("expires_in", "899000")));
            long seconds = raw > 100_000 ? raw / 1000 : raw; // Banking Hub documents milliseconds; tolerate seconds
            token = access;
            tokenExpiresAt = Instant.now().plusSeconds(seconds);
            return token;
        }
    }

    private synchronized void invalidate() {
        token = null;
        tokenExpiresAt = Instant.EPOCH;
    }

    private static String stripTrailingSlash(String s) {
        return s.endsWith("/") ? s.substring(0, s.length() - 1) : s;
    }
}
