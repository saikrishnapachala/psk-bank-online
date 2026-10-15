import { forwardMutation } from "@/lib/forward";

// Demo control: simulate a Fiserv outage (mock mode only) to show cached balances + paused transfers.
export async function POST(req: Request) {
  return forwardMutation(req, "/api/dev/mock-outage", ["on"]);
}
