// Client-side shapes of REST resources (see packages/contracts). Amounts are decimal strings.
export type Money = { amount: string; currency: string };
export type AppliedRate = {
  value: string;
  base: string;
  quote: string;
  sourceAt: string | null;
  freshness: string;
  source: string;
  manualReason: string | null;
};
export type TransactionView = {
  id: string;
  kind: 'expense' | 'income' | 'transfer' | 'refund';
  status: 'posted' | 'voided';
  occurredAt: string;
  localDate: string;
  timezone: string;
  accountId: string | null;
  categoryId: string | null;
  tagIds: string[];
  merchant: string | null;
  note: string | null;
  original: Money;
  settlement: Money;
  base: Money & { estimated: boolean };
  exchangeRate: AppliedRate | null;
  transfer: {
    sourceAccountId: string;
    targetAccountId: string;
    sourceAmount: Money;
    targetAmount: Money;
    feeTransactionId: string | null;
  } | null;
  refundOf: string | null;
  replacesId: string | null;
  replacedById: string | null;
  source: string;
  version: number;
  createdAt: string;
  updatedAt: string;
};
export type PreviewView = {
  previewId: string;
  expiresAt: string;
  kind: string;
  settlement: Money;
  base: Money;
  exchangeRate: AppliedRate | null;
  accountDeltas: { accountId: string; delta: string; currency: string }[];
  warnings: { code: string; message: string }[];
};
