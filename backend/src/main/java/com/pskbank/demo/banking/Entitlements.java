package com.pskbank.demo.banking;

import com.pskbank.demo.banking.Models.AcctRef;
import com.pskbank.demo.core.ApiException;
import com.pskbank.demo.core.Config;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;

/**
 * Who may see and act on which core accounts. Banking Hub credentials identify the APP, not the customer,
 * so this check is ours to enforce on every call. In production this comes from your enrollment store
 * (customer id -> core party id -> accounts); here it is seeded from backend/.env.
 */
public final class Entitlements {
    private final Map<String, List<AcctRef>> byUser = new LinkedHashMap<>();
    private final Map<String, String> names = new LinkedHashMap<>();

    /**
     * DEMO_USERS=u-alex:Alex Morgan,u-jordan:Jordan Lee  with  ACCOUNTS_u-alex=TYPE:ACCTID:Nickname;...
     * Falls back to one user (DEMO_USER_ID + FISERV_DEMO_ACCOUNTS) for older .env files.
     */
    public static Entitlements fromConfig(Config cfg, String fallbackSpec) {
        Entitlements e = new Entitlements();
        String users = cfg.get("DEMO_USERS", "");
        if (users.isBlank()) {
            String uid = cfg.get("DEMO_USER_ID", "u-alex");
            e.add(uid, cfg.get("DEMO_DISPLAY_NAME", "Demo user"), cfg.get("FISERV_DEMO_ACCOUNTS", fallbackSpec));
            return e;
        }
        for (String u : users.split(",")) {
            String[] f = u.trim().split(":", 2);
            if (f[0].isBlank()) continue;
            // ACCOUNTS_u-alex, or ACCOUNTS_U_ALEX for hosts whose env var names can't contain "-".
            String envSafe = "ACCOUNTS_" + f[0].toUpperCase().replace('-', '_');
            String spec = cfg.get("ACCOUNTS_" + f[0], null);
            e.add(f[0], f.length == 2 ? f[1].trim() : f[0], spec != null ? spec : cfg.require(envSafe));
        }
        return e;
    }

    /** spec format: "TYPE:ACCTID:Nickname;TYPE:ACCTID:Nickname", e.g. "DDA:1081372605:Everyday Checking". */
    void add(String userId, String name, String spec) {
        List<AcctRef> refs = new ArrayList<>();
        int n = 1;
        for (String part : spec.split(";")) {
            String p = part.trim();
            if (p.isEmpty()) continue;
            String[] f = p.split(":", 3);
            if (f.length < 2) throw new IllegalStateException("Bad account entry for " + userId + ": " + p);
            String nickname = f.length == 3 ? f[2].trim() : f[0] + " " + f[1];
            refs.add(new AcctRef("acc-" + n++, f[0].trim().toUpperCase(), f[1].trim(), nickname));
        }
        byUser.put(userId, List.copyOf(refs));
        names.put(userId, name);
    }

    public List<String> users() { return List.copyOf(byUser.keySet()); }

    public String name(String userId) { return names.getOrDefault(userId, userId); }

    public List<AcctRef> list(String userId) {
        return byUser.getOrDefault(userId, List.of());
    }

    public AcctRef require(String userId, String opaqueId) {
        return list(userId).stream()
                .filter(r -> r.id().equals(opaqueId))
                .findFirst()
                .orElseThrow(() -> ApiException.forbidden("Account not found for this user"));
    }

    /** Where money sent to this customer lands: their first checking account, else their first savings. */
    public Optional<AcctRef> receivingAccount(String userId) {
        List<AcctRef> refs = list(userId);
        return refs.stream().filter(r -> r.acctType().equals("DDA")).findFirst()
                .or(() -> refs.stream().filter(r -> r.acctType().equals("SDA")).findFirst());
    }
}
