import { LiveToggle } from "@/components/LiveToggle";
import { SiteHeader } from "@/components/SiteHeader";
import { backend, BackendError } from "@/lib/backend";
import { requireSession } from "@/lib/session";
import { bffEvents, type TraceEvent } from "@/lib/trace";

const HOPS: Record<string, { label: string; depth: number }> = {
  "browser-bff": { label: "Browser → BFF", depth: 0 },
  "bff-java": { label: "BFF → Java", depth: 1 },
  "java-fiserv": { label: "Java → Fiserv", depth: 2 },
  "java-plaid": { label: "Java → Plaid", depth: 2 },
};

function tone(status: string) {
  if (status === "cache") return "cache";
  if (/^(EFX 0|HTTP 2|2\d\d$|OK|render)/.test(status)) return "ok";
  if (status === "…") return "";
  return "bad";
}

/** Puts each Java -> Fiserv/Plaid call under the BFF -> Java request whose time window contains it. */
function nest(evs: TraceEvent[]): TraceEvent[] {
  const end = (e: TraceEvent) => Date.parse(e.ts) + e.ms;
  const parents = evs.filter((e) => e.hop === "bff-java");
  const children = evs.filter((e) => e.hop.startsWith("java-"));
  const out = evs.filter((e) => e.hop === "browser-bff");
  for (const p of parents) {
    out.push(p);
    for (const c of children.filter((c) => Date.parse(c.ts) >= Date.parse(p.ts) && Date.parse(c.ts) <= end(p))) {
      out.push(c);
      children.splice(children.indexOf(c), 1);
    }
  }
  return [...out, ...children, ...evs.filter((e) => !out.includes(e) && !e.hop.startsWith("java-"))];
}

const time = (iso: string) =>
  new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", second: "2-digit" });

export default async function LogsPage() {
  const session = await requireSession();
  let java: TraceEvent[] = [];
  let error: string | null = null;
  try {
    java = (await backend<{ events: TraceEvent[] }>("/api/dev/trace", { userId: session.uid })).events;
  } catch (e) {
    error = (e as BackendError).message;
  }

  // One group per request id: a page load or a button click, with every hop it caused underneath.
  const groups = new Map<string, TraceEvent[]>();
  for (const e of [...bffEvents(), ...java]) {
    const key = e.rid ?? "untraced";
    groups.set(key, [...(groups.get(key) ?? []), e]);
  }
  const traces = [...groups.entries()]
    .map(([rid, evs]) => ({ rid, evs: nest(evs.sort((a, b) => a.ts.localeCompare(b.ts))) }))
    .sort((a, b) => b.evs[0].ts.localeCompare(a.evs[0].ts))
    .slice(0, 40);
  const fiservCalls = java.filter((e) => e.hop === "java-fiserv" && e.status !== "cache").length;
  const cacheHits = java.filter((e) => e.status === "cache").length;

  return (
    <>
      <SiteHeader name={session.name} current="logs" />
      <main className="wrap">
        <div className="section-head">
          <h1 style={{ margin: 0 }}>Request logs</h1>
          <LiveToggle />
        </div>
        <p className="muted" style={{ marginTop: 8 }}>
          Every request the browser makes, what the BFF sent to the Java service, and each call Java made to Fiserv
          or Plaid, grouped by request id. Newest first. {fiservCalls} Fiserv calls and {cacheHits} cache hits in memory.
        </p>
        {error && <p className="notice bad" role="alert">Java trace unavailable: {error}</p>}
        {traces.length === 0 && <p className="empty">No traffic yet. Open Accounts or Move money in another tab.</p>}
        {traces.map(({ rid, evs }) => {
          const root = evs.find((e) => e.hop === "browser-bff") ?? evs[0];
          return (
            <section className="trace" key={rid} aria-label={`Request ${rid}`}>
              <header>
                <strong>{root.method} {root.target}</strong>
                <span className="muted small">{time(root.ts)} · rid {rid.slice(0, 8)}</span>
              </header>
              <table className="txns">
                <tbody>
                  {evs.map((e, i) => {
                    const hop = HOPS[e.hop] ?? { label: e.hop, depth: 1 };
                    return (
                      <tr key={i}>
                        <td style={{ paddingLeft: 16 + hop.depth * 22 }}>
                          <span className={`hop hop-${e.hop}`}>{hop.label}</span>
                        </td>
                        <td className="mono">{e.method} {e.target}</td>
                        <td><span className={`tag ${tone(e.status)}`}>{e.status}</span></td>
                        <td className="num muted">{e.ms} ms</td>
                        <td className="small muted">{e.detail}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </section>
          );
        })}
      </main>
    </>
  );
}
