const usd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });
const day = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });

export function money(n: number | null | undefined): string {
  return n === null || n === undefined ? "—" : usd.format(n);
}

/** Splits $12,345.67 into ["$12,345", ".67"] so cents can be set smaller. */
export function moneyParts(n: number): [string, string] {
  const s = usd.format(n);
  const i = s.lastIndexOf(".");
  return i < 0 ? [s, ""] : [s.slice(0, i), s.slice(i)];
}

export function date(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso.length === 10 ? iso + "T00:00:00Z" : iso);
  return Number.isNaN(d.getTime()) ? iso : day.format(d);
}

export function rate(r: number | null | undefined): string {
  return r === null || r === undefined ? "" : `${r.toFixed(2)}% rate`;
}
