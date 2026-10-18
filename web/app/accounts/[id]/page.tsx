import Link from "next/link";
import { DataPath } from "@/components/DataPath";
import { Money } from "@/components/Money";
import { SiteHeader } from "@/components/SiteHeader";
import { backend, BackendError } from "@/lib/backend";
import { date, money, rate } from "@/lib/format";
import { requireSession } from "@/lib/session";
import type { Account, Txn } from "@/lib/types";

const WINDOWS = [30, 60, 90];

export default async function AccountPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ days?: string }>;
}) {
  const session = await requireSession();
  const { id } = await params;
  const { days: rawDays } = await searchParams;
  const days = WINDOWS.includes(Number(rawDays)) ? Number(rawDays) : 30;

  let account: Account | null = null;
  let txns: Txn[] = [];
  let error: string | null = null;
  try {
    [account, { transactions: txns }] = await Promise.all([
      backend<Account>(`/api/accounts/${encodeURIComponent(id)}`, { userId: session.uid }),
      backend<{ transactions: Txn[] }>(`/api/accounts/${encodeURIComponent(id)}/transactions?days=${days}`, { userId: session.uid }),
    ]);
  } catch (e) {
    error = (e as BackendError).message;
  }

  const loan = account?.type === "LOAN";
  return (
    <>
      <SiteHeader name={session.name} current="accounts" />
      <main className="wrap">
        <p className="small"><Link href="/">All accounts</Link></p>
        {error && <p className="notice bad" role="alert">{error}</p>}
        {account && (
          <>
            <p className="greeting">{account.typeLabel} {account.maskedNumber}</p>
            <h1 className="headline" style={{ marginBottom: 12 }}>
              {account.nickname}
              <Money value={loan ? account.current : account.available ?? account.current} />
            </h1>
            <p className="muted" style={{ marginTop: 0 }}>
              {loan ? "Principal balance" : `Available. Current balance ${money(account.current)}.`}{" "}
              {rate(account.rate) && `${rate(account.rate)}.`}{" "}
              {account.maturityDate && `${loan ? "Final payment" : "Matures"} ${date(account.maturityDate)}.`}
            </p>

            <section className="section" aria-labelledby="history">
              <div className="section-head">
                <h2 id="history">Transactions</h2>
                <nav className="filters" aria-label="Date range">
                  {WINDOWS.map((w) => (
                    <Link key={w} href={`/accounts/${id}?days=${w}`} aria-current={w === days ? "true" : undefined}>
                      {w} days
                    </Link>
                  ))}
                </nav>
              </div>
              {txns.length === 0 ? (
                <div className="ledger"><p className="empty">No transactions in the last {days} days.</p></div>
              ) : (
                <table className="txns">
                  <thead>
                    <tr><th>Date</th><th>Description</th><th className="num">Balance</th><th className="num">Amount</th></tr>
                  </thead>
                  <tbody>
                    {txns.map((t) => (
                      <tr key={t.id}>
                        <td>{date(t.date)}</td>
                        <td>{t.description}{t.pending && <span className="tag">Pending</span>}</td>
                        <td className="num muted">{money(t.runningBalance)}</td>
                        <td className={`num ${t.direction === "credit" ? "credit" : ""}`}>
                          {t.direction === "credit" ? "+" : "−"}{money(Math.abs(t.amount))}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </section>
          </>
        )}
      </main>
      <DataPath />
    </>
  );
}
