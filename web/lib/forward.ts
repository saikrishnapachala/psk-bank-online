import "server-only";
import { NextResponse } from "next/server";
import { backend } from "./backend";
import { guardMutation, relay } from "./bff";

/**
 * Generic BFF mutation: guard (session + origin + CSRF), pick allowed fields, call Java, relay the result.
 * Only whitelisted fields cross the boundary; the user id always comes from the session, never the body.
 */
export async function forwardMutation(req: Request, backendPath: string, allowed: string[], needsIdempotency = false) {
  const guard = await guardMutation(req);
  if (guard instanceof NextResponse) return guard;
  const raw = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const body: Record<string, unknown> = {};
  for (const k of allowed) if (k in raw) body[k] = raw[k];
  const idempotencyKey = req.headers.get("idempotency-key") ?? undefined;
  if (needsIdempotency && !idempotencyKey) {
    return NextResponse.json({ error: { code: "BAD_REQUEST", message: "Missing Idempotency-Key" } }, { status: 400 });
  }
  return relay(() => backend(backendPath, { userId: guard.uid, method: "POST", body, idempotencyKey }));
}
