import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { newSession, writeSessionCookies } from "@/lib/session";

// Demo-only credential check. Production: redirect to your IdP (OIDC authorization code + PKCE) with MFA.
function same(a: string, b: string) {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

export async function POST(req: Request) {
  const origin = req.headers.get("origin");
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  if (origin && host && new URL(origin).host !== host) {
    return NextResponse.json({ error: { code: "BAD_ORIGIN", message: "Cross-site request blocked" } }, { status: 403 });
  }
  const { username = "", password = "" } = (await req.json().catch(() => ({}))) as { username?: string; password?: string };
  const okUser = same(String(username).trim().toLowerCase(), (process.env.DEMO_USERNAME ?? "alex").toLowerCase());
  const okPass = same(String(password), process.env.DEMO_PASSWORD ?? "");
  if (!okUser || !okPass || !process.env.DEMO_PASSWORD) {
    return NextResponse.json({ error: { code: "BAD_CREDENTIALS", message: "That username and password don't match." } }, { status: 401 });
  }
  await writeSessionCookies(newSession(process.env.DEMO_USER_ID ?? "u-alex", process.env.DEMO_DISPLAY_NAME ?? "Demo user"));
  return NextResponse.json({ ok: true });
}
