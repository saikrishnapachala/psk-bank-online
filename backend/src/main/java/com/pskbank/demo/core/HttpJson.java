package com.pskbank.demo.core;

import java.io.IOException;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import java.util.Map;

/** Thin outbound HTTP helper shared by the Fiserv and Plaid live transports. */
public final class HttpJson {
    private static final HttpClient CLIENT = HttpClient.newBuilder()
            .connectTimeout(Duration.ofSeconds(5))
            .followRedirects(HttpClient.Redirect.NEVER)
            .build();

    private HttpJson() {}

    public record Result(int status, String body) {
        public boolean ok() { return status >= 200 && status < 300; }
    }

    public static Result post(String url, Map<String, String> headers, String body, String contentType, Duration timeout) {
        HttpRequest.Builder b = HttpRequest.newBuilder(URI.create(url))
                .timeout(timeout)
                .header("Content-Type", contentType)
                .header("Accept", "application/json")
                .POST(HttpRequest.BodyPublishers.ofString(body == null ? "" : body));
        headers.forEach(b::header);
        try {
            HttpResponse<String> r = CLIENT.send(b.build(), HttpResponse.BodyHandlers.ofString());
            return new Result(r.statusCode(), r.body());
        } catch (IOException e) {
            throw new UpstreamException("Network error calling " + host(url) + ": " + e.getClass().getSimpleName(), e);
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            throw new UpstreamException("Interrupted calling " + host(url), e);
        }
    }

    private static String host(String url) {
        try { return URI.create(url).getHost(); } catch (Exception e) { return "upstream"; }
    }

    /** Transport-level failure (network, timeout, 5xx) as opposed to a business rejection. */
    public static class UpstreamException extends RuntimeException {
        public UpstreamException(String message, Throwable cause) { super(message, cause); }
        public UpstreamException(String message) { super(message); }
    }
}
