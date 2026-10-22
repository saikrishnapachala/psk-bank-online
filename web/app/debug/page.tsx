import Link from "next/link";
import { BffTab, FiservTab, HowItWorksTab, RobustnessTab } from "@/components/debug/Docs";
import { TestAccountsTab } from "@/components/debug/TestAccounts";
import { LiveToggle } from "@/components/LiveToggle";
import { LogExplorer } from "@/components/LogExplorer";
import { OutageToggle } from "@/components/OutageToggle";
import { SiteHeader } from "@/components/SiteHeader";
import { backend, BackendError, health } from "@/lib/backend";
import { requireSession } from "@/lib/session";
import { bffEvents, type TraceEvent } from "@/lib/trace";
import type { Account } from "@/lib/types";

const TABS = [
  { key: "logs", label: "Logs" },
  { key: "accounts", label: "Test accounts" },
  { key: "how", label: "How it works" },
  { key: "fiserv", label: "Fiserv" },
  { key: "bff", label: "BFF" },
  { key: "robust", label: "Robustness" },
] as const;
type Tab = (typeof TABS)[number]["key"];

export default async function DebugPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const session = await requireSession();
  const { tab: raw } = await searchParams;
  const tab: Tab = TABS.some((t) => t.key === raw) ? (raw as Tab) : "logs";
  const h = await health();

  let error: string | null = null;
  let customers: { userId: string; name: string; accounts: Account[] }[] = [];
  if (tab === "accounts") {
    try {
      customers = (await backend<{ customers: typeof customers }>("/api/dev/customers", { userId: session.uid })).customers;
    } catch (e) {
      error = (e as BackendError).message;
    }
  }
  let java: TraceEvent[] = [];
  if (tab === "logs") {
    try {
      java = (await backend<{ events: TraceEvent[] }>("/api/dev/trace", { userId: session.uid })).events;
    } catch (e) {
      error = (e as BackendError).message;
    }
  }

  return (
    <>
      <SiteHeader name={session.name} current="debug" />
      <main className="wrap wide">
        <div className="section-head">
          <h1 style={{ margin: 0 }}>Debug</h1>
          {tab === "logs" && <LiveToggle />}
        </div>

        <ul className="status-strip" aria-label="System status">
          <li className={h ? "ok" : "bad"}>Java service <b>{h ? "up" : "unreachable"}</b></li>
          <li className={h?.fiservCircuitOpen ? "bad" : h?.fiserv === "live" ? "ok" : ""}>
            Fiserv <b>{h?.fiservCircuitOpen ? "circuit open" : h?.fiserv ?? "?"}</b>
          </li>
          <li className={h?.plaid === "live" ? "ok" : ""}>Plaid <b>{h?.plaid ?? "?"}</b></li>
          {h?.fiserv === "mock" && <li><OutageToggle on={!!h.fiservCircuitOpen} /></li>}
        </ul>

        <nav className="tabs" aria-label="Debug sections">
          {TABS.map((t) => (
            <Link key={t.key} href={`/debug?tab=${t.key}`} aria-current={t.key === tab ? "page" : undefined}>{t.label}</Link>
          ))}
        </nav>

        {tab === "logs" && (
          <>
            <p className="muted small" style={{ margin: "0 0 12px" }}>
              Browser → BFF → Java → Fiserv / Plaid, newest first. Hover a line for what it does, click it for the full
              explanation, or click a request id to follow one request end to end.
            </p>
            {error && <p className="notice bad" role="alert">Java trace unavailable: {error}</p>}
            <LogExplorer events={[...bffEvents(), ...java]} />
          </>
        )}
        {tab === "accounts" && <TestAccountsTab customers={customers} error={error} />}
        {tab === "how" && <HowItWorksTab />}
        {tab === "fiserv" && <FiservTab />}
        {tab === "bff" && <BffTab />}
        {tab === "robust" && <RobustnessTab />}
      </main>
    </>
  );
}
