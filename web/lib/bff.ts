import "server-only";
import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { BackendError } from "./backend";
import { getSession, type Session } from "./session";

/**
 * Guard for BFF route handlers that change state:
 *  1. valid session cookie,
 *  2. same-origin request (Origin header matches Host),
 *  3. CSRF token header matches the token bound into the signed session.
 */
export async function guardMutation(req: Request): Promise<Session | NextResponse> {
  const session = await getSession();
  if (!session) return problem(401, "UNAUTHENTICATED", "Your session has ended. Sign in again.");

  const origin = req.headers.get("origin");
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  if (origin && host && new URL(origin).host !== host) {
    return problem(403, "BAD_ORIGIN", "Cross-site request blocked");
  }
  const sent = Buffer.from(req.headers.get("x-csrf-token") ?? "");
  const expected = Buffer.from(session.csrf);
  if (sent.length !== expected.length || !timingSafeEqual(sent, expected)) {
    return problem(403, "BAD_CSRF", "Security check failed. Reload the page and try again.");
  }
  return session;
}

export async function guardRead(): Promise<Session | NextResponse> {
  const session = await getSession();
  return session ?? problem(401, "UNAUTHENTICATED", "Your session has ended. Sign in again.");
}

export function problem(status: number, code: string, message: string, requestId?: string) {
  return NextResponse.json({ error: { code, message, requestId } }, { status });
}

/** Run a backend call and translate failures into the same error shape for the browser. */
export async function relay<T>(fn: () => Promise<T>) {
  try {
    return NextResponse.json(await fn());
  } catch (e) {
    if (e instanceof BackendError) return problem(e.status, e.code, e.message, e.requestId);
    console.error(e);
    return problem(500, "BFF_ERROR", "Unexpected error in the web tier");
  }
}
