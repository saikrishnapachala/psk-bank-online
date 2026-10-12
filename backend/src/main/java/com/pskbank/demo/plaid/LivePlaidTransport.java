package com.pskbank.demo.plaid;

import com.pskbank.demo.core.HttpJson;
import com.pskbank.demo.core.HttpJson.UpstreamException;
import com.pskbank.demo.core.Json;

import java.time.Duration;
import java.util.LinkedHashMap;
import java.util.Map;

/**
 * Real Plaid API over HTTPS. client_id and secret go in the JSON body (Plaid's documented style);
 * they are read from backend/.env and never sent to the browser.
 */
public final class LivePlaidTransport implements PlaidTransport {
    private final String baseUrl;
    private final String clientId;
    private final String secret;

    public LivePlaidTransport(String env, String baseUrlOverride, String clientId, String secret) {
        this.baseUrl = baseUrlOverride != null ? baseUrlOverride : "https://" + env + ".plaid.com";
        this.clientId = clientId;
        this.secret = secret;
    }

    @Override public String mode() { return "live"; }

    @Override
    public Map<String, Object> post(String path, Map<String, Object> body) {
        Map<String, Object> payload = new LinkedHashMap<>(body);
        payload.put("client_id", clientId);
        payload.put("secret", secret);
        HttpJson.Result r = HttpJson.post(baseUrl + path, Map.of("Plaid-Version", "2020-09-14"),
                Json.write(payload), "application/json", Duration.ofSeconds(20));
        Map<String, Object> reply;
        try {
            reply = Json.parseObject(r.body());
        } catch (IllegalArgumentException e) {
            throw new UpstreamException("Plaid returned HTTP " + r.status() + " with a non-JSON body");
        }
        if (r.ok()) return reply;
        if (r.status() >= 500) throw new UpstreamException("Plaid HTTP " + r.status());
        throw new PlaidException(Json.str(reply, "error_code"), Json.str(reply, "error_message"),
                Json.str(reply, "display_message"));
    }
}
