import Link from "next/link";
import { DataPath } from "@/components/DataPath";
import { LinkBankButton } from "@/components/LinkBankButton";
import { Money } from "@/components/Money";
import { SiteHeader } from "@/components/SiteHeader";
import { UnlinkButton } from "@/components/UnlinkButton";
import { backend, BackendError } from "@/lib/backend";
import { date, money, rate } from "@/lib/format";
import { requireSession } from "@/lib/session";
import type { Account, AccountsView, AuditEvent, ExternalAccount, LinkedItem } from "@/lib/types";

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
  const meta = a.type === "CDA"
    ? `${rate(a.rate)}, matures ${date(a.maturityDate)}`
    : loan ? `${rate(a.rate)}, opened ${date(a.openDate)}` : rate(a.rate);
  return (
    <Link href={`/accounts/${a.id}`} className="row">
      <div><div className="name">{a.nickname}</div><div className="sub">{a.typeLabel} {a.maskedNumber}</div></div>
      <div className="meta sub">{meta}</div>
      <div className="amount">
        <Money value={loan ? a.current : a.available ?? a.current} />
        <div className="sub">
          {loan ? "principal balance" : a.available !== undefined && a.current !== undefined && a.available !== a.current
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
  const total = deposits.reduce((s, a) => s + (a.available ?? a.current ?? 0), 0);
  const externals = ext.status === "fulfilled" ? ext.value : null;
  const events = act.status === "fulfilled" ? act.value.events : [];

  return (
    <>
      <SiteHeader name={session.name} current="accounts" />
      <main className="wrap">
        {view?.stale && (
          <p className="notice warn" role="status">
            {view.notice} Last updated {new Date(view.asOf).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}.
          </p>
        )}
        {accountsError && <p className="notice bad" role="alert">{accountsError}</p>}

        <p className="greeting">{greeting()}, {session.name.split(" ")[0]}.</p>
        {view && (
          <h1 className="headline">
            You have <Money value={total} /> available across {deposits.length} deposit{" "}
            {deposits.length === 1 ? "account" : "accounts"}.
          </h1>
        )}

        {view && (
          <section aria-labelledby="deposits">
            <div className="section-head">
              <h2 id="deposits">Savings and CDs</h2>
              <Link href="/move-money" className="btn quiet">Move money</Link>
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
            {events.length === 0 && <p className="empty">Transfers you make in this session show up here.</p>}
            {events.map((e, i) => (
              <div className="row" key={i}>
                <div>
                  <div className="name">{e.type === "INTERNAL_TRANSFER" ? "Transfer between accounts" : "Transfer from another bank"}</div>
                  <div className="sub">{e.summary}</div>
                </div>
                <div className="meta sub">{new Date(e.ts).toLocaleString("en-US")}</div>
                <div className="amount">
                  <span className={`tag ${e.status === "COMPLETED" ? "ok" : e.status.startsWith("PENDING") ? "" : "bad"}`}>
                    {e.status === "COMPLETED" ? "Completed" : e.status.startsWith("PENDING") ? "Pending ACH" : "Not sent"}
                  </span>
                  {e.ref && <div className="sub">{e.ref}</div>}
                </div>
              </div>
            ))}
          </div>
        </section>
      </main>
      <DataPath />
    </>
  );
}
