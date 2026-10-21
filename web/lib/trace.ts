import "server-only";
import { headers } from "next/headers";

export type TraceEvent = {
  ts: string;
  rid?: string;
  hop: "browser-bff" | "bff-java" | "java-fiserv" | "java-plaid" | string;
  method: string;
  target: string;
  status: string;
  ms: number;
  detail?: string;
};

// ponytail: last 500 events in this Node process; production = OpenTelemetry spans to a collector.
const store = globalThis as unknown as { __pskTrace?: TraceEvent[]; __pskInbound?: Map<string, TraceEvent> };
const buf = (store.__pskTrace ??= []);
const inbound = (store.__pskInbound ??= new Map());

export function record(e: TraceEvent) {
  buf.push(e);
  if (buf.length > 500) buf.shift();
  if (inbound.size > 500) inbound.delete(inbound.keys().next().value!);
}

export function bffEvents(): TraceEvent[] {
  return [...buf];
}

/** The proxy's request id, plus a one-time Browser -> BFF event for it (null outside a traced request). */
export async function currentRequest(): Promise<TraceEvent | null> {
  let h: Headers;
  try {
    h = await headers();
  } catch {
    return null;
  }
  const rid = h.get("x-request-id");
  if (!rid) return null;
  let ev = inbound.get(rid);
  if (!ev) {
    const [method, target = "?"] = (h.get("x-psk-route") ?? "GET ?").split(" ");
    const api = target.startsWith("/api/");
    ev = {
      ts: new Date(Number(h.get("x-psk-start") ?? Date.now())).toISOString(),
      rid, hop: "browser-bff", method, target,
      status: api ? "…" : "render", ms: 0,
      detail: api ? "BFF route handler: session, origin and CSRF checked" : "Server-rendered page",
    };
    inbound.set(rid, ev);
    record(ev);
  }
  return ev;
}
