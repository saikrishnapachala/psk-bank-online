import { moneyParts } from "@/lib/format";

/** Condensed tabular figure with smaller cents. */
export function Money({ value, className }: { value: number | null | undefined; className?: string }) {
  if (value === null || value === undefined) return <span className={className}>—</span>;
  const [whole, cents] = moneyParts(value);
  return (
    <span className={`fig ${className ?? ""}`}>
      {whole}
      <span className="cents">{cents}</span>
    </span>
  );
}
