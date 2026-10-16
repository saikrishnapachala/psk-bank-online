"use client";

import { postJson } from "@/lib/client";

export function SignOutButton() {
  return (
    <button
      className="btn quiet"
      onClick={async () => {
        await postJson("/api/auth/logout").catch(() => undefined);
        window.location.href = "/login";
      }}
    >
      Sign out
    </button>
  );
}
