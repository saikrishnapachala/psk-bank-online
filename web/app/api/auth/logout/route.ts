import { NextResponse } from "next/server";
import { guardMutation } from "@/lib/bff";
import { clearSessionCookies } from "@/lib/session";

export async function POST(req: Request) {
  const guard = await guardMutation(req);
  if (guard instanceof NextResponse && guard.status !== 401) return guard;
  await clearSessionCookies();
  return NextResponse.json({ ok: true });
}
