"use client";

import { useRouter } from "next/navigation";
import { useMemo, useRef, useState } from "react";
import { postJson } from "@/lib/client";
import { date, money } from "@/lib/format";
import type { Account } from "@/lib/types";

type Result = { confirmation: string; amount: number; effectiveDate: string; replayed: boolean; toId: string; fromId: string };

export function TransferForm({ accounts, disabled }: { accounts: Account[]; disabled?: boolean }) {
  const router = useRouter();
  const sources = accounts.filter((a) => a.canTransferFrom && !a.error);
  const targets = accounts.filter((a) => a.canTransferTo && !a.error);
  const [fromId, setFromId] = useState(sources[0]?.id ?? "");
  const [toId, setToId] = useState(targets.find((t) => t.id !== sources[0]?.id)?.id ?? "");
  const [amount, setAmount] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  // One key per intended transfer: a double-click or retry after a timeout cannot move money twice.
  const idemKey = useRef<string>(crypto.randomUUID());

  const from = useMemo(() => accounts.find((a) => a.id === fromId), [accounts, fromId]);
  const to = accounts.find((a) => a.id === toId);
  const value = Number(amount);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const r = await postJson<Result>("/api/transfers/internal", { fromId, toId, amount: value }, idemKey.current);
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

  if (sources.length === 0) return <p className="muted">No accounts can send transfers right now.</p>;

  return (
    <form onSubmit={submit}>
      <label className="field">
        From
        <select
          value={fromId}
          onChange={(e) => {
            const next = e.target.value;
            setFromId(next);
            if (toId === next) setToId(targets.find((t) => t.id !== next)?.id ?? "");
            idemKey.current = crypto.randomUUID();
          }}
        >
          {sources.map((a) => (
            <option key={a.id} value={a.id}>
              {a.nickname} {a.maskedNumber} ({money(a.available)} available)
            </option>
          ))}
        </select>
      </label>
      <label className="field">
        To
        <select value={toId} onChange={(e) => { setToId(e.target.value); idemKey.current = crypto.randomUUID(); }}>
          {targets.filter((a) => a.id !== fromId).map((a) => (
            <option key={a.id} value={a.id}>
              {a.nickname} {a.maskedNumber}
            </option>
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
          aria-describedby="transfer-help"
        />
      </label>
      <p id="transfer-help" className="muted small">
        Moves immediately on the core. Limit $25,000 per transfer.
      </p>
      <button className="btn" disabled={disabled || busy || !(value > 0) || !toId}>
        {busy ? "Transferring…" : value > 0 ? `Transfer ${money(value)}` : "Transfer"}
      </button>
      {error && <p className="notice bad result" role="alert">{error}</p>}
      {result && (
        <div className="notice ok result" role="status">
          Transferred {money(result.amount)} to {to?.nickname ?? "your account"}.
          <dl>
            <dt>Confirmation</dt><dd>{result.confirmation}{result.replayed ? " (already submitted)" : ""}</dd>
            <dt>Effective</dt><dd>{date(result.effectiveDate)}</dd>
            <dt>From</dt><dd>{from?.nickname} {from?.maskedNumber}</dd>
          </dl>
        </div>
      )}
    </form>
  );
}
