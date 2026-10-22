import Link from "next/link";
import { AutoRefresh } from "@/components/AutoRefresh";
import { LinkBankButton } from "@/components/LinkBankButton";
import { Money } from "@/components/Money";
import { SiteHeader } from "@/components/SiteHeader";
import { UnlinkButton } from "@/components/UnlinkButton";
import { backend, BackendError } from "@/lib/backend";
import { date, money, rate } from "@/lib/format";
import { requireSession } from "@/lib/session";
import { pastDue, type Account, type AccountsView, type AuditEvent, type ExternalAccount, type LinkedItem } from "@/lib/types";

const ACTIVITY: Record<string, string> = {
  INTERNAL_TRANSFER: "Transfer between your accounts",
  MEMBER_TRANSFER: "Sent to a PSK Bank customer",
  MEMBER_RECEIVED: "Received from a PSK Bank customer",
  EXTERNAL_FUNDING: "Transfer from another bank",
};

function greeting() {
  const h = new Date().getHours();
  return h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
}

function AccountRow({ a }: { a: Account }) {
  if (a.error) {
    return (
      <div className="row unavailable">
        <div><div className="name">{a.nickname}</div><div className="sub">{a.typeLabel} {a.maskedNumber}</div></div>
        <div className="meta" />
        <div className="amount">Unavailable: {a.error}</div>
      </div>
    );
  }
  const loan = a.type === "LOAN";
  const cd = a.type === "CDA";
  const meta = a.type === "CDA"
    ? `${rate(a.rate)}, matures ${date(a.maturityDate)}`
    : loan ? `${rate(a.rate)}, opened ${date(a.openDate)}` : rate(a.rate);
  return (
    <Link href={`/accounts/${a.id}`} className={`row type-${a.type}`}>
      <div>
        <div className="name">
          {a.nickname}
          {a.status && !["Active", "Open", "Valid"].includes(a.status) && <span className="tag">{a.status}</span>}
          {pastDue(a) > 0 && <span className="tag bad">{money(pastDue(a))} past due</span>}
        </div>
        <div className="sub">{a.product && !/^\d+$/.test(a.product) ? `${a.product} · ` : ""}{a.typeLabel} {a.maskedNumber}</div>
      </div>
      <div className="meta sub">{meta}</div>
      <div className="amount">
        <Money value={loan || cd ? a.current : a.available ?? a.current} />
        <div className="sub">
          {loan ? "principal balance" : cd ? "current balance" : a.available !== undefined && a.current !== undefined && a.available !== a.current
            ? `${money(a.current)} current` : "available"}
        </div>
      </div>
    </Link>
  );
}

