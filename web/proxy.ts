import { NextResponse, type NextRequest } from "next/server";

/**
 * Stamps every browser request with a request id the BFF forwards to Java (X-Request-Id), so the /logs page
 * can show Browser -> BFF -> Java -> Fiserv as one trace. Any client-sent id is overwritten, never trusted.
 */
export function proxy(request: NextRequest) {
  const h = new Headers(request.headers);
  h.set("x-request-id", crypto.randomUUID());
  h.set("x-psk-route", `${request.method} ${request.nextUrl.pathname}`);
  h.set("x-psk-start", Date.now().toString());
  return NextResponse.next({ request: { headers: h } });
}

export const config = { matcher: ["/((?!_next/|favicon|logs).*)"] };
