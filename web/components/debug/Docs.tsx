import { SystemDiagram } from "./SystemDiagram";

/* Short, plain-English notes for the team. Each claim here matches what the code actually does. */

function Why({ children }: { children: React.ReactNode }) {
  return <p className="why"><b>Why:</b> {children}</p>;
}

export function HowItWorksTab() {
  return (
    <div className="doc">
      <SystemDiagram />

      <h2>The one rule</h2>
      <p className="lead">
        The browser talks only to Next.js. Next.js talks only to the Java service. <b>Only Java calls Fiserv and Plaid,
        and only Java holds their keys.</b> Each layer can be secured, scaled and replaced without touching the others.
      </p>

      <h2>Life of a transfer</h2>
      <ol className="steps">
        <li><b>Browser</b> posts the amount and two opaque account ids (<code>acc-1</code> → <code>acc-2</code>) with a CSRF token and a fresh <code>Idempotency-Key</code>.</li>
        <li><b>BFF</b> checks the session cookie, the Origin header and the CSRF token, keeps only the allowed fields, and adds the user id <i>from the session</i> (never from the body).</li>
        <li><b>Java</b> checks that this user owns both accounts, validates the amount and the $25,000 limit, and rejects a second click with the same key (409, already processing).</li>
        <li><b>Java</b> re-reads the source balance from Fiserv, bypassing the cache, so the funds check is never stale.</li>
        <li><b>Java → Fiserv Add Transfer</b>: an immediate one-time transfer with a debit code on one side and a credit code on the other.</li>
        <li><b>Fiserv</b> posts it on the core and answers EFX 0 (success) or a business error such as 2365 (dormant account).</li>
        <li><b>Java</b> writes an audit line for every attempt and clears its read cache so the next page shows new balances.</li>
        <li>If Fiserv times out, the result is <b>unknown, not failed</b>: no automatic retry, and the customer is told to check activity first.</li>
      </ol>

      <h2>Demo with three customers</h2>
      <p>
        Sign in as <b>alex</b>, <b>jordan</b> and <b>sam</b> on three laptops on the same Wi-Fi, and send money between
        them under Move money. Every dashboard refreshes every 15 seconds while it's open, so the recipient sees the new
        balance, a "Received" line and the Fiserv transaction without reloading. All nine accounts are real accounts in
        the Fiserv sandbox. Usernames, passwords and the address to open are under Debug › Test accounts.
      </p>

      <h2>What each layer owns</h2>
      <div className="cards">
        <div className="card"><h3>Browser</h3><p>Displays data and collects input. Holds no tokens, sees no real account numbers, and can't reach Java or Fiserv.</p></div>
        <div className="card"><h3>Next.js BFF</h3><p>Customer session, CSRF, security headers, and shaping data for each screen. No banking secrets.</p></div>
        <div className="card"><h3>Java service</h3><p>Banking rules: who may see which account, limits, idempotency, audit, resilience and the Fiserv/Plaid mapping.</p></div>
        <div className="card"><h3>Fiserv core</h3><p>The system of record. Balances and postings live here; we never treat our cache as the truth.</p></div>
      </div>
    </div>
  );
}

