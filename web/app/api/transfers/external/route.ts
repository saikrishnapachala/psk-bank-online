import { forwardMutation } from "@/lib/forward";

// Pull from a Plaid-linked account at another bank (Plaid verifies; ACH leg simulated in this demo).
export async function POST(req: Request) {
  return forwardMutation(req, "/api/transfers/external", ["externalId", "toId", "amount"], true);
}
