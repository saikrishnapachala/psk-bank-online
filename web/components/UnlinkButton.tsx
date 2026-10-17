"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { postJson } from "@/lib/client";

export function UnlinkButton({ itemId, institution }: { itemId: string; institution: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  return (
    <button
      className="btn link small"
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        try {
          await postJson("/api/plaid/unlink", { itemId });
          router.refresh();
        } finally {
          setBusy(false);
        }
      }}
    >
      Unlink {institution}
    </button>
  );
}
