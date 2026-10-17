"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { postJson } from "@/lib/client";

/** Mock mode only: flips a simulated Fiserv outage so the team can see the degraded experience. */
export function OutageToggle({ on }: { on: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  return (
    <button
      className="btn quiet"
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        try {
          await postJson("/api/dev/outage", { on: !on });
          router.refresh();
        } finally {
          setBusy(false);
        }
      }}
    >
      {on ? "End simulated outage" : "Simulate Fiserv outage"}
    </button>
  );
}
