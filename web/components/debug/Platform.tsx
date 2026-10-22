/* Debug tabs that explain how customers, accounts, the Java service and the APIs fit together.
   Every statement matches the code; file names are given so the team can check. */

function Why({ children }: { children: React.ReactNode }) {
  return <p className="why"><b>Why:</b> {children}</p>;
}

export function AccountsAuthTab() {
  return (
    <div className="doc">
      <h2>Two different logins</h2>
      <p className="lead">
        Fiserv never learns who the customer is. It only knows that the <b>PSK Bank app</b> is calling. Deciding which
        customer may see which account is our job, on every single request.
      </p>
      <table className="doc-table">
        <thead><tr><th></th><th>Who proves identity</th><th>To whom</th><th>How (demo)</th><th>How (production)</th></tr></thead>
        <tbody>
          <tr><td><b>Customer login</b></td><td>Alex, Jordan or Sam</td><td>PSK Bank (Next.js BFF)</td><td>Username + password, then a signed 15-minute session cookie</td><td>OIDC with the bank's identity provider, plus MFA before money moves</td></tr>
          <tr><td><b>App login</b></td><td>The PSK Bank Java service</td><td>Fiserv Banking Hub</td><td>OAuth client credentials: API key + secret, giving a ~15-minute bearer token</td><td>Same, with keys in a vault and rotated; mTLS where Fiserv offers it</td></tr>
        </tbody>
      </table>
      <Why>one Fiserv key serves every customer, so if the bank didn't check entitlements, any signed-in customer could read any account in the core.</Why>

      <h2>How one customer has many accounts</h2>
      <ol className="steps">
        <li>Alex signs in. The session cookie now carries user id <code>u-alex</code>, and nothing else about accounts.</li>
        <li>The BFF calls Java with <code>X-User-Id: u-alex</code>. The id comes from the session, never from the browser.</li>
        <li>Java's <code>Entitlements</code> looks up Alex's accounts: a list of Fiserv keys (account type + account number), each with an opaque id <code>acc-1</code>, <code>acc-2</code>…</li>
        <li>Java sends one Fiserv Account Inquiry per account in parallel (at most 4 at a time) and merges the replies into one list.</li>
        <li>The browser receives nicknames, masked numbers (<code>••2605</code>) and balances. It never sees a real account number.</li>
      </ol>

      <h2>How customers stay separated</h2>
      <ul className="practices">
        <li><b>Opaque ids are per customer.</b> Alex's <code>acc-1</code> and Jordan's <code>acc-1</code> are different accounts. Java resolves the id against the signed-in customer's own list, so guessing an id gets a 403.</li>
        <li><b>Every call is checked.</b> Account details, history and both sides of a transfer go through <code>entitlements.require(user, id)</code> in Java.</li>
        <li><b>Paying someone never exposes their account.</b> The sender picks a payee id (<code>payee-u-jordan</code>); Java looks up where Jordan receives money, on the server.</li>
        <li><b>Fiserv keys stay in Java.</b> The web tier has no Fiserv credentials, so even a bug in Next.js can't call the core directly.</li>
      </ul>

      <h2>Can we add accounts manually?</h2>
      <p><b>Yes, today by configuration.</b> Each customer's accounts are one setting:</p>
      <pre className="code">ACCOUNTS_u-alex=DDA:1081372605:Everyday Checking;SDA:8282801916:Money Market;CDA:1082998135:12-Month CD</pre>
      <ol className="steps">
        <li>Pick an account that exists in the Fiserv sandbox (the Banking Hub Postman collection lists sample account numbers).</li>
        <li>Add <code>TYPE:NUMBER:Nickname</code> to that customer: <code>DDA</code> checking, <code>SDA</code> savings, <code>CDA</code> CD.</li>
        <li>Put it in <code>backend/.env</code> locally, or the <code>ACCOUNTS_U_ALEX</code> environment variable on Render, then restart.</li>
        <li>Run <code>./run.sh --check</code>. Each account should print OK; "1120" means the number or type isn't in the core.</li>
        <li>To add a customer, add them to <code>DEMO_USERS</code> in both the backend and the web settings.</li>
      </ol>
      <p>
        <b>What we can't do from the app:</b> open a brand-new account in the core. Banking Hub has Party and Account
        services for that, but this demo doesn't call them.
      </p>
      <p>
        <b>Production version:</b> when a customer enrolls in online banking, the bank finds their Fiserv party (customer
        record), reads the accounts linked to that party, and stores the list in an enrollment database. New accounts then
        show up without anyone editing settings. Only the source of the list changes; the checks above stay the same.
      </p>

      <h2>How we evaluate the Fiserv integration</h2>
      <table className="doc-table">
        <thead><tr><th>Check</th><th>What it proves</th><th>How to run</th></tr></thead>
        <tbody>
          <tr><td><b>Smoke test</b></td><td>The key and secret get a token, and every configured account answers an inquiry</td><td className="mono">cd backend && ./run.sh --check</td></tr>
          <tr><td><b>Contract test</b></td><td>Requests match Fiserv's documented shape (Basic-auth token, Bearer, EFXHeader, EFX bodies), using local fakes</td><td className="mono">backend/test/contract-test.sh</td></tr>
          <tr><td><b>Live logs</b></td><td>Each Fiserv call's EFX status, timing and cache hits, as they happen</td><td>Debug › Logs, filter Java → Fiserv</td></tr>
          <tr><td><b>Real transfer</b></td><td>Money moves on the core and shows up in Fiserv history on both sides</td><td>Send $1 between two test customers</td></tr>
          <tr><td><b>Load test</b></td><td>No rate-limit errors under a spike; duplicates and bursts are refused safely</td><td>30 parallel dashboards: all OK; 3 identical transfers: 1 sent</td></tr>
        </tbody>
      </table>
    </div>
  );
}

