package com.pskbank.demo.plaid;

import com.pskbank.demo.banking.Models.ExternalAccount;
import com.pskbank.demo.banking.Models.LinkedItem;
import com.pskbank.demo.core.ApiException;
import com.pskbank.demo.core.Json;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.ArrayList;
import java.util.Base64;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

import static com.pskbank.demo.core.Json.obj;

/**
 * Plaid: link a customer's accounts at OTHER banks (aggregation + ownership/ACH verification).
 * Access tokens are kept server-side only. Demo storage is in memory; production: encrypted store / KMS.
 */
public final class PlaidService {
    private record Item(String itemId, String accessToken, String institution) {}

    private record ExtRef(String itemId, String plaidAccountId) {}

    private final PlaidTransport plaid;
    private final String clientName;
    private final Map<String, Map<String, Item>> itemsByUser = new ConcurrentHashMap<>();
    private final Map<String, Map<String, ExtRef>> extByUser = new ConcurrentHashMap<>();

    public PlaidService(PlaidTransport plaid, String clientName) {
        this.plaid = plaid;
        this.clientName = clientName;
    }

    public String mode() { return plaid.mode(); }

    public Map<String, Object> linkToken(String userId) {
        Map<String, Object> reply = plaid.post("/link/token/create", obj(
                "client_name", clientName,
                "language", "en",
                "country_codes", List.of("US"),
                "user", obj("client_user_id", userId),
                "products", List.of("auth")));
        return obj("linkToken", Json.str(reply, "link_token"), "expiration", Json.str(reply, "expiration"), "mode", plaid.mode());
    }

    /** Called after Plaid Link's onSuccess hands the browser a public_token. */
    public LinkedItem exchange(String userId, String publicToken, String institutionName) {
        if (publicToken == null || publicToken.isBlank()) throw ApiException.badRequest("publicToken is required");
        Map<String, Object> reply = plaid.post("/item/public_token/exchange", obj("public_token", publicToken));
        Item item = new Item(Json.str(reply, "item_id"), Json.str(reply, "access_token"),
                institutionName == null || institutionName.isBlank() ? "Linked bank" : institutionName);
        itemsByUser.computeIfAbsent(userId, k -> new ConcurrentHashMap<>()).put(item.itemId(), item);
        int count = accounts(userId).stream().filter(a -> a.itemId().equals(item.itemId())).toList().size();
        return new LinkedItem(item.itemId(), item.institution(), count);
    }

    /** Dev shortcut that works in mock AND real Plaid Sandbox: creates a public_token without the Link UI. */
    public LinkedItem sandboxLink(String userId) {
        Map<String, Object> reply = plaid.post("/sandbox/public_token/create", obj(
                "institution_id", "ins_109508", // First Platypus Bank (Plaid Sandbox)
                "initial_products", List.of("auth")));
        return exchange(userId, Json.str(reply, "public_token"), "First Platypus Bank");
    }

    public List<ExternalAccount> accounts(String userId) {
        List<ExternalAccount> out = new ArrayList<>();
        for (Item item : itemsByUser.getOrDefault(userId, Map.of()).values()) {
            Map<String, Object> reply = plaid.post("/accounts/balance/get", obj("access_token", item.accessToken()));
            for (Object a : Json.list(reply, "accounts")) {
                String plaidId = Json.str(a, "account_id");
                String extId = "ext-" + shortHash(item.itemId() + "|" + plaidId);
                extByUser.computeIfAbsent(userId, k -> new ConcurrentHashMap<>()).put(extId, new ExtRef(item.itemId(), plaidId));
                out.add(new ExternalAccount(extId, item.itemId(), item.institution(),
                        Json.str(a, "name"), Json.str(a, "mask"), Json.str(a, "subtype"),
                        Json.num(a, "balances.available"), Json.num(a, "balances.current")));
            }
        }
        return out;
    }

    public ExternalAccount account(String userId, String extId) {
        ExtRef ref = ref(userId, extId);
        return accounts(userId).stream().filter(a -> a.id().equals(extId)).findFirst()
                .orElseThrow(() -> ApiException.notFound("External account " + ref.plaidAccountId() + " not found"));
    }

    /** Returns [routing, account] from Plaid Auth. Never sent to the browser unmasked. */
    public String[] achNumbers(String userId, String extId) {
        ExtRef ref = ref(userId, extId);
        Item item = itemsByUser.get(userId).get(ref.itemId());
        Map<String, Object> reply = plaid.post("/auth/get", obj("access_token", item.accessToken(),
                "options", obj("account_ids", List.of(ref.plaidAccountId()))));
        for (Object n : Json.list(reply, "numbers.ach")) {
            if (ref.plaidAccountId().equals(Json.str(n, "account_id"))) {
                return new String[]{Json.str(n, "routing"), Json.str(n, "account")};
            }
        }
        throw new ApiException(422, "NOT_ACH_CAPABLE", "This external account doesn't support ACH");
    }

    public List<LinkedItem> items(String userId) {
        Map<String, Integer> counts = new LinkedHashMap<>();
        for (ExtRef r : extByUser.getOrDefault(userId, Map.of()).values()) counts.merge(r.itemId(), 1, Integer::sum);
        List<LinkedItem> out = new ArrayList<>();
        for (Item i : itemsByUser.getOrDefault(userId, Map.of()).values()) {
            out.add(new LinkedItem(i.itemId(), i.institution(), counts.getOrDefault(i.itemId(), 0)));
        }
        return out;
    }

    public void unlink(String userId, String itemId) {
        Item item = itemsByUser.getOrDefault(userId, Map.of()).get(itemId);
        if (item == null) throw ApiException.notFound("Linked bank not found");
        plaid.post("/item/remove", obj("access_token", item.accessToken()));
        itemsByUser.get(userId).remove(itemId);
        Map<String, ExtRef> ext = extByUser.get(userId);
        if (ext != null) ext.values().removeIf(r -> r.itemId().equals(itemId));
    }

    private ExtRef ref(String userId, String extId) {
        ExtRef ref = extByUser.getOrDefault(userId, Map.of()).get(extId);
        if (ref == null) throw ApiException.forbidden("External account not found for this user");
        return ref;
    }

    private static String shortHash(String s) {
        try {
            byte[] d = MessageDigest.getInstance("SHA-256").digest(s.getBytes(StandardCharsets.UTF_8));
            return Base64.getUrlEncoder().withoutPadding().encodeToString(d).substring(0, 10);
        } catch (NoSuchAlgorithmException e) {
            throw new IllegalStateException(e);
        }
    }
}