export function FiservTab() {
  return (
    <div className="doc">
      <h2>How Fiserv Banking Hub works</h2>
      <p className="lead">
        Banking Hub exposes Fiserv cores (Premier, Signature, DNA…) through one normalized API family called <b>EFX</b>.
        We write against EFX once, and a different Fiserv core needs mapping changes, not a rewrite.
      </p>
      <div className="cards">
        <div className="card"><h3>1. Get a token</h3><p><code>POST /fts-apim/oauth2/v2</code> with the API key and secret (client credentials). The token lasts about 15 minutes; Java reuses it and refreshes it 60s early, or once on a 401.</p></div>
        <div className="card"><h3>2. Send EFXHeader</h3><p>Every call carries <code>EFXHeader</code> JSON: <code>OrganizationId</code> picks the bank (Premier sandbox 999990301), plus a unique <code>TrnId</code> per call for tracing.</p></div>
        <div className="card"><h3>3. Read with /secured</h3><p>Reads are <code>POST …/secured</code> with the account number in the body, so account numbers never land in URLs, proxies or access logs.</p></div>
        <div className="card"><h3>4. Read the Status block</h3><p>HTTP 200 isn't enough. Each reply has <code>Status.StatusCode</code>: 0 = success, 1120 = not on file, 2365 = account status blocks it, 1090 = invalid value.</p></div>
      </div>

      <h2>APIs this app uses</h2>
      <table className="doc-table">
        <thead><tr><th>Screen</th><th>Fiserv API</th><th>Notes</th></tr></thead>
        <tbody>
          <tr><td>Dashboard, account page</td><td className="mono">acctservice/acctmgmt/accounts/secured</td><td>Balances (available, ledger, accrued interest), rate, term, maturity, status, loan past-due</td></tr>
          <tr><td>Transaction history</td><td className="mono">accttranservice/acctmgmt/acctTrn/secured</td><td>Date-ranged; Java also enforces the window because the sandbox may ignore it</td></tr>
          <tr><td>Move money</td><td className="mono">xferservice/payments/transfers</td><td>Immediate transfer: <code>ExpediteInd</code> plus a per-leg <code>TrnCode</code> (savings debit 147, credit 120)</td></tr>
        </tbody>
      </table>

      <h2>Best practices we follow</h2>
      <ul className="practices">
        <li><b>Core is the source of truth.</b> Cache reads for 60s at most, and always re-read before moving money. <Why>a stale balance must never approve a transfer.</Why></li>
        <li><b>Never auto-retry money movement.</b> A timeout may have posted. <Why>a blind retry can move money twice; reads are safe to retry, writes are not.</Why></li>
        <li><b>Idempotency key on every transfer</b>, with in-flight de-duplication. <Why>double clicks and flaky networks are normal on mobile.</Why></li>
        <li><b>Circuit breaker</b>: 3 failures → fail fast for 30s, show last known balances with a banner, pause transfers. <Why>a slow core shouldn't take the whole site down.</Why></li>
        <li><b>Respect rate limits.</b> The shared trial sandbox returns 429 quickly, so a 429 falls back to the last good reply. <Why>production has quotas too; plan for them.</Why></li>
        <li><b>Map every EFX code to a customer message</b> (not found, dormant, invalid). <Why>"Error 2365" means nothing to a customer.</Why></li>
        <li><b>Respect account status.</b> Dormant or closed accounts are shown but can't be used for transfers. <Why>the core rejects them anyway; the UI shouldn't offer them.</Why></li>
        <li><b>Anti-corruption layer.</b> <code>EfxMapper</code> is the only class that knows EFX field names. <Why>a core migration or API version change touches one file.</Why></li>
      </ul>

      <h2>Known limits</h2>
      <ul className="practices">
        <li>The Premier API set has <b>no ACH origination</b>, so pulling money from another bank is Plaid-verified but simulated.</li>
        <li>Loan payment transaction codes aren't published in the samples, so mortgage payments haven't been verified against the sandbox.</li>
        <li>The trial sandbox is shared: other developers' test transfers show up in these accounts' history.</li>
      </ul>
    </div>
  );
}

export function BffTab() {
  return (
    <div className="doc">
      <h2>What a BFF is</h2>
      <p className="lead">
        A <b>Backend for Frontend</b> is a thin server that belongs to the web app. It serves pages and a few API routes
        for this UI only, and it talks to the real backend on the browser's behalf.
      </p>

      <h2>Why a BFF instead of the browser calling Java directly</h2>
      <table className="doc-table">
        <thead><tr><th></th><th>Browser → Java directly</th><th>Browser → BFF → Java (ours)</th></tr></thead>
        <tbody>
          <tr><td>Tokens</td><td>Access tokens live in browser JS (XSS risk)</td><td>Only an HttpOnly cookie; JS can't read it</td></tr>
          <tr><td>Attack surface</td><td>Every Java endpoint is on the internet</td><td>Java stays on a private network</td></tr>
          <tr><td>Data shaping</td><td>The browser makes many calls and stitches them</td><td>The server renders the page with one round trip</td></tr>
          <tr><td>CORS</td><td>Needs careful CORS rules</td><td>Same origin, no CORS</td></tr>
        </tbody>
      </table>

      <h2>Best practices we follow</h2>
      <ul className="practices">
        <li><b>Signed session cookie</b>: HMAC-signed, <code>HttpOnly</code>, <code>SameSite=Lax</code>, <code>Secure</code> in production, 15-minute lifetime. <Why>stolen or tampered cookies are rejected, and idle sessions end.</Why></li>
        <li><b>CSRF token bound into the session</b> plus an <b>Origin check</b> on every change. <Why>another site can't submit a transfer using your cookie.</Why></li>
        <li><b>Field whitelist</b>: only named fields are forwarded, and the user id comes from the session. <Why>a crafted body can't act as another customer.</Why></li>
        <li><b>No secrets in Next.js</b>: Fiserv and Plaid keys exist only in <code>backend/.env</code>. <Why>a web-tier bug can't leak core credentials.</Why></li>
        <li><b>Server-side rendering</b> for account pages, with <code>cache: no-store</code>. <Why>balances are fresh per request and never cached in a CDN.</Why></li>
        <li><b>Security headers</b>: CSP (Plaid CDN only), HSTS, <code>X-Frame-Options: DENY</code>, <code>nosniff</code>. <Why>they block clickjacking, injection and downgrade attacks.</Why></li>
        <li><b>Request id on every hop</b>, generated by the proxy and never taken from the client. <Why>support can follow one customer complaint end to end.</Why></li>
        <li><b>One error shape</b> (<code>{"{ error: { code, message, requestId } }"}</code>). <Why>the UI shows consistent messages and support gets the id.</Why></li>
      </ul>

      <h2>Why Java behind the BFF</h2>
      <p>
        Banking rules (entitlements, limits, idempotency, audit) belong in one hardened service that any channel can share:
        web, mobile app, IVR. The BFF stays thin and specific to the web. The Java code maps one-to-one onto Spring Boot
        for production.
      </p>
    </div>
  );
}

