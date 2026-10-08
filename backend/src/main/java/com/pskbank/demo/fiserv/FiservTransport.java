package com.pskbank.demo.fiserv;

import java.util.Map;

/**
 * One EFX call to Banking Hub: POST {hostUrl}{path} with a JSON body, returns the parsed EFX reply.
 * Implementations: {@link LiveFiservTransport} (real sandbox) and {@link MockFiservTransport} (in-memory core).
 * Everything above this interface (mapping, entitlements, limits) is identical in both modes.
 */
public interface FiservTransport {
    Map<String, Object> post(String path, Map<String, Object> body);

    String mode();

    /** Diagnostic: proves credentials work. Returns seconds until the token expires. */
    long tokenCheck();
}
