# PSK Bank Online

A working online-banking demo for **PSK Bank**, built on the live **Fiserv Banking Hub** sandbox.
Three test customers sign in on their own laptops, see real core balances and history, and send money to each
other. Every hop, from browser to Fiserv, is visible in the app's **Debug** area.

```
Browser ──HTTPS, session cookie──▶ Next.js (UI + BFF) ──private REST + shared secret──▶ Java banking service
                                                                                         ├──▶ Fiserv Banking Hub (EFX)
                                                                                         └──▶ Plaid
```

- **The browser never sees a Fiserv or Plaid credential**, or a real account number. It only talks to Next.js.
- **Next.js holds no banking secrets.** It owns the session, CSRF protection and shaping data for each screen.
- **Java is the only Fiserv and Plaid caller.** It owns entitlements, limits, idempotency, audit, resilience and the EFX mapping.

Live demo (Render free plan): https://psk-bank-online.onrender.com. The first visit after ~15 idle minutes takes 30–60 seconds while it wakes up.

## What you can do

| Screen | What it shows or does | Data source |
| --- | --- | --- |
| **Accounts** | Total balance, checking, savings, money market and CDs, with status tags (for example Dormant) | Fiserv Account Inquiry, live |
| **Account details** | Rate, term, maturity, opening deposit, accrued interest, every balance type, 30/60/90-day history | Fiserv Account Inquiry + Transaction History |
| **Move money › Between your accounts** | Instant transfer between your own accounts | Fiserv Add Transfer |
| **Move money › To another PSK Bank customer** | Pay Alex, Jordan or Sam; it lands in their checking immediately | Fiserv Add Transfer |
| **Move money › From another bank** | Link a bank with Plaid and pull money in | Plaid (mock); ACH leg simulated |
| **Debug** | Live request logs, test accounts, architecture diagram, and how Fiserv, the BFF and Java work | This app |

Dashboards refresh every 15 seconds while open, so a payment sent from one laptop shows up on the other without a reload.

## Demo customers

| Username | Customer | Accounts (Fiserv Premier sandbox, Org 999990301) |
| --- | --- | --- |
| `alex` | Alex Morgan | Everyday Checking ••2605, Money Market ••1916, 12-Month CD ••8135 |
| `jordan` | Jordan Lee | Everyday Checking ••7791, High-Yield Savings ••0518, 6-Month CD ••3060 |
| `sam` | Sam Patel | Everyday Checking ••3267, Bills Checking ••4258, 3-Month CD ••1702 |

All nine are real accounts in the shared sandbox. Locally the password is `DEMO_PASSWORD` in `web/.env.local`; on Render it's
the one `deploy/render-deploy.sh` printed. Signed-in users can also find it under **Debug › Test accounts**.

**Team demo:** each person signs in as a different customer, opens Move money, and sends a few dollars to someone else.
The recipient sees the new balance, a "Received" line and the Fiserv transaction within 15 seconds.

## Run it locally

You need JDK 21+ and Node 20.9+. The backend builds with plain `javac`; there's no Maven or Gradle.

```bash
# terminal 1: Java service on :8081
cd backend
./run.sh                 # Windows: run.cmd. Creates backend/.env from .env.example (mock mode) on first run.

# terminal 2: Next.js on :3000
cd web
cp .env.example .env.local
npm install
npm run dev
```

Open http://localhost:3000 and sign in as `alex`, `jordan` or `sam`.

Out of the box both Fiserv and Plaid run in **mock** mode, so everything works offline. To let other laptops on the same
Wi-Fi join, open `http://<this machine's IP>:3000` on them. For people elsewhere, run a tunnel such as
`cloudflared tunnel --url http://localhost:3000`.

### Use the live Fiserv sandbox