const CASES: [string, string, string][] = [
  ["Fiserv down or timing out", "15s timeout; after 3 failures the breaker opens for 30s. Last known balances are shown with a banner, and transfers pause.", "done"],
  ["Traffic spikes", "At most 4 Fiserv calls run at once; extra requests wait up to 10s for a slot instead of tripping the provider's rate limit. Identical reads already in flight are shared. Tested: 30 concurrent dashboard loads, all 200, none rate limited.", "done"],
  ["Too many transfers (velocity)", "6 transfers per customer per minute; beyond that, 429 with a clear message. Tested: a burst of 8 gave 5 completed and 3 refused.", "done"],
  ["Sending to another customer", "The recipient is a payee id that Java resolves; the browser never sees their account number. $5,000 per transfer and $10,000 a day. An unconfirmed send keeps its daily allowance reserved.", "done"],
  ["Confirmation numbers under load", "Time-ordered plus 4 random characters, so two transfers in the same millisecond never collide.", "done"],
  ["Fiserv rate limit (429)", "Reads fall back to the last good reply when there is one; a transfer fails cleanly and is never retried.", "done"],
  ["Double click on Transfer", "The same Idempotency-Key returns the first result; a concurrent duplicate gets 409. Tested: 3 identical requests at once gave 1 transfer and 2 refusals.", "done"],
  ["Timeout while a transfer posts", "Marked unknown, audited, never retried; the customer is told to check activity.", "done"],
  ["Insufficient funds", "Checked against a fresh core read before calling Fiserv; the core checks again.", "done"],
  ["Over the limit or a bad amount", "Rejected: above $25,000, zero or negative, or more than 2 decimals.", "done"],
  ["Someone else's account id", "Entitlements are checked on every call; the request is refused with 403.", "done"],
  ["Dormant or closed account", "Shown with a status tag; removed from transfer choices; the core's 2365 is mapped to a message.", "done"],
  ["Account not on file", "EFX 1120 is shown as unavailable instead of a blank $0.", "done"],
  ["Session expired", "Pages redirect to sign-in; API calls return 401 with a clear message.", "done"],
  ["Cross-site request (CSRF)", "Blocked by the Origin check and the session-bound CSRF token.", "done"],
  ["Java service down", "The BFF shows that the banking service isn't reachable and keeps the error shape.", "done"],
  ["Login and step-up MFA", "Demo uses a password. Production: OIDC (auth code + PKCE) and MFA before money movement.", "prod"],
  ["Durable idempotency and audit", "Demo keeps these in memory. Production: Postgres, plus an append-only audit store shipped to the SIEM.", "prod"],
  ["Secrets", "Demo uses .env. Production: Vault or KMS with rotation; Plaid tokens encrypted at rest.", "prod"],
  ["BFF ↔ Java trust", "Demo uses a shared secret on localhost. Production: mTLS on a private subnet with an egress allowlist.", "prod"],
  ["Observability", "Demo keeps an in-memory log. Production: OpenTelemetry traces, metrics and alerts on breaker state and error rates.", "prod"],
  ["Fraud and AML checks", "Not in the demo. Production: risk scoring, new-payee holds, step-up MFA and sanctions screening before money leaves.", "prod"],
  ["Horizontal scale", "Demo limits, caches and idempotency live in one process. Production: Redis or Postgres so every instance shares them, and a queue for bulk payments.", "prod"],
];

export function RobustnessTab() {
  return (
    <div className="doc">
      <h2>How the app handles real-world cases</h2>
      <p className="lead">What a production online bank has to get right, and where this demo stands on each.</p>
      <table className="doc-table cases">
        <thead><tr><th>Case</th><th>What happens</th><th>Status</th></tr></thead>
        <tbody>
          {CASES.map(([c, what, s]) => (
            <tr key={c}>
              <td><b>{c}</b></td>
              <td>{what}</td>
              <td><span className={`tag ${s === "done" ? "ok" : ""}`}>{s === "done" ? "In demo" : "Before go-live"}</span></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
