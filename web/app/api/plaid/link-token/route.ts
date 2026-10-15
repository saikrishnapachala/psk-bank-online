import { forwardMutation } from "@/lib/forward";

export async function POST(req: Request) {
  return forwardMutation(req, "/api/plaid/link-token", []);
}
