"use client";

import { Fragment, useMemo, useState } from "react";
import { explain, explainStatus } from "@/lib/apiCatalog";
import type { TraceEvent } from "@/lib/trace";

const HOPS = [
  { key: "browser-bff", label: "Browser → BFF", short: "WEB" },
  { key: "bff-java", label: "BFF → Java", short: "BFF" },
  { key: "java-fiserv", label: "Java → Fiserv", short: "FSV" },
  { key: "java-plaid", label: "Java → Plaid", short: "PLD" },
] as const;
const DEPTH: Record<string, number> = { "browser-bff": 0, "bff-java": 1, "java-fiserv": 2, "java-plaid": 2 };

type Level = "all" | "error" | "ok" | "cache";

function level(status: string): Exclude<Level, "all"> | "pending" {
  if (status === "cache") return "cache";
  if (status === "…") return "pending";
  return /^(EFX 0|HTTP 2|2\d\d$|OK|render)/.test(status) ? "ok" : "error";
}

/** Puts each Java -> Fiserv/Plaid call under the BFF -> Java request whose time window contains it. */
function nest(evs: TraceEvent[]): TraceEvent[] {
  const t = (e: TraceEvent) => Date.parse(e.ts);
  const sorted = [...evs].sort((a, b) => a.ts.localeCompare(b.ts));
  const children = sorted.filter((e) => e.hop.startsWith("java-"));
  const out = sorted.filter((e) => e.hop === "browser-bff");
  for (const p of sorted.filter((e) => e.hop === "bff-java")) {
    out.push(p);
    for (const c of children.filter((c) => t(c) >= t(p) && t(c) <= t(p) + p.ms)) {
      out.push(c);
      children.splice(children.indexOf(c), 1);
    }
  }
  return [...out, ...children, ...sorted.filter((e) => !out.includes(e) && !children.includes(e))];
}

const clock = (iso: string) => {
  const d = new Date(iso);
  return d.toLocaleTimeString("en-US", { hour12: false }) + "." + String(d.getMilliseconds()).padStart(3, "0");
};

