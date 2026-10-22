/** Plain-English notes for every call the /logs page can show, so the team can read a trace without the code. */

type Entry = { hop: string; method?: string; path: RegExp; title: string; what: string; external?: string };

const CATALOG: Entry[] = [
  // Browser -> BFF (pages and route handlers in Next.js)
  { hop: "browser-bff", path: /^\/$/, title: "Accounts dashboard",
    what: "The customer opened the home page. Next.js renders it on the server by asking the Java service for accounts, linked banks and recent activity. The browser never talks to Java or Fiserv directly." },
  { hop: "browser-bff", path: /^\/move-money$/, title: "Move money page",
    what: "Transfer screen. The server loads the accounts the customer may move money from and to, plus any linked external banks." },
  { hop: "browser-bff", path: /^\/accounts\/[^/]+$/, title: "Account details page",
    what: "One account: balances, the full Fiserv record (rate, term, maturity, interest) and transaction history for the chosen window." },
  { hop: "browser-bff", path: /^\/api\/transfers\/internal$/, title: "Submit transfer (BFF)",
    what: "The customer pressed Transfer. The BFF checks the session cookie, same-origin and the CSRF token, keeps only whitelisted fields, then forwards to Java with the Idempotency-Key so a double click can't move money twice." },
  { hop: "browser-bff", path: /^\/api\/transfers\/member$/, title: "Send to another customer (BFF)",
    what: "The customer pressed Send money. The same session, origin and CSRF checks run, and only the source account, a payee id and the amount are forwarded. The browser never sees the recipient's account number." },
  { hop: "browser-bff", path: /^\/api\/transfers\/external$/, title: "Pull money from another bank (BFF)",
    what: "Funding from a Plaid-linked bank. Same session, origin and CSRF checks, then relayed to Java." },
  { hop: "browser-bff", path: /^\/api\/plaid\//, title: "Plaid link flow (BFF)",
    what: "Linking or unlinking an external bank. The BFF relays to Java, which holds the Plaid keys and access tokens." },
  { hop: "browser-bff", path: /^\/api\/dev\/outage$/, title: "Outage simulator (BFF)",
    what: "Demo control that switches the mock Fiserv core into an outage, to show cached balances and paused transfers." },

  // BFF -> Java (private REST, shared secret + user id header)
  { hop: "bff-java", path: /^\/api\/accounts$/, title: "List my accounts",
    what: "Java looks up which core accounts this user may see (entitlements), then sends one Fiserv Account Inquiry per account in parallel and maps the replies to clean JSON with opaque ids." },
  { hop: "bff-java", path: /^\/api\/accounts\/[^/]+$/, title: "One account's details",
    what: "Java checks the user is entitled to this opaque id, then calls Fiserv Account Inquiry and returns every useful field: status, product, rate, term, balances." },
  { hop: "bff-java", path: /^\/api\/accounts\/[^/]+\/transactions$/, title: "Transaction history",
    what: "Java checks entitlement, then calls Fiserv Account Transaction History for the date window (30/60/90 days)." },
  { hop: "bff-java", path: /^\/api\/transfers\/internal$/, title: "Move money between own accounts",
    what: "Java validates the amount and per-transfer limit, de-duplicates by Idempotency-Key, re-reads the source balance, then calls Fiserv Add Transfer. Every attempt is audited. A timeout is reported as unknown and never retried automatically." },
  { hop: "bff-java", path: /^\/api\/payees$/, title: "People I can pay",
    what: "Other PSK Bank customers this user can send money to, each with a name and a masked account. Real account numbers stay in Java." },
  { hop: "bff-java", path: /^\/api\/transfers\/member$/, title: "Send money to another customer",
    what: "Java checks the sender owns the source account, resolves the payee to the recipient's receiving account on the server, and enforces $5,000 per transfer, $10,000 a day and 6 transfers a minute. It then calls Fiserv Add Transfer and writes an audit line for both people. Both customers' screens refresh with real Fiserv balances and history." },
  { hop: "bff-java", path: /^\/api\/transfers\/external$/, title: "Fund from external bank",
    what: "Java verifies ACH numbers with Plaid Auth and records the deposit. The ACH leg itself is simulated, because Banking Hub's Premier API set has no ACH origination endpoint." },
  { hop: "bff-java", path: /^\/api\/plaid\/accounts$/, title: "Linked external accounts",
    what: "Accounts the customer linked at other banks, with balances from Plaid. Makes no Plaid call when nothing is linked." },
  { hop: "bff-java", path: /^\/api\/plaid\//, title: "Plaid linking",
    what: "Creates a Link token, exchanges the public token or unlinks an item. The Plaid access token stays in Java." },
  { hop: "bff-java", path: /^\/api\/activity$/, title: "Recent money movement",
    what: "This session's audit trail of transfers, read from Java's in-memory audit log. No external call." },
  { hop: "bff-java", path: /^\/api\/dev\//, title: "Demo tools", what: "Mock-mode controls and status. Not part of the customer journey." },

  // Java -> Fiserv Banking Hub (EFX)
  { hop: "java-fiserv", path: /oauth2/, title: "Fiserv OAuth token", external: "POST /fts-apim/oauth2/v2",
    what: "Client-credentials token from Fiserv using the API key and secret (Basic auth). Java reuses it for about 15 minutes, so you'll only see this now and then." },
  { hop: "java-fiserv", path: /\/acctservice\/acctmgmt\/accounts\/secured$/, title: "Fiserv Account Inquiry", external: "Banking Hub · Account Service",
    what: "Reads one core account: available, ledger and accrued-interest balances, rate, product, status, open and maturity dates. The account number is sent in the body (the /secured path) so it never appears in a URL." },
  { hop: "java-fiserv", path: /\/accttranservice\/acctmgmt\/acctTrn\/secured$/, title: "Fiserv Transaction History", external: "Banking Hub · Account Transaction Service",
    what: "Posted and memo-posted transactions for one account within a date range, newest first." },
  { hop: "java-fiserv", path: /\/xferservice\/payments\/transfers$/, title: "Fiserv Add Transfer", external: "Banking Hub · Transfer Service",
    what: "Moves money on the core: an immediate one-time transfer with a debit code on the source and a credit code on the destination. This is the only call that changes balances." },

  // Java -> Plaid
  { hop: "java-plaid", path: /\/link\/token\/create$/, title: "Plaid Link token", what: "Short-lived token that opens the Plaid Link widget in the browser." },
  { hop: "java-plaid", path: /\/item\/public_token\/exchange$/, title: "Plaid token exchange", what: "Swaps Link's public token for a long-lived access token, which is stored in Java only." },
  { hop: "java-plaid", path: /\/sandbox\/public_token\/create$/, title: "Plaid sandbox link", what: "Sandbox shortcut that links a test bank without the Link UI." },
  { hop: "java-plaid", path: /\/accounts\/balance\/get$/, title: "Plaid balances", what: "Live balances of the customer's accounts at the other bank." },
  { hop: "java-plaid", path: /\/auth\/get$/, title: "Plaid Auth", what: "Account and routing numbers, used to verify the account can send ACH." },
  { hop: "java-plaid", path: /\/item\/remove$/, title: "Plaid unlink", what: "Revokes the access token and forgets the linked bank." },
];

export function explain(hop: string, target: string): { title: string; what: string; external?: string } {
  return (
    CATALOG.find((c) => c.hop === hop && c.path.test(target)) ?? {
      title: target,
      what: "No description for this call yet. Add one in web/lib/apiCatalog.ts.",
    }
  );
}

/** What a status value in the log means. */
export function explainStatus(status: string): string {
  if (status === "render") return "Server-rendered page. Its time covers every backend call the page waited on.";
  if (status === "cache") return "No new Fiserv call: either Java's 60-second read cache answered, or the request joined an identical call already in flight. This protects the shared sandbox's rate limit.";
  if (status === "…") return "Still in progress, or the handler didn't reach Java.";
  if (status === "EFX 0") return "Fiserv EFX status 0: success.";
  if (status === "EFX 1120") return "Fiserv EFX 1120: no records match. Usually the account id or type isn't on file in this core.";
  if (status === "EFX 429") return "Fiserv rate limit (HTTP 429). The trial sandbox allows only a few calls per second.";
  if (status === "EFX 2365") return "Fiserv EFX 2365: request denied due to account status, for example a dormant account.";
  if (status === "EFX 1090") return "Fiserv EFX 1090: invalid value in the request.";
  if (status === "BUSY") return "Every Fiserv slot was in use for 10 seconds, so Java answered 'busy' instead of piling more load on the provider.";
  if (status === "429") return "Rejected by our own velocity limit (too many transfers in a minute) or by the provider's rate limit.";
  if (status === "409") return "Duplicate: the same Idempotency-Key is already being processed, so the second copy was refused.";
  if (status.startsWith("EFX ")) return "Fiserv returned a business error. See the detail column for its description.";
  if (status.startsWith("HTTP 2") || /^2\d\d$/.test(status)) return "HTTP success.";
  if (/^4\d\d$/.test(status)) return "Rejected by the service: validation, entitlement, CSRF or session problem.";
  if (/^5\d\d$/.test(status) || status === "ERROR" || status === "DOWN") return "Upstream failure or timeout. The circuit breaker counts these.";
  return status;
}
