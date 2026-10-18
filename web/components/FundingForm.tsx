"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { postJson } from "@/lib/client";
import { date, money } from "@/lib/format";
import type { Account, ExternalAccount } from "@/lib/types";
import { LinkBankButton } from "./LinkBankButton";

type Result = {
  confirmation: string; status: string; fromExternal: string; amount: number;
  expectedSettlement: string; routingMasked: string; accountMasked: string; replayed: boolean; note: string;
};

export function FundingForm({ externals, accounts }: { externals: ExternalAccount[]; accounts: Account[] }) {
  const router = useRouter();
  const targets = accounts.filter((a) => (a.type === "SDA" || a.type === "DDA") && !a.error);
  const [externalId, setExternalId] = useState(externals[0]?.id ?? "");
  const [toId, setToId] = useState(targets[0]?.id ?? "");
  const [amount, setAmount] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const idemKey = useRef<string>(crypto.randomUUID());
  const value = Number(amount);

  if (externals.length === 0) {
    return (
      <div>
        <p className="muted">Link an account at another bank first. Plaid verifies you own it and that it can send ACH.</p>
        <LinkBankButton />
      </div>
    );
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const r = await postJson<Result>("/api/transfers/external", { externalId, toId, amount: value }, idemKey.current);
      setResult(r);
      setAmount("");
      idemKey.current = crypto.randomUUID();
      router.refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit}>
      <label className="field">
        From another bank
        <select value={externalId} onChange={(e) => { setExternalId(e.target.value); idemKey.current = crypto.randomUUID(); }}>
          {externals.map((x) => (
            <option key={x.id} value={x.id}>
              {x.institution} {x.name} ••{x.mask} ({money(x.available ?? x.current)} available)
            </option>
          ))}
        </select>
      </label>
      <label className="field">
        Into
        <select value={toId} onChange={(e) => { setToId(e.target.value); idemKey.current = crypto.randomUUID(); }}>
          {targets.map((a) => (
            <option key={a.id} value={a.id}>{a.nickname} {a.maskedNumber}</option>
          ))}
        </select>
      </label>
      <label className="field">
        Amount
        <input
          className="amount"
          inputMode="decimal"
          placeholder="0.00"
          value={amount}
          onChange={(e) => { setAmount(e.target.value.replace(/[^0-9.]/g, "")); idemKey.current = crypto.randomUUID(); }}
        />
      </label>
      <p className="muted small">Arrives in about 2 business days. Limit $10,000 per transfer.</p>
      <button className="btn" disabled={busy || !(value > 0)}>
        {busy ? "Requesting…" : value > 0 ? `Request ${money(value)}` : "Request transfer"}
      </button>
      {error && <p className="notice bad result" role="alert">{error}</p>}
      {result && (
        <div className="notice ok result" role="status">
          Requested {money(result.amount)} from {result.fromExternal}.
          <dl>
            <dt>Confirmation</dt><dd>{result.confirmation}{result.replayed ? " (already submitted)" : ""}</dd>
            <dt>Expected</dt><dd>{date(result.expectedSettlement)}</dd>
            <dt>Verified by Plaid</dt><dd>Routing {result.routingMasked}, account {result.accountMasked}</dd>
          </dl>
          <p className="small" style={{ marginBottom: 0 }}>{result.note}</p>
        </div>
      )}
    </form>
  );
}