export function LogExplorer({ events }: { events: TraceEvent[] }) {
  const [hops, setHops] = useState<string[]>(HOPS.map((h) => h.key));
  const [lvl, setLvl] = useState<Level>("all");
  const [q, setQ] = useState("");
  const [rid, setRid] = useState<string | null>(null);
  const [slowOnly, setSlowOnly] = useState(false);
  const [open, setOpen] = useState<string | null>(null);

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const base = rid ? nest(events.filter((e) => e.rid === rid)) : [...events].sort((a, b) => b.ts.localeCompare(a.ts));
    return base.filter((e) => {
      if (!hops.includes(e.hop)) return false;
      if (lvl !== "all" && level(e.status) !== lvl) return false;
      if (slowOnly && e.ms < 1000) return false;
      if (!needle) return true;
      return [e.method, e.target, e.status, e.detail, e.rid].some((v) => v?.toLowerCase().includes(needle));
    });
  }, [events, hops, lvl, q, rid, slowOnly]);

  const fiserv = events.filter((e) => e.hop === "java-fiserv" && e.status !== "cache");
  const stats = {
    requests: events.filter((e) => e.hop === "browser-bff").length,
    errors: events.filter((e) => level(e.status) === "error").length,
    fiserv: fiserv.length,
    cache: events.filter((e) => e.status === "cache").length,
    avg: fiserv.length ? Math.round(fiserv.reduce((s, e) => s + e.ms, 0) / fiserv.length) : 0,
  };
  const maxMs = Math.max(1, ...rows.map((e) => e.ms));
  const reset = () => { setHops(HOPS.map((h) => h.key)); setLvl("all"); setQ(""); setSlowOnly(false); };
  const openTrace = (id: string) => { reset(); setRid(id); };
  const filtered = hops.length < HOPS.length || lvl !== "all" || q !== "" || slowOnly;
  const toggleHop = (k: string) => setHops((h) => (h.includes(k) ? h.filter((x) => x !== k) : [...h, k]));

  return (
    <div className="lx">
      <div className="lx-stats">
        <div><b>{stats.requests}</b><span>browser requests</span></div>
        <div><b>{stats.fiserv}</b><span>Fiserv calls</span></div>
        <div><b>{stats.avg} ms</b><span>avg Fiserv latency</span></div>
        <div><b>{stats.cache}</b><span>cache hits</span></div>
        <div className={stats.errors ? "bad" : ""}><b>{stats.errors}</b><span>errors</span></div>
      </div>

      <div className="lx-bar" role="toolbar" aria-label="Log filters">
        <input
          type="search"
          placeholder="Search path, status, detail, request id…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          aria-label="Search logs"
        />
        <div className="lx-chips" role="group" aria-label="Layers">
          {HOPS.map((h) => (
            <button key={h.key} className={`chip hop-${h.key}`} aria-pressed={hops.includes(h.key)} onClick={() => toggleHop(h.key)}>
              {h.label} <span>{events.filter((e) => e.hop === h.key).length}</span>
            </button>
          ))}
        </div>
        <div className="lx-chips" role="group" aria-label="Status">
          {(["all", "error", "ok", "cache"] as Level[]).map((l) => (
            <button key={l} className="chip" aria-pressed={lvl === l} onClick={() => setLvl(l)}>
              {l === "all" ? "All" : l === "error" ? "Errors" : l === "ok" ? "Success" : "Cache"}
            </button>
          ))}
          <button className="chip" aria-pressed={slowOnly} onClick={() => setSlowOnly(!slowOnly)}>Slow &gt;1s</button>
        </div>
        {filtered && <button className="linklike small" onClick={reset}>Reset filters</button>}
        <span className="small muted" style={{ marginLeft: "auto" }}>{rows.length} lines</span>
      </div>

      {rid && (
        <p className="lx-trace">
          Showing one request <code>{rid}</code> as a trace, oldest first. Click any line to see what it does.{" "}
          <button className="linklike" onClick={() => setRid(null)}>Back to all logs</button>
        </p>
      )}

      <div className="lx-table" role="region" aria-label="Log lines" tabIndex={0}>
        <table>
          <colgroup>
            <col style={{ width: 112 }} /><col style={{ width: 50 }} /><col /><col style={{ width: 76 }} />
            <col style={{ width: 118 }} /><col className="c-detail" style={{ width: "24%" }} /><col style={{ width: 78 }} />
          </colgroup>
          <thead>
            <tr><th>Time</th><th>Layer</th><th>Request</th><th>Status</th><th className="num">Duration</th><th>Detail</th><th>Request id</th></tr>
          </thead>
          <tbody>
            {rows.map((e, i) => {
              const hop = HOPS.find((h) => h.key === e.hop);
              const info = explain(e.hop, e.target);
              const key = `${e.ts}|${e.hop}|${e.target}|${e.ms}|${e.rid}`;
              const isOpen = open === key;
              return (
                <Fragment key={i}>
                <tr
                  className={`lv-${level(e.status)} clickable${isOpen ? " open" : ""}`}
                  onClick={() => setOpen(isOpen ? null : key)}
                  title={`${info.title}: ${info.what}`}
                  aria-expanded={isOpen}
                >
                  <td className="t">{clock(e.ts)}</td>
                  <td><span className={`hop hop-${e.hop}`} title={hop?.label}>{hop?.short ?? e.hop}</span></td>
                  <td className="req" style={rid ? { paddingLeft: 8 + (DEPTH[e.hop] ?? 1) * 16 } : undefined}>
                    <span className="what">{info.title}</span> <span className="m">{e.method}</span> {e.target}
                  </td>
                  <td><span className={`st st-${level(e.status)}`}>{e.status}</span></td>
                  <td className="num">
                    <span className="dur"><i style={{ width: `${(e.ms / maxMs) * 100}%` }} /></span>
                    {e.ms} ms
                  </td>
                  <td className="d" title={e.detail}>{e.detail}</td>
                  <td>
                    {e.rid ? (
                      <button className="linklike mono" onClick={(ev) => { ev.stopPropagation(); openTrace(e.rid!); }} title="Show this request as a trace">
                        {e.rid.slice(0, 8)}
                      </button>
                    ) : "—"}
                  </td>
                </tr>
                {isOpen && (
                  <tr className="lx-detail">
                    <td colSpan={7}>
                      <div className="lx-explain">
                        <div>
                          <h3>{info.title} <span className={`hop hop-${e.hop}`}>{hop?.label ?? e.hop}</span></h3>
                          <p>{info.what}</p>
                        </div>
                        <dl>
                          <dt>Call</dt><dd className="mono">{e.method} {e.target}</dd>
                          {info.external && (<><dt>Provider API</dt><dd>{info.external}</dd></>)}
                          <dt>Status</dt><dd><b className={`st st-${level(e.status)}`}>{e.status}</b> · {explainStatus(e.status)}</dd>
                          <dt>Duration</dt><dd>{e.ms} ms</dd>
                          {e.detail && (<><dt>Detail</dt><dd>{e.detail}</dd></>)}
                          <dt>Request id</dt><dd className="mono">{e.rid ?? "—"}</dd>
                          <dt>Time</dt><dd>{new Date(e.ts).toLocaleString()}</dd>
                        </dl>
                      </div>
                    </td>
                  </tr>
                )}
                </Fragment>
              );
            })}
            {rows.length === 0 && (
              <tr><td colSpan={7} className="empty">No log lines match these filters.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
