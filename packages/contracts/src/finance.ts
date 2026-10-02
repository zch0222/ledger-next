import { z } from 'zod';
import { Currency, Decimal, Freshness, LocalDate, Money, QueryBoolean, Rate, Timestamp, Timezone, input, output, pageQuery, resource, shared, uuid } from './common';

const version = z.number().int().positive();
const name = z.string().trim().min(1).max(80);
const note = z.string().max(500);

export const AccountType = shared('AccountType', z.enum(['cash', 'bank', 'credit_card', 'e_wallet', 'investment', 'other']), '信用卡以负余额表示负债');
export const Account = resource('Account', z.object({
  id: uuid, name: z.string(), type: AccountType, currency: Currency,
  openingBalance: Decimal, balance: Decimal, note: z.string().nullable(), archivedAt: Timestamp.nullable(), version,
}), '一个账户只有一种结算币；余额 = 期初 + 所有已生效 posting');
export const AccountCreate = input('AccountCreate', z.object({ name, type: AccountType, currency: Currency, openingBalance: Decimal.default('0'), note: note.optional() }).strict());
export const AccountUpdate = input('AccountUpdate', z.object({ name: name.optional(), note: note.nullable().optional() }).strict(), '结算币与期初余额创建后不可修改');
export const AccountQuery = z.object({ includeArchived: QueryBoolean, ...pageQuery }).strict();

export const CategoryKind = shared('CategoryKind', z.enum(['expense', 'income']));
export const Category = resource('Category', z.object({ id: uuid, name: z.string(), kind: CategoryKind, parentId: uuid.nullable(), icon: z.string().nullable(), archivedAt: Timestamp.nullable(), version }));
export const CategoryCreate = input('CategoryCreate', z.object({ name, kind: CategoryKind, parentId: uuid.optional(), icon: z.string().max(32).optional() }).strict());
export const CategoryUpdate = input('CategoryUpdate', z.object({ name: name.optional(), parentId: uuid.nullable().optional(), icon: z.string().max(32).nullable().optional() }).strict());
export const Tag = resource('Tag', z.object({ id: uuid, name: z.string(), archivedAt: Timestamp.nullable(), version }));
export const TagCreate = input('TagCreate', z.object({ name: z.string().trim().min(1).max(40) }).strict());
export const TagUpdate = input('TagUpdate', z.object({ name: z.string().trim().min(1).max(40) }).strict());
export const CatalogQuery = z.object({ includeArchived: QueryBoolean, ...pageQuery }).strict();

export const TransactionKind = output('TransactionKind', z.enum(['expense', 'income', 'transfer', 'refund']), '收入 / 支出 / 退款存正金额，由 kind 决定 posting 符号；转账本金不计收支');
export const AppliedRate = output('AppliedRate', z.object({
  value: Rate, base: Currency, quote: Currency, sourceAt: Timestamp.nullable(), freshness: Freshness,
  source: z.string(), manualReason: z.string().nullable(),
}), '入账时锁定的不可变汇率快照');
export const Transaction = resource('Transaction', z.object({
  id: uuid, kind: TransactionKind, status: z.enum(['posted', 'voided']),
  occurredAt: Timestamp, localDate: LocalDate, timezone: z.string(),
  accountId: uuid.nullable(), categoryId: uuid.nullable(), tagIds: z.array(uuid),
  merchant: z.string().nullable(), note: z.string().nullable(),
  original: Money, settlement: Money, base: z.object({ amount: Decimal, currency: Currency, estimated: z.boolean() }),
  exchangeRate: AppliedRate.nullable(),
  transfer: z.object({ sourceAccountId: uuid, targetAccountId: uuid, sourceAmount: Money, targetAmount: Money, feeTransactionId: uuid.nullable() }).nullable(),
  refundOf: uuid.nullable(), replacesId: uuid.nullable(),
  source: z.enum(['web', 'api', 'agent', 'import', 'subscription']),
  version, createdAt: Timestamp, updatedAt: Timestamp,
}));
export const TransactionQuery = z.object({
  dateFrom: LocalDate.optional().meta({ description: '含当日，按账本时区' }), dateTo: LocalDate.optional().meta({ description: '不含当日' }),
  accountId: uuid.optional(), categoryId: uuid.optional(), kind: TransactionKind.optional(), status: z.enum(['posted', 'voided']).optional(),
  q: z.string().max(100).optional(), sort: z.enum(['-localDate', 'localDate', '-amount', 'amount']).default('-localDate'), ...pageQuery,
}).strict();

const fxPolicy = z.enum(['fresh-only', 'accept-stale', 'manual']);
const manualRate = z.object({ value: Rate, reason: z.string().trim().min(1).max(200) }).strict();
const when = { occurredAt: Timestamp, timezone: Timezone };
export const TransactionPreviewCreate = input('TransactionPreviewCreate', z.discriminatedUnion('kind', [
  z.object({ kind: z.enum(['expense', 'income']), accountId: uuid, settlement: Money, original: Money.optional(), categoryId: uuid.optional(), tagIds: z.array(uuid).max(20).optional(), merchant: z.string().max(120).optional(), note: note.optional(), fxPolicy: fxPolicy.default('fresh-only'), manualRate: manualRate.optional(), ...when }).strict(),
  z.object({ kind: z.literal('transfer'), sourceAccountId: uuid, targetAccountId: uuid, sourceAmount: Money, targetAmount: Money, fee: z.object({ amount: Money, categoryId: uuid.optional() }).strict().optional(), note: note.optional(), fxPolicy: fxPolicy.default('fresh-only'), manualRate: manualRate.optional(), ...when }).strict(),
  z.object({ kind: z.literal('refund'), originalTransactionId: uuid, accountId: uuid, settlement: Money, note: note.optional(), ...when }).strict(),
]), '预览不产生账务副作用；退款预览后提交到 refunds 子资源');
export const TransactionPreview = resource('TransactionPreview', z.object({
  previewId: uuid, expiresAt: Timestamp, normalizedInputHash: z.string(), kind: TransactionKind,
  settlement: Money, base: Money, exchangeRate: AppliedRate.nullable(),
  accountDeltas: z.array(z.object({ accountId: uuid, delta: Decimal, currency: Currency })),
  warnings: z.array(z.object({ code: z.string(), message: z.string() })),
}), '锁定将入账的汇率；账户版本变化需重新预览');
export const PreviewSubmit = input('PreviewSubmit', z.object({ previewId: uuid }).strict(), '提交服务端保存的预览输入');
