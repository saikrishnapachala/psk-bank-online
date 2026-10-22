import { forwardMutation } from "@/lib/forward";

// Send money to another PSK Bank customer (same Fiserv core, via Java). The recipient is a payee id, never an account number.
export async function POST(req: Request) {
  return forwardMutation(req, "/api/transfers/member", ["fromId", "payeeId", "amount"], true);
}