1. In Fiserv Developer Studio, open your Banking Hub workspace and copy the **API key**, **API secret**, **Org ID** and **Host URL**.
2. Edit `backend/.env`:
   ```ini
   FISERV_MODE=live
   FISERV_API_KEY=...
   FISERV_API_SECRET=...
   FISERV_ORG_ID=999990301
   FISERV_HOST_URL=https://bankinghub-cert.fiservapis.com/banking/efx/v1
   ```
3. Point each customer at accounts that exist in the sandbox (Banking Hub › Resources › Postman collection lists samples):
   ```ini
   DEMO_USERS=u-alex:Alex Morgan,u-jordan:Jordan Lee,u-sam:Sam Patel
   ACCOUNTS_u-alex=DDA:1081372605:Everyday Checking;SDA:8282801916:Money Market;CDA:1082998135:12-Month CD
   ```
   Types: `DDA` checking, `SDA` savings, `CDA` CD. Web logins live in `web/.env.local` as `DEMO_USERS=alex:u-alex:Alex Morgan,...`.
4. Check every account before starting the UI:
   ```bash
   cd backend && ./run.sh --check
   # Token OK, expires in ~898s
   #   DDA   ••2605  OK  available=63594.93 ...
   ```
   `REJECTED ... 1120` means the account number or type isn't in the sandbox. A token failure means the key, secret or token URL is wrong.

### Use the Plaid sandbox

Set `PLAID_MODE=live`, `PLAID_ENV=sandbox`, `PLAID_CLIENT_ID` and `PLAID_SECRET` in `backend/.env`. **Link a bank** then
opens real Plaid Link (sandbox login `user_good` / `pass_good`).

## Deploy free on Render

`render.yaml` and `deploy/render-deploy.sh` define two free web services: `psk-bank-api` (Java, Docker) and `psk-bank-online` (Next.js).

```bash
deploy/render-deploy.sh              # first deploy: asks for a Render API key, reads Fiserv keys from backend/.env,
                                     # generates the shared and session secrets plus a demo password
deploy/render-deploy.sh --redeploy   # rebuild both from the latest main; same URLs, settings and password
```

Create the API key in the Render dashboard under **Account settings › API Keys**. The services were created through the API,
so pushes don't auto-deploy; run `--redeploy` after you push. Free services sleep after about 15 idle minutes, and the
in-memory data (logs, activity, rate limits) resets when they do. Balances and history live in Fiserv and are unaffected.

## What is real and what is simulated

| Capability | Fiserv / Plaid call | In this demo |
| --- | --- | --- |
| Balances, rate, term, maturity, interest | `POST /acctservice/acctmgmt/accounts/secured` | Real |
| Transaction history | `POST /accttranservice/acctmgmt/acctTrn/secured` | Real |
| Transfer between own accounts, or to another PSK customer | `POST /xferservice/payments/transfers` | Real (immediate, `ExpediteInd` + transaction codes) |
| Link an external bank, its balances, ACH numbers | Plaid Link, `/accounts/balance/get`, `/auth/get` | Mock (real with Plaid keys) |
| **ACH pull from another bank** | None in the Banking Hub Premier API set | **Simulated** and labelled in the UI |
| **Payments to other banks (wire, RTP, FedNow, ACH out)** | Separate Fiserv payment products | Not built yet |
| Customer login | None | Demo username and password; production uses OIDC with MFA |
| Idempotency keys, audit, logs, rate limits | None | In memory; production uses a database and an append-only audit store |

`docs/money-movement.html` is a team briefing on how money moves between banks, who is responsible at each step, and what
a new bank needs beyond these core APIs.

## Built-in safeguards

