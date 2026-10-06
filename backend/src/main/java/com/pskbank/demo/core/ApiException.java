package com.pskbank.demo.core;

/** An error we deliberately return to the BFF: HTTP status + stable code + safe message. */
public class ApiException extends RuntimeException {
    private final int status;
    private final String code;

    public ApiException(int status, String code, String message) {
        super(message);
        this.status = status;
        this.code = code;
    }

    public int status() { return status; }
    public String code() { return code; }

    public static ApiException badRequest(String message) { return new ApiException(400, "BAD_REQUEST", message); }
    public static ApiException forbidden(String message) { return new ApiException(403, "FORBIDDEN", message); }
    public static ApiException notFound(String message) { return new ApiException(404, "NOT_FOUND", message); }
    public static ApiException unavailable(String message) { return new ApiException(503, "UPSTREAM_UNAVAILABLE", message); }
}
