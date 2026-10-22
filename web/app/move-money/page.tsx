import { FundingForm } from "@/components/FundingForm";
import { MemberTransferForm } from "@/components/MemberTransferForm";
import { SiteHeader } from "@/components/SiteHeader";
import { TransferForm } from "@/components/TransferForm";
import { backend, BackendError } from "@/lib/backend";
import { requireSession } from "@/lib/session";
import type { AccountsView, ExternalAccount, Payee } from "@/lib/types";

export default async function MoveMoney() {
  const session = await requireSession();
  const [acc, ext, pay] = await Promise.allSettled([
    backend<AccountsView>("/api/accounts", { userId: session.uid }),
    backend<{ accounts: ExternalAccount[] }>("/api/plaid/accounts", { userId: session.uid }),
    backend<{ payees: Payee[] }>("/api/payees", { userId: session.uid }),
  ]);
  const payees = pay.status === "fulfilled" ? pay.value.payees : [];
  const view = acc.status === "fulfilled" ? acc.value : null;
  const externals = ext.status === "fulfilled" ? ext.value.accounts : [];

  return (
    <>
      <SiteHeader name={session.name} current="move-money" />
      <main className="wrap">
        <h1 className="headline" style={{ marginBottom: 24 }}>Move money</h1>
        {view?.stale && (
          <p className="notice warn" role="status">
            {view.notice} Last updated {new Date(view.asOf).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}.
          </p>
        )}
        {acc.status === "rejected" && <p className="notice bad" role="alert">{(acc.reason as BackendError).message}</p>}
        {view && (
          <div className="panels">
            <section className="panel" aria-labelledby="between">
              <h2 id="between">Between your accounts</h2>
              <p className="lead">Checking, savings and money market, moved instantly.</p>
              <TransferForm accounts={view.accounts} disabled={view.stale} />
            </section>
            <section className="panel" aria-labelledby="member">
              <h2 id="member">To another PSK Bank customer</h2>
              <p className="lead">Pay someone who banks with us. The money arrives in their account right away.</p>
              <MemberTransferForm accounts={view.accounts} payees={payees} disabled={view.stale} />
            </section>
            <section className="panel" aria-labelledby="inbound">
              <h2 id="inbound">From another bank</h2>
              <p className="lead">Pull money in from an account you linked with Plaid.</p>
              <FundingForm externals={externals} accounts={view.accounts} />
            </section>
          </div>
        )}
      </main>
    </>
  );
}
