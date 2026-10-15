"use client";

/** Browser-side helper: same-origin POST to our BFF with the CSRF header. Never talks to Fiserv/Plaid/Java. */
export async function postJson<T>(url: string, body?: unknown, idempotencyKey?: string): Promise<T> {
  const csrf = document.cookie.split("; ").find((c) => c.startsWith("psk_csrf="))?.split("=")[1] ?? "";
  const headers: Record<string, string> = { "Content-Type": "application/json", "x-csrf-token": decodeURIComponent(csrf) };
  if (idempotencyKey) headers["Idempotency-Key"] = idempotencyKey;
  const res = await fetch(url, { method: "POST", headers, body: body === undefined ? "{}" : JSON.stringify(body) });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (res.status === 401) window.location.href = "/login";
    const err = new Error(json?.error?.message ?? "Something went wrong") as Error & { requestId?: string };
    err.requestId = json?.error?.requestId;
    throw err;
  }
  return json as T;
}
