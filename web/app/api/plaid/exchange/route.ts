import { forwardMutation } from "@/lib/forward";

// Browser hands us Plaid Link's public_token; Java exchanges it and keeps the access_token server-side.
export async function POST(req: Request) {
  return forwardMutation(req, "/api/plaid/exchange", ["publicToken", "institution"]);
}