export function JavaTab() {
  return (
    <div className="doc">
      <h2>What the Java service does</h2>
      <p className="lead">
        It is the bank's rules engine and the only gateway to Fiserv. The web tier asks for tasks ("show my accounts",
        "send $20 to Jordan"); Java decides whether that's allowed, talks to Fiserv, and returns clean JSON.
      </p>
      <div className="cards">
        <div className="card"><h3>core/</h3><p><code>Router</code> (HTTP + internal-token check), <code>Json</code>, <code>Config</code>, <code>CircuitBreaker</code>, <code>RateLimiter</code>, <code>Trace</code> (the Logs tab), <code>HttpJson</code> (timeouts).</p></div>
        <div className="card"><h3>banking/</h3><p><code>Entitlements</code> (who owns what), <code>CoreBankingService</code> (reads: cache, coalescing, 4-call gate), <code>TransferService</code> (money rules), <code>AuditLog</code>.</p></div>
        <div className="card"><h3>fiserv/</h3><p><code>FiservTransport</code> with a live and a mock version, <code>EfxMapper</code> (the only class that knows EFX field names), <code>FiservPaths</code>.</p></div>
        <div className="card"><h3>plaid/</h3><p><code>PlaidService</code> with live and mock transports. Plaid access tokens stay here.</p></div>
      </div>

      <h2>A read, step by step</h2>
      <ol className="steps">
        <li><code>Router</code> checks <code>X-Internal-Token</code> (constant-time compare) and takes the user id from <code>X-User-Id</code>.</li>
        <li><code>Entitlements</code> turns <code>acc-2</code> into the real Fiserv keys for this user, or refuses with 403.</li>
        <li><code>CoreBankingService</code> answers from its 60s cache if it can, joins an identical call already in flight, or waits for one of 4 Fiserv slots.</li>
        <li>The circuit breaker lets the call through unless Fiserv has failed 3 times in a row (then it fails fast for 30s).</li>
        <li><code>LiveFiservTransport</code> adds the bearer token (fetching a new one if needed) and the <code>EFXHeader</code>, then POSTs to Banking Hub.</li>
        <li><code>EfxMapper</code> reads the EFX Status and turns the record into an <code>Account</code> or <code>Txn</code> list for the UI.</li>
      </ol>

      <h2>A transfer, step by step</h2>
      <ol className="steps">
        <li><b>Once only:</b> the same Idempotency-Key returns the first result; a duplicate in flight gets 409; more than 6 a minute gets 429.</li>
        <li><b>Rules:</b> amount format and limits, both accounts entitled (or the payee resolved), source can send, target can receive.</li>
        <li><b>Safety:</b> transfers pause if the breaker is open; the source balance is re-read from Fiserv, bypassing the cache.</li>
        <li><b>Move:</b> one Fiserv Add Transfer, with debit and credit codes and a description each side sees in history.</li>
        <li><b>Record:</b> an audit line for every attempt (both people for a payment), the read cache cleared, and a confirmation number returned.</li>
        <li><b>Timeout:</b> reported as unknown and never retried, because the money may already have moved.</li>
      </ol>

      <h2>Why plain Java, and what production looks like</h2>
      <p>
        The service has no libraries at all (just the JDK) because the machine it was first built on couldn't download
        from Maven. Every class maps one-to-one onto Spring Boot: <code>Router</code> becomes <code>@RestController</code>,
        <code>HttpJson</code> becomes <code>RestClient</code>, <code>Json</code> becomes Jackson, <code>CircuitBreaker</code>
        becomes Resilience4j, and <code>Config</code> becomes <code>application.yml</code> plus Vault.
      </p>
    </div>
  );
}

