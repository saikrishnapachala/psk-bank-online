import { networkInterfaces } from "node:os";
import { Money } from "@/components/Money";
import { demoUsers } from "@/lib/demoUsers";
import type { Account } from "@/lib/types";

type Customer = { userId: string; name: string; accounts: Account[] };

/** This Mac's Wi-Fi/LAN addresses, so teammates know what to type on their laptops. */
function lanUrls(): string[] {
  return Object.values(networkInterfaces())
    .flat()
    .filter((n) => n && n.family === "IPv4" && !n.internal)
    .map((n) => `http://${n!.address}:3000`);
}

export function TestAccountsTab({ customers, error }: { customers: Customer[]; error: string | null }) {
  const users = demoUsers();
  const password = process.env.DEMO_PASSWORD ?? "(not set)";
  // Hosted (Render sets RENDER_EXTERNAL_URL): one public link. On a Mac: its Wi-Fi addresses.
  const publicUrl = process.env.PUBLIC_URL ?? process.env.RENDER_EXTERNAL_URL;
  const urls = publicUrl ? [publicUrl] : lanUrls();

  return (
    <div className="doc">
      <h2>Run the team demo on three laptops</h2>
      <ol className="steps">
        <li>
          {publicUrl ? "On each laptop, open" : "Keep the laptops on the same Wi-Fi as this Mac and open"}{" "}
          {urls.length ? urls.map((u, i) => <span key={u}>{i > 0 && " or "}<code>{u}</code></span>) : <code>http://&lt;this Mac&apos;s IP&gt;:3000</code>}.
        </li>
        <li>Sign in as a different customer on each laptop, using the usernames below.</li>
        <li>Open Move money and send a few dollars to someone else under To another PSK Bank customer.</li>
        <li>The other laptops update within 15 seconds: new balance, a Received line, and the Fiserv transaction in account history.</li>
      </ol>

      <h2>Test customers</h2>
      <p className="muted small" style={{ marginTop: 0 }}>
        Every account below is a real account in the shared Fiserv Banking Hub Premier sandbox (Org 999990301). The
        balances are live. Full account numbers stay in <code>backend/.env</code>; the app only shows the last four digits.
      </p>
      {error && <p className="notice bad" role="alert">Couldn&apos;t load live balances: {error}</p>}

      <div className="testers">
        {users.map((u) => {
          const c = customers.find((x) => x.userId === u.uid);
          return (
            <section key={u.uid} className="tester" aria-label={u.name}>
              <header>
                <h3>{u.name}</h3>
                <dl className="creds">
                  <dt>Username</dt><dd><code>{u.username}</code></dd>
                  <dt>Password</dt><dd><code>{password}</code></dd>
                </dl>
              </header>
              <table className="doc-table">
                <thead><tr><th>Account</th><th>Type</th><th className="num">Balance</th></tr></thead>
                <tbody>
                  {(c?.accounts ?? []).map((a) => (
                    <tr key={a.id}>
                      <td>
                        <b>{a.nickname}</b> <span className="muted">{a.maskedNumber}</span>
                        {a.status && a.status !== "Active" && <span className="tag">{a.status}</span>}
                        {a.error && <div className="small" style={{ color: "var(--bad)" }}>{a.error}</div>}
                      </td>
                      <td>{a.typeLabel}{a.canTransferTo && a.type === "DDA" && a.id === c?.accounts.find((x) => x.type === "DDA")?.id ? " · receives payments" : ""}</td>
                      <td className="num"><Money value={a.type === "CDA" ? a.current : a.available ?? a.current} /></td>
                    </tr>
                  ))}
                  {!c && <tr><td colSpan={3} className="muted">Not configured in backend/.env (DEMO_USERS / ACCOUNTS_{u.uid}).</td></tr>}
                </tbody>
              </table>
            </section>
          );
        })}
      </div>

      <h2>Good to know</h2>
      <ul className="practices">
        <li>Money sent to a customer lands in their first checking account (marked "receives payments").</li>
        <li>Limits: $25,000 between your own accounts, $5,000 per payment to another customer, $10,000 a day, 6 transfers a minute.</li>
        <li>CDs show their balance but can&apos;t send or receive money online, as at a real bank.</li>
        <li>The sandbox is shared with other Fiserv developers, so you may also see their test transactions in history.</li>
        <li>Sessions end after 15 minutes. Sign in again if a laptop drops back to the sign-in page.</li>
      </ul>
    </div>
  );
}
