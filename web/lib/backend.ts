import "server-only";
import { randomUUID } from "node:crypto";
import { currentRequest, record } from "./trace";

/**
 * The BFF's only outbound dependency: the Java banking service.
 * Adds the shared secret, the authenticated user id and a request id for end-to-end tracing.
 */
export class BackendError extends Error {
  constructor(public status: number, public code: string, message: string, public requestId?: string) {
    super(message);
  }
}

type Options = {
  userId: string;
  method?: "GET" | "POST";
  body?: unknown;
  idempotencyKey?: string;
  requestId?: string;
};

export async function backend<T>(path: string, opts: Options): Promise<T> {
  const base = process.env.BACKEND_URL ?? "http://127.0.0.1:8081";
  const secret = process.env.BACKEND_SHARED_SECRET;
  if (!secret) throw new Error("BACKEND_SHARED_SECRET is not set in web/.env.local");
  const inbound = await currentRequest();
  const requestId = opts.requestId ?? inbound?.rid ?? randomUUID();
  const done = (status: number | string) => {
    if (!inbound) return;
    inbound.ms = Date.now() - Date.parse(inbound.ts);
    if (inbound.status !== "render") inbound.status = String(status);
  };
  const headers: Record<string, string> = {
    "X-Internal-Token": secret,
    "X-User-Id": opts.userId,
    "X-Request-Id": requestId,
    Accept: "application/json",
  };
  if (opts.body !== undefined) headers["Content-Type"] = "application/json";
  if (opts.idempotencyKey) headers["Idempotency-Key"] = opts.idempotencyKey;

  let res: Response;
  try {
    res = await fetch(base + path, {
      method: opts.method ?? "GET",
      headers,
      body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
      cache: "no-store",
      // Free hosting puts the Java service to sleep when idle; waking it can take ~30-60s.
      signal: AbortSignal.timeout(60_000),
    });
  } catch {
    done(503);
    record({ ts: new Date().toISOString(), rid: requestId, hop: "bff-java", method: opts.method ?? "GET", target: path, status: "DOWN", ms: 0, detail: "Java service unreachable" });
    throw new BackendError(503, "BACKEND_UNREACHABLE", process.env.NODE_ENV === "production"
      ? "The banking service is still starting up. Wait a few seconds and reload the page."
      : "The banking service isn't reachable. Is the Java backend running on " + base + "?", requestId);
  }
  done(res.status);
  const text = await res.text();
  const json = text ? JSON.parse(text) : {};
  if (!res.ok) {
    const e = json?.error ?? {};
    throw new BackendError(res.status, e.code ?? "ERROR", e.message ?? "Request failed", e.requestId ?? requestId);
  }
  return json as T;
}

/** Fire-and-forget ping so a sleeping Java service starts waking while the customer is still signing in. */
export function wakeBackend() {
  const base = process.env.BACKEND_URL ?? "http://127.0.0.1:8081";
  fetch(base + "/health", { cache: "no-store", signal: AbortSignal.timeout(60_000) }).catch(() => {});
}

export async function health(): Promise<{ status: string; fiserv: string; plaid: string; fiservCircuitOpen: boolean } | null> {
  const base = process.env.BACKEND_URL ?? "http://127.0.0.1:8081";
  try {
    const r = await fetch(base + "/health", { cache: "no-store", signal: AbortSignal.timeout(3000) });
    return r.ok ? await r.json() : null;
  } catch {
    return null;
  }
}
