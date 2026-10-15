import { forwardMutation } from "@/lib/forward";

// Between the customer's own accounts on the core (Fiserv Banking Hub "Add Transfer", via Java).
export async function POST(req: Request) {
  return forwardMutation(req, "/api/transfers/internal", ["fromId", "toId", "amount"], true);
}
