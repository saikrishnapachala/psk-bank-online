package com.pskbank.demo.core;

import java.io.IOException;
import java.math.BigDecimal;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.HashMap;
import java.util.Map;

/**
 * Reads settings from backend/.env (if present), then real environment variables (which win).
 * Secrets live only here, in the Java tier. The Next.js tier never sees Fiserv or Plaid keys.
 */
public final class Config {
    private final Map<String, String> values = new HashMap<>();

    private Config() {}

    public static Config load(Path dotEnv) {
        Config c = new Config();
        if (Files.exists(dotEnv)) {
            try {
                for (String raw : Files.readAllLines(dotEnv)) {
                    String line = raw.trim();
                    if (line.isEmpty() || line.startsWith("#")) continue;
                    int eq = line.indexOf('=');
                    if (eq <= 0) continue;
                    String k = line.substring(0, eq).trim();
                    String v = line.substring(eq + 1).trim();
                    if (v.length() >= 2 && ((v.startsWith("\"") && v.endsWith("\"")) || (v.startsWith("'") && v.endsWith("'")))) {
                        v = v.substring(1, v.length() - 1);
                    }
                    c.values.put(k, v);
                }
            } catch (IOException e) {
                throw new IllegalStateException("Cannot read " + dotEnv, e);
            }
        }
        c.values.putAll(System.getenv());
        return c;
    }

    public String get(String key, String def) {
        String v = values.get(key);
        return (v == null || v.isBlank()) ? def : v;
    }

    public String require(String key) {
        String v = get(key, null);
        if (v == null) throw new IllegalStateException("Missing required setting " + key + " (set it in backend/.env)");
        return v;
    }

    public int getInt(String key, int def) {
        return Integer.parseInt(get(key, String.valueOf(def)));
    }

    public BigDecimal getDecimal(String key, String def) {
        return new BigDecimal(get(key, def));
    }

    public boolean getBool(String key, boolean def) {
        return Boolean.parseBoolean(get(key, String.valueOf(def)));
    }
}
