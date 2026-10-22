"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { postJson } from "@/lib/client";
import { date, money } from "@/lib/format";
import type { Account, Payee } from "@/lib/types";

type Result = { confirmation: string; amount: number; effectiveDate: string; replayed: boolean };

/** Send money to another PSK Bank customer. Money moves on the same Fiserv core, so it lands immediately. */
export function MemberTransferForm({ accounts, payees, disabled }: { accounts: Account[]; payees: Payee[]; disabled?: boolean }) {
  const router = useRouter();
  const sources = accounts.filter((a) => a.canTransferFrom && !a.error);
  const [fromId, setFromId] = useState(sources[0]?.id ?? "");
  const [payeeId, setPayeeId] = useState(payees[0]?.id ?? "");
  const [amount, setAmount] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<(Result & { to: string }) | null>(null);
  // One key per intended payment: a double click or a retry after a timeout can't send twice.
  const idemKey = useRef<string>(crypto.randomUUID());
  const fresh = () => { idemKey.current = crypto.randomUUID(); };

  const value = Number(amount);
  const payee = payees.find((p) => p.id === payeeId);
  const from = accounts.find((a) => a.id === fromId);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const r = await postJson<Result>("/api/transfers/member", { fromId, payeeId, amount: value }, idemKey.current);
      setResult({ ...r, to: payee?.name ?? "the recipient" });
      setAmount("");
      fresh();
      router.refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (payees.length === 0) return <p className="muted">No other PSK Bank customers are set up in this demo.</p>;
  if (sources.length === 0) return <p className="muted">None of your accounts can send money right now.</p>;

  return (
    <form onSubmit={submit}>
      <label className="field">
        Send to
        <select value={payeeId} onChange={(e) => { setPayeeId(e.target.value); fresh(); }}>
          {payees.map((p) => (
            <option key={p.id} value={p.id}>{p.name} · {p.account}</option>
          ))}
        </select>
      </label>
      <label className="field">
        From
        <select value={fromId} onChange={(e) => { setFromId(e.target.value); fresh(); }}>
          {sources.map((a) => (
            <option key={a.id} value={a.id}>{a.nickname} {a.maskedNumber} ({money(a.available)} available)</option>
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
          onChange={(e) => { setAmount(e.target.value.replace(/[^0-9.]/g, "")); fresh(); }}
          aria-describedby="member-help"
        />
      </label>
      <p id="member-help" className="muted small">
        Arrives in their account right away. Up to $5,000 per transfer and $10,000 a day.
      </p>
      <button className="btn" disabled={disabled || busy || !(value > 0) || !payeeId}>
        {busy ? "Sending…" : value > 0 && payee ? `Send ${money(value)} to ${payee.name.split(" ")[0]}` : "Send money"}
      </button>
      {error && <p className="notice bad result" role="alert">{error}</p>}
      {result && (
        <div className="notice ok result" role="status">
          Sent {money(result.amount)} to {result.to}.
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