export default async function Dashboard() {
  const session = await requireSession();
  const [acc, ext, act] = await Promise.allSettled([
    backend<AccountsView>("/api/accounts", { userId: session.uid }),
    backend<{ accounts: ExternalAccount[]; items: LinkedItem[]; mode: string }>("/api/plaid/accounts", { userId: session.uid }),
    backend<{ events: AuditEvent[] }>("/api/activity", { userId: session.uid }),
  ]);

  const view = acc.status === "fulfilled" ? acc.value : null;
  const accountsError = acc.status === "rejected" ? (acc.reason as BackendError).message : null;
  const deposits = view?.accounts.filter((a) => a.type !== "LOAN") ?? [];
  const loans = view?.accounts.filter((a) => a.type === "LOAN") ?? [];
  const total = deposits.reduce((s, a) => s + ((a.type === "CDA" ? a.current : a.available ?? a.current) ?? 0), 0);
  const externals = ext.status === "fulfilled" ? ext.value : null;
  const events = act.status === "fulfilled" ? act.value.events : [];

  return (
    <>
      <SiteHeader name={session.name} current="accounts" />
      <AutoRefresh />
      <main className="wrap">
        {view?.stale && (
          <p className="notice warn" role="status">
            {view.notice} Last updated {new Date(view.asOf).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}.
          </p>
        )}
        {accountsError && <p className="notice bad" role="alert">{accountsError}</p>}

        <section className="hero" aria-labelledby="hero-title">
          <div className="hero-body">
            <p className="hero-greet">{greeting()}, {session.name.split(" ")[0]}</p>
            <h1 id="hero-title" className="hero-title">
              <span>Total balance</span>
              {view ? <Money value={total} /> : <span className="fig">—</span>}
            </h1>
            {view && (
              <p className="hero-sub">
                Across {deposits.length} deposit {deposits.length === 1 ? "account" : "accounts"}
                {loans.length > 0 && <>, plus {loans.length} home {loans.length === 1 ? "loan" : "loans"}</>}.
                Balances come live from the Fiserv core.
              </p>
            )}
          </div>
          <nav className="quick" aria-label="Quick actions">
            <Link href="/move-money" className="btn">Transfer money</Link>
            {loans.length > 0 && <Link href="/move-money" className="btn ghost">Pay home loan</Link>}
            <a href="#external" className="btn ghost">Link a bank</a>
          </nav>
        </section>

        {view && (
          <section aria-labelledby="deposits">
            <div className="section-head">
              <h2 id="deposits">Your accounts</h2>
            </div>
            <div className="ledger">
              {deposits.map((a) => <AccountRow key={a.id} a={a} />)}
              {deposits.length === 0 && <p className="empty">No deposit accounts on this profile yet.</p>}
            </div>
          </section>
        )}

        {loans.length > 0 && (
          <section className="section" aria-labelledby="loans">
            <h2 id="loans">Home loans</h2>
            <div className="ledger">{loans.map((a) => <AccountRow key={a.id} a={a} />)}</div>
          </section>
        )}

        <section className="section" aria-labelledby="external">
          <div className="section-head">
            <h2 id="external">Accounts at other banks</h2>
            {externals && externals.accounts.length > 0 && <LinkBankButton label="Link another bank" />}
          </div>
          <div className="ledger">
            {externals?.accounts.map((x) => (
              <div className="row" key={x.id}>
                <div><div className="name">{x.name}</div><div className="sub">{x.institution} ••{x.mask}</div></div>
                <div className="meta sub">Linked with Plaid</div>
                <div className="amount">
                  <Money value={x.available ?? x.current} />
                  <div className="sub">available</div>
                </div>
              </div>
            ))}
            {externals && externals.accounts.length === 0 && (
              <div className="empty">
                <p style={{ marginTop: 0 }}>Link an account you own at another bank to see its balance here and move money in.</p>
                <LinkBankButton />
              </div>
            )}
            {!externals && <p className="empty">External accounts are unavailable right now.</p>}
          </div>
          {externals?.items.map((i) => (
            <p key={i.itemId} className="small" style={{ margin: "8px 4px 0" }}>
              <UnlinkButton itemId={i.itemId} institution={i.institution} />
            </p>
          ))}
        </section>

        <section className="section" aria-labelledby="activity">
          <h2 id="activity">Recent money movement</h2>
          <div className="ledger">
            {events.length === 0 && <p className="empty">Money you send or receive shows up here.</p>}
            {events.map((e, i) => (
              <div className="row" key={i}>
                <div>
                  <div className="name">{ACTIVITY[e.type] ?? e.type}</div>
                  <div className="sub">{e.summary}</div>
                </div>
                <div className="meta sub">{new Date(e.ts).toLocaleString("en-US")}</div>
                <div className="amount">
                  <span className={`tag ${e.status === "COMPLETED" ? "ok" : e.status.startsWith("PENDING") || e.status.startsWith("UNKNOWN") ? "" : "bad"}`}>
                    {e.status === "COMPLETED" ? (e.type === "MEMBER_RECEIVED" ? "Received" : "Completed")
                      : e.status.startsWith("PENDING") ? "Pending ACH" : e.status.startsWith("UNKNOWN") ? "Unconfirmed" : "Not sent"}
                  </span>
                  {e.ref && <div className="sub">{e.ref}</div>}
                </div>
              </div>
            ))}
          </div>
        </section>
      </main>
    </>
  );
}