const MAP: [string, string, string, string][] = [
  ["Sign in / sign out", "POST /api/auth/login, /logout", "none", "none"],
  ["Accounts dashboard", "page GET /", "GET /api/accounts, /api/activity, /api/plaid/accounts", "Account Inquiry × each account"],
  ["Account details page", "page GET /accounts/[id]", "GET /api/accounts/{id}, /api/accounts/{id}/transactions", "Account Inquiry + Transaction History"],
  ["Move money page", "page GET /move-money", "GET /api/accounts, /api/payees, /api/plaid/accounts", "Account Inquiry × each account"],
  ["Transfer between my accounts", "POST /api/transfers/internal", "POST /api/transfers/internal", "Account Inquiry (funds) + Add Transfer"],
  ["Send to another customer", "POST /api/transfers/member", "POST /api/transfers/member", "Account Inquiry (funds) + Add Transfer"],
  ["Link another bank", "POST /api/plaid/link-token, /exchange, /sandbox-link", "same paths", "none (Plaid)"],
  ["Pull money from another bank", "POST /api/transfers/external", "POST /api/transfers/external", "none (Plaid Auth; ACH simulated)"],
  ["Debug tabs", "page GET /debug", "GET /api/dev/trace, /api/dev/customers", "Account Inquiry (usually cached)"],
];

export function ApisTab() {
  return (
    <div className="doc">
      <h2>Do we need one API for every Fiserv API?</h2>
      <p className="lead">
        No. Our APIs are shaped around <b>what the customer is doing</b>, not around Fiserv's catalog. One of our calls
        often fans out to several Fiserv calls, and most Fiserv APIs we never expose at all.
      </p>
      <div className="cards">
        <div className="card"><h3>Next.js: 6 pages, 10 actions</h3><p>Pages render on the server; actions are BFF route handlers for sign-in, transfers and Plaid linking.</p></div>
        <div className="card"><h3>Java: 13 endpoints</h3><p>Task-shaped, for example <code>GET /api/accounts</code> for "all my accounts with balances". Plus <code>/health</code> and 4 dev endpoints for Debug.</p></div>
        <div className="card"><h3>Fiserv: 4 calls</h3><p>OAuth token, Account Inquiry, Transaction History and Add Transfer cover every screen in this app.</p></div>
        <div className="card"><h3>Plaid: 6 calls</h3><p>Link token, token exchange, sandbox link, balances, Auth (ACH numbers) and unlink.</p></div>
      </div>
      <Why>if the UI mirrored Fiserv, every screen would know EFX field names and a core change would ripple to the browser. Task APIs keep that knowledge in one Java class.</Why>
      <p><b>Rule of thumb:</b> add a Java endpoint when the UI needs a new task (say, "download a statement"), then call whatever Fiserv APIs that task needs inside it.</p>

      <h2>REST or GraphQL?</h2>
      <table className="doc-table">
        <thead><tr><th>Hop</th><th>Style</th><th>Notes</th></tr></thead>
        <tbody>
          <tr><td>Browser → Next.js</td><td>Server-rendered HTML + JSON route handlers</td><td>Pages arrive with data already in them; buttons POST JSON to <code>/api/…</code>.</td></tr>
          <tr><td>Next.js → Java</td><td>REST, JSON over HTTP</td><td>Private, with a shared secret, user id and request id headers.</td></tr>
          <tr><td>Java → Fiserv</td><td>REST-style EFX, JSON over HTTPS</td><td>Almost everything is POST, even reads (<code>/secured</code>), so account numbers travel in the body.</td></tr>
          <tr><td>Java → Plaid</td><td>REST, JSON over HTTPS</td><td>Keys in the body, plus a <code>Plaid-Version</code> header.</td></tr>
        </tbody>
      </table>
      <p>
        <b>Everything is REST, and that's deliberate.</b> GraphQL shines when many different clients need flexible data
        shapes. Here the BFF already builds exactly what each screen needs, Fiserv and Plaid only speak REST, and money
        movement is clearer as explicit endpoints with idempotency keys. If a mobile app and partners later need flexible
        reads, a GraphQL layer could sit in front of the read APIs, but transfers should stay plain endpoints.
      </p>

      <h2>Every screen, end to end</h2>
      <table className="doc-table">
        <thead><tr><th>In the UI</th><th>Next.js (BFF)</th><th>Java</th><th>Fiserv</th></tr></thead>
        <tbody>
          {MAP.map(([ui, bff, java, fiserv]) => (
            <tr key={ui}><td><b>{ui}</b></td><td className="mono">{bff}</td><td className="mono">{java}</td><td>{fiserv}</td></tr>
          ))}
        </tbody>
      </table>
      <p className="muted small">Watch any of these happen live in Debug › Logs, and click a line for a plain-English explanation.</p>
    </div>
  );
}
