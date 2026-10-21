export type Account = {
  id: string;
  type: "SDA" | "DDA" | "CDA" | "LOAN" | string;
  typeLabel: string;
  nickname: string;
  product?: string;
  maskedNumber: string;
  available?: number;
  current?: number;
  rate?: number;
  openDate?: string;
  maturityDate?: string;
  status?: string;
  canTransferFrom: boolean;
  canTransferTo: boolean;
  error?: string;
  details?: Fact[];
  balances?: Fact[];
};

/** A labelled value straight from the Fiserv record. */
export type Fact = { label: string; value: string; kind: "text" | "money" | "date" | "rate" };

export function pastDue(a: Account): number {
  return Number(a.balances?.find((b) => b.label === "Past due")?.value ?? 0);
}

export type AccountsView = { accounts: Account[]; stale: boolean; asOf: string; source: string; notice?: string };

export type Txn = {
  id: string;
  date: string;
  description: string;
  amount: number;
  direction: "debit" | "credit";
  runningBalance?: number;
  pending: boolean;
};

export type ExternalAccount = {
  id: string;
  itemId: string;
  institution: string;
  name: string;
  mask: string;
  subtype: string;
  available?: number;
  current?: number;
};

export type LinkedItem = { itemId: string; institution: string; accountCount: number };

export type AuditEvent = { ts: string; type: string; summary: string; status: string; ref?: string };
