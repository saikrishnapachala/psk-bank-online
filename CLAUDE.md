# CLAUDE.md — PSK Bank Online demo

Context carried over from the claude.ai conversation where this was built (Oct 19, 2026).
Research doc (Fiserv capabilities, limits, sentiment, architecture): https://claude.ai/code/artifact/659048ae-705b-472a-a9d5-2d5dea03e061

## What this is
A demo online-banking app for PSK Bank: Next.js UI + thin BFF, a Java banking service,
Fiserv Banking Hub (core) and Plaid (external accounts). It is a reference for the team's production build.

## Architecture rules (keep these true)
- Browser talks only to Next.js. Next.js talks only to the Java service. Only Java calls Fiserv and Plaid.
- No Fiserv/Plaid secrets in `web/`. Secrets live in `backend/.env` only (gitignored).
- Java trusts the BFF via `X-Internal-Token` (shared secret) + `X-User-Id`; user id always comes from the session, never a request body.
- Entitlements are checked in Java on every call (`banking/Entitlements`). Browser sees opaque ids (`acc-1`, `ext-…`) and masked numbers only.
- Money movement: required `Idempotency-Key`, in-flight de-dupe, per-transfer limits, audit line per attempt, and NO automatic retry on timeout (treat as unknown).
- BFF mutations go through `web/lib/forward.ts` (session + Origin + CSRF guard, field whitelist). Add new endpoints the same way.

## Commands
- Backend (mock): `cd backend && ./run.sh` (Windows `run.cmd`). Builds with plain `javac`, JDK 21+, port 8081.
- Live Fiserv smoke test: set `FISERV_MODE=live` + keys in `backend/.env`, then `./run.sh --check`.
- Live-transport contract test (no real keys): `backend/test/contract-test.sh` → expect `7 passed, 0 failed`.
- Web: `cd web && cp .env.example .env.local && npm install && npm run dev` (port 3000). Check: `npx tsc --noEmit`, `npx next build`.
- Demo login: `alex` / password in `web/.env.local` (test value).

## Fiserv Banking Hub facts (verified in Developer Studio docs)
- Trial plan = shared **Premier** sandbox; one Banking Hub workspace per account.
- Token: `POST https://bankinghub-cert.fiservapis.com/fts-apim/oauth2/v2`, Basic auth (API key = user, secret = password),
  form body `grant_type=client_credentials`. Token ~15 min; `expires_in` is **milliseconds** (string, e.g. "899000").
- Request URL = Host URL from the workspace (e.g. `https://bankinghub-cert.fiservapis.com/banking/efx/v1`) + API path.
- Every call: `Authorization: Bearer …` + header `EFXHeader` = JSON `{"OrganizationId": <Org ID>, "TrnId", "VendorId", "Context":{"Channel"}}`
  (only OrganizationId required). All methods are POST/PUT; reads use `/secured` paths.
- Paths used (see `fiserv/FiservPaths.java`):
  - Account details `POST /acctservice/acctmgmt/accounts/secured` body `{"AcctSel":{"AcctKeys":{"AcctId","AcctType"}}}`;
    AcctType SDA | DDA | CDA | LOAN (also DDL, LOAN_INET variants); balances at `AcctRec.DepositAcctInfo.AcctBal[]` with `BalType` (Avail, Ledger, Memo…).
  - History `POST /accttranservice/acctmgmt/acctTrn/secured` body `{"RecCtrlIn":{"MaxRecLimit"},"AcctTrnSel":{"AcctKeys","DtRange":[{StartDt,EndDt}]}}`.
  - Internal transfer `POST /xferservice/payments/transfers` body `{"XferInfo":{FromAcctRef:{AcctKeys},ToAcctRef:{AcctKeys},CurAmt:{Amt}}}` (returns 201, `XferStatusRec`).
- Errors come back as `Status.Severity = "Error"` with `StatusCode`/`StatusDesc`; mapped to 422 with "(EFX code)".
- **No ACH origination endpoint in the Premier API set** → external funding is Plaid-verified but the ACH leg is simulated (labelled in UI).

## Plaid
Sandbox endpoints used: `/link/token/create` (products `["auth"]`), `/item/public_token/exchange`, `/accounts/balance/get`, `/auth/get`,
`/sandbox/public_token/create` (institution `ins_109508`), `/item/remove`. Header `Plaid-Version: 2020-09-14`; client_id/secret in body.
`PLAID_BASE_URL` overrides the host (used by the contract test).

## Known gaps / decisions
- Backend is zero-dependency Java (JDK HttpServer + hand-rolled JSON) only because Maven Central was blocked where it was built.
  Planned: port to Spring Boot 1:1 (Router→@RestController, HttpJson→RestClient, Json→Jackson, CircuitBreaker→Resilience4j, Config→application.yml + Vault).
- Demo login is username/password; production = OIDC (auth code + PKCE) + step-up MFA before money movement.
- State (Plaid tokens, idempotency, audit, cached balances) is in memory; production = Postgres + KMS + append-only audit.
- Mock account IDs won't exist in the shared sandbox: use sample AcctIds from Banking Hub → Resources → Postman collection in `FISERV_DEMO_ACCOUNTS`.
- PSK Bank's actual Fiserv core is unconfirmed.

## Next steps
1. Run `./run.sh --check` against the real sandbox with workspace credentials; fix account IDs/types until all inquiries pass.
2. Port backend to Spring Boot; keep `backend/test/contract-test.sh` green.
3. Replace demo login with OIDC; move state to Postgres.

## UI conventions
Archivo variable (one family); money figures use `.fig` (font-stretch 75%, tabular nums, smaller cents) via `components/Money.tsx`.
Palette tokens in `web/app/globals.css` (paper #f4f6f8, ink #1d2126, steel #5a636e, line #d8dde2, signal red #c8102e for brand/focus only).
Footer `components/DataPath.tsx` shows which layers served the page and mock/live mode.
