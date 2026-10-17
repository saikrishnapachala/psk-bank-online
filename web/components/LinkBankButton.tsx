"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { postJson } from "@/lib/client";

type PlaidHandler = { open: () => void; destroy: () => void };
type PlaidMetadata = { institution?: { name?: string } | null };
declare global {
  interface Window {
    Plaid?: {
      create: (cfg: {
        token: string;
        onSuccess: (publicToken: string, metadata: PlaidMetadata) => void;
        onExit: (err: unknown) => void;
      }) => PlaidHandler;
    };
  }
}

function loadPlaidScript(): Promise<void> {
  if (window.Plaid) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = "https://cdn.plaid.com/link/v2/stable/link-initialize.js";
    s.onload = () => resolve();
    s.onerror = () => reject(new Error("Couldn't load Plaid Link. Check your network or content blockers."));
    document.head.appendChild(s);
  });
}

/**
 * Live Plaid: get a link_token from our BFF -> open Plaid Link -> send the public_token back to the BFF.
 * Mock Plaid: same first step, then a server-side sandbox link (no Plaid UI).
 */
export function LinkBankButton({ label = "Link a bank" }: { label?: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: "ok" | "bad"; text: string } | null>(null);

  async function link() {
    setBusy(true);
    setMessage(null);
    try {
      const { linkToken, mode } = await postJson<{ linkToken: string; mode: string }>("/api/plaid/link-token");
      if (mode === "mock") {
        const item = await postJson<{ institution: string; accountCount: number }>("/api/plaid/sandbox-link");
        setMessage({ kind: "ok", text: `Linked ${item.institution} (mock Plaid sandbox), ${item.accountCount} accounts.` });
        router.refresh();
        setBusy(false);
        return;
      }
      await loadPlaidScript();
      const handler = window.Plaid!.create({
        token: linkToken,
        onSuccess: async (publicToken, metadata) => {
          try {
            const item = await postJson<{ institution: string; accountCount: number }>("/api/plaid/exchange", {
              publicToken,
              institution: metadata?.institution?.name ?? "",
            });
            setMessage({ kind: "ok", text: `Linked ${item.institution}, ${item.accountCount} accounts.` });
            router.refresh();
          } catch (e) {
            setMessage({ kind: "bad", text: (e as Error).message });
          } finally {
            setBusy(false);
            handler.destroy();
          }
        },
        onExit: () => setBusy(false),
      });
      handler.open();
    } catch (e) {
      setMessage({ kind: "bad", text: (e as Error).message });
      setBusy(false);
    }
  }

  return (
    <div>
      <button className="btn quiet" onClick={link} disabled={busy}>
        {busy ? "Linking…" : label}
      </button>
      {message && (
        <p className={`notice ${message.kind}`} role="status" style={{ marginTop: 12 }}>
          {message.text}
        </p>
      )}
    </div>
  );
}
