import "server-only";
import { randomUUID } from "node:crypto";

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
  const requestId = opts.requestId ?? randomUUID();
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
      signal: AbortSignal.timeout(20_000),
    });
  } catch {
    throw new BackendError(503, "BACKEND_UNREACHABLE", "The banking service isn't reachable. Is the Java backend running on " + base + "?", requestId);
  }
  const text = await res.text();
  const json = text ? JSON.parse(text) : {};
  if (!res.ok) {
    const e = json?.error ?? {};
    throw new BackendError(res.status, e.code ?? "ERROR", e.message ?? "Request failed", e.requestId ?? requestId);
  }
  return json as T;
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
