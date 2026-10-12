package com.pskbank.demo.plaid;

import java.util.Map;

/** One Plaid API call. Live: https://{env}.plaid.com. Mock: in-memory sandbox look-alike. */
public interface PlaidTransport {
    Map<String, Object> post(String path, Map<String, Object> body);

    String mode();
}
