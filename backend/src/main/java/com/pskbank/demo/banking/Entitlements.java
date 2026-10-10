package com.pskbank.demo.banking;

import com.pskbank.demo.banking.Models.AcctRef;
import com.pskbank.demo.core.ApiException;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

/**
 * Who may see and act on which core accounts. Banking Hub credentials identify the APP, not the customer,
 * so this check is ours to enforce on every call. In production this comes from your enrollment store
 * (customer id -> core party id -> accounts); here it is seeded from FISERV_DEMO_ACCOUNTS.
 */
public final class Entitlements {
    private final Map<String, List<AcctRef>> byUser = new ConcurrentHashMap<>();

    /**
     * spec format: "TYPE:ACCTID:Nickname;TYPE:ACCTID:Nickname"
     * e.g. "SDA:4100012345:Everyday Savings;CDA:6200045678:12-Month CD"
     */
    public static Entitlements fromSpec(String userId, String spec) {
        Entitlements e = new Entitlements();
        List<AcctRef> refs = new ArrayList<>();
        int n = 1;
        for (String part : spec.split(";")) {
            String p = part.trim();
            if (p.isEmpty()) continue;
            String[] f = p.split(":", 3);
            if (f.length < 2) throw new IllegalStateException("Bad FISERV_DEMO_ACCOUNTS entry: " + p);
            String nickname = f.length == 3 ? f[2].trim() : f[0] + " " + f[1];
            refs.add(new AcctRef("acc-" + n++, f[0].trim().toUpperCase(), f[1].trim(), nickname));
        }
        e.byUser.put(userId, List.copyOf(refs));
        return e;
    }

    public List<AcctRef> list(String userId) {
        return byUser.getOrDefault(userId, List.of());
    }

    public AcctRef require(String userId, String opaqueId) {
        return list(userId).stream()
                .filter(r -> r.id().equals(opaqueId))
                .findFirst()
                .orElseThrow(() -> ApiException.forbidden("Account not found for this user"));
    }
}
