import "server-only";
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

/**
 * Stateless signed session cookie for the demo.
 * HttpOnly + SameSite=Lax + Secure (in production) + 15-minute lifetime.
 * Production: swap for your IdP (OIDC) session; keep the cookie opaque and server-side.
 */
export const SESSION_COOKIE = "psk_session";
export const CSRF_COOKIE = "psk_csrf";
const TTL_SECONDS = 15 * 60;

export type Session = { uid: string; name: string; csrf: string; exp: number };

function secret(): string {
  const s = process.env.SESSION_SECRET;
  if (!s || s.length < 32) throw new Error("SESSION_SECRET must be set (32+ chars) in web/.env.local");
  return s;
}

function sign(data: string): string {
  return createHmac("sha256", secret()).update(data).digest("base64url");
}

export function encode(session: Session): string {
  const body = Buffer.from(JSON.stringify(session)).toString("base64url");
  return `${body}.${sign(body)}`;
}

export function decode(token: string | undefined): Session | null {
  if (!token) return null;
  const [body, sig] = token.split(".");
  if (!body || !sig) return null;
  const expected = Buffer.from(sign(body));
  const actual = Buffer.from(sig);
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return null;
  try {
    const s = JSON.parse(Buffer.from(body, "base64url").toString()) as Session;
    return s.exp * 1000 > Date.now() ? s : null;
  } catch {
    return null;
  }
}

export function newSession(uid: string, name: string): Session {
  return { uid, name, csrf: randomBytes(24).toString("base64url"), exp: Math.floor(Date.now() / 1000) + TTL_SECONDS };
}

export async function writeSessionCookies(session: Session) {
  const jar = await cookies();
  const secure = process.env.NODE_ENV === "production";
  jar.set(SESSION_COOKIE, encode(session), { httpOnly: true, sameSite: "lax", secure, path: "/", maxAge: TTL_SECONDS });
  // Readable by our own JS so it can echo it in the x-csrf-token header; bound to the session payload.
  jar.set(CSRF_COOKIE, session.csrf, { httpOnly: false, sameSite: "lax", secure, path: "/", maxAge: TTL_SECONDS });
}

export async function clearSessionCookies() {
  const jar = await cookies();
  jar.delete(SESSION_COOKIE);
  jar.delete(CSRF_COOKIE);
}

export async function getSession(): Promise<Session | null> {
  const jar = await cookies();
  return decode(jar.get(SESSION_COOKIE)?.value);
}

/** For pages: bounce to /login when there is no valid session. */
export async function requireSession(): Promise<Session> {
  const s = await getSession();
  if (!s) redirect("/login");
  return s;
}