**Security**
- Session cookie: HMAC-signed, `HttpOnly`, `SameSite=Lax`, `Secure` in production, 15-minute lifetime.
- CSRF token bound into the session plus an Origin check on every change.
- Entitlements are checked in Java on every call. The browser sees opaque ids (`acc-1`) and masked numbers only, and payees by name, never by account number.
- Java trusts only the BFF: a shared secret compared in constant time, plus the user id header. It refuses to start exposed with the default secret.
- Headers: CSP (Plaid's CDN only), HSTS, `X-Frame-Options: DENY`, `nosniff`.

**Money movement**
- An `Idempotency-Key` per intended transfer, in-flight de-duplication (409), and no automatic retry on timeout (reported as unknown).
- Limits: $25,000 between your own accounts; $5,000 per payment and $10,000 a day to other customers; 6 transfers per minute.
- Funds are re-checked against a fresh Fiserv read before every transfer. Dormant or closed accounts can't send or receive.
- An audit line for every attempt, on both sides of a payment.

**Resilience under load**
- Timeouts, and a circuit breaker (3 failures, then 30s fail-fast) with last-known balances and transfers paused.
- At most 4 Fiserv calls in flight; identical reads in flight are shared; reads are cached for 60s; a 429 falls back to the last good reply.
- Tested against the live sandbox: 30 concurrent dashboards all succeeded, 3 identical transfers moved money once, and a burst of 8 transfers was capped at the limit.

## Tests

```bash
backend/test/contract-test.sh     # needs python3 + curl
```

Local fakes reject anything off-contract (token auth, EFXHeader, EFX bodies, Plaid keys and version), and the Java service
runs in live mode against them. Current result: 6 of 7 pass; the Plaid auth + funding check fails and is a known gap.
`./run.sh --check` is the live smoke test; `java -cp out com.pskbank.demo.core.RateLimiter` self-checks the rate limiter.

## Project map

```
backend/                          Java 21, no dependencies
  Dockerfile                      image for Render (compiles at build time)
  src/main/java/com/pskbank/demo/
    App.java                      wiring, routes, error mapping, --check
    core/    Router, Json, Config, HttpJson, CircuitBreaker, RateLimiter, Trace
    fiserv/  LiveFiservTransport (token + EFXHeader), MockFiservTransport, EfxMapper, FiservPaths
    banking/ Entitlements, CoreBankingService (cache, coalescing, gate), TransferService,
             ExternalFundingService, AuditLog, Models
    plaid/   LivePlaidTransport, MockPlaidTransport, PlaidService
  test/contract-test.sh           live-transport contract test
web/                              Next.js 16 App Router
  proxy.ts                        request id for end-to-end tracing
  app/page.tsx, accounts/, move-money/, login/, debug/   server-rendered pages
  app/api/**/route.ts             BFF route handlers (guarded, whitelisted fields, relayed to Java)
  lib/backend.ts                  the BFF's only outbound client
  lib/forward.ts, bff.ts          session, origin and CSRF guard
  lib/session.ts, demoUsers.ts    signed session, demo sign-in list
  lib/trace.ts, apiCatalog.ts     Debug › Logs data and plain-English call descriptions
  components/                     forms, log explorer, Debug tabs, logo
deploy/render-deploy.sh           one-command Render deploy and redeploy
render.yaml                       Render Blueprint (alternative to the script)
docs/money-movement.html          team briefing: how money moves between banks
```

## Moving to production

- **Spring Boot:** each Java class maps one-to-one. `Router` becomes `@RestController`, `HttpJson` becomes `RestClient`, `Json` becomes Jackson, `CircuitBreaker` becomes Resilience4j, and `Config` becomes `application.yml` plus Vault.
- **Identity:** replace the demo login with OIDC (authorization code + PKCE) and step-up MFA before money moves.
- **Accounts:** load each customer's accounts from an enrollment store linked to their Fiserv party record, instead of settings.
- **Data:** Postgres for idempotency keys, payment state and daily limits; an append-only audit table shipped to the SIEM; KMS-encrypted Plaid tokens.
- **Payments to other banks:** Fiserv's payment products (or another ISO 20022 payments hub) for wires, RTP/FedNow and ACH, with sanctions screening and fraud scoring.
- **Network:** Java on a private subnet, mTLS between the BFF and Java, and an egress allowlist for Fiserv and Plaid.
