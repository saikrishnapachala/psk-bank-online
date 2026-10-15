import { forwardMutation } from "@/lib/forward";

// Dev shortcut: link Plaid Sandbox's First Platypus Bank without the Link UI.
export async function POST(req: Request) {
  return forwardMutation(req, "/api/plaid/sandbox-link", []);
}
