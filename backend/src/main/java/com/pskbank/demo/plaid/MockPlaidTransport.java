package com.pskbank.demo.plaid;

import com.pskbank.demo.core.Json;

import java.math.BigDecimal;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;

import static com.pskbank.demo.core.Json.obj;

/**
 * Behaves like Plaid Sandbox's "First Platypus Bank" (ins_109508) for the endpoints this app uses,
 * so the full link -> exchange -> balance -> auth flow runs with no Plaid account.
 */
public final class MockPlaidTransport implements PlaidTransport {
    private final Map<String, String> publicToItem = new ConcurrentHashMap<>();
    private final Map<String, String> accessToItem = new ConcurrentHashMap<>();
    private final Set<String> removed = ConcurrentHashMap.newKeySet();

    @Override public String mode() { return "mock"; }

    @Override
    public Map<String, Object> post(String path, Map<String, Object> body) {
        return switch (path) {
            case "/link/token/create" -> obj(
                    "link_token", "link-sandbox-mock-" + UUID.randomUUID(),
                    "expiration", Instant.now().plusSeconds(4 * 3600).toString(),
                    "request_id", rid());
            case "/sandbox/public_token/create" -> {
                String item = "item-mock-" + UUID.randomUUID().toString().substring(0, 8);
                String pub = "public-sandbox-mock-" + UUID.randomUUID();
                publicToItem.put(pub, item);
                yield obj("public_token", pub, "request_id", rid());
            }
            case "/item/public_token/exchange" -> {
                String pub = Json.str(body, "public_token");
                String item = pub == null ? null : publicToItem.remove(pub);
                if (item == null) throw new PlaidException("INVALID_PUBLIC_TOKEN", "public token is invalid or expired", null);
                String access = "access-sandbox-mock-" + UUID.randomUUID();
                accessToItem.put(access, item);
                yield obj("access_token", access, "item_id", item, "request_id", rid());
            }
            case "/accounts/balance/get", "/accounts/get" -> {
                String item = item(body);
                yield obj("accounts", accounts(), "item", obj("item_id", item, "institution_id", "ins_109508"), "request_id", rid());
            }
            case "/auth/get" -> {
                String item = item(body);
                yield obj("accounts", accounts(),
                        "numbers", obj("ach", List.of(
                                obj("account_id", "mock-chk-0000", "account", "1111222233330000", "routing", "011401533", "wire_routing", "021000021"),
                                obj("account_id", "mock-sav-1111", "account", "1111222233331111", "routing", "011401533", "wire_routing", "021000021"))),
                        "item", obj("item_id", item, "institution_id", "ins_109508"),
                        "request_id", rid());
            }
            case "/item/remove" -> {
                removed.add(item(body));
                yield obj("request_id", rid());
            }
            default -> throw new PlaidException("NOT_IMPLEMENTED", "Mock Plaid does not implement " + path, null);
        };
    }

    private String item(Map<String, Object> body) {
        String access = Json.str(body, "access_token");
        String item = access == null ? null : accessToItem.get(access);
        if (item == null || removed.contains(item)) throw new PlaidException("INVALID_ACCESS_TOKEN", "access token is invalid", null);
        return item;
    }

    private static List<Object> accounts() {
        return List.of(
                acct("mock-chk-0000", "Plaid Checking", "0000", "checking", "100", "110"),
                acct("mock-sav-1111", "Plaid Saving", "1111", "savings", "200", "210"));
    }

    private static Map<String, Object> acct(String id, String name, String mask, String subtype, String avail, String cur) {
        return obj("account_id", id, "name", name, "official_name", name, "mask", mask, "type", "depository",
                "subtype", subtype,
                "balances", obj("available", new BigDecimal(avail), "current", new BigDecimal(cur), "iso_currency_code", "USD"));
    }

    private static String rid() { return UUID.randomUUID().toString().substring(0, 12); }
}
