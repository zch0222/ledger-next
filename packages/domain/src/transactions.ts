import { randomUUID } from 'node:crypto';
import { and, asc, desc, eq, gt, gte, inArray, isNull, like, lt, or, sql, type SQL } from 'drizzle-orm';
import type { z } from 'zod';
import { PreviewSubmit, TransactionPreviewCreate, TransactionQuery } from '@ledger/contracts/finance';
import { database, type Executor, type Tx } from '@ledger/db/index';
import {
  accountPostings,
  accounts,
  billOccurrences,
  categories,
  fxSnapshots,
  tags,
  transactionAmounts,
  transactionLinks,
  transactionTags,
  transactions,
  writePreviews,
} from '@ledger/db/schema';
import { ledgerAccess } from './access';
import { audit, emit } from './audit';
import { localDate } from './dates';
import { canonicalJson, requestFingerprint } from './idempotency';
import type { AuthContext } from './identity';
import { quote } from './fx';
import {
  compare,
  convert,
  crossRate,
  formatAmount,
  parseAmount,
  parseRate,
  signedAmount,
  sum,
  toColumn,
} from './money';
import { appendPostings, reversePostings, type PostingLine } from './postings';
import { DomainError, requireVersion } from './policy';

const PREVIEW_TTL_MS = 10 * 60 * 1000;
type Input = z.infer<typeof TransactionPreviewCreate>;
type Money = { amount: string; currency: string };
export type Rate = {
  snapshotId?: string;
  batchId?: string | null;
  base: string;
  quote: string;
  value: string;
  source: string;
  sourceAt: string | null;
  freshness: 'manual' | 'fresh' | 'delayed' | 'stale' | 'market_closed' | 'missing';
  manualReason: string | null;
};
type Warning = { code: string; message: string };
/** One transaction to write. Everything here is deterministic from the input, so a submit can re-plan and compare. */
type Entry = {
  kind: 'expense' | 'income' | 'transfer' | 'refund';
  accountId: string | null;
  categoryId: string | null;
  tagIds: string[];
  merchant: string | null;
  note: string | null;
  occurredAt: string;
  localDate: string;
  timezone: string;
  refundOf: string | null;
  original: Money;
  settlement: Money;
  base: Money & { estimated: boolean };
  rate: Rate | null;
  postings: PostingLine[];
};
type Plan = { main: Entry; fee: Entry | null };
type AccountRow = typeof accounts.$inferSelect;

const invalid = (code: string, message: string) => new DomainError(422, code, message);
const conflict = (code: string, message: string) => new DomainError(409, code, message);
const SOURCE = 'web' as const; // Session callers; PAT / Agent sources arrive with M6-SERVER.

// ---------- planning (shared by preview and submit) ----------

async function loadAccounts(tx: Tx, ledgerId: string, ids: string[], lock: boolean) {
  const found = new Map<string, AccountRow>();
  for (const id of [...new Set(ids)].sort()) {
    // id order: the same lock order appendPostings uses
    const query = tx
      .select()
      .from(accounts)
      .where(and(eq(accounts.ledgerId, ledgerId), eq(accounts.id, id)));
    const [row] = lock ? await query.for('update') : await query;
    if (!row) throw invalid('ACCOUNT_NOT_FOUND', '账户不存在或不属于该账本');
    if (row.archivedAt) throw invalid('ACCOUNT_ARCHIVED', '账户已归档，不能记账');
    found.set(id, row);
  }
  return found;
}
function amountIn(money: Money, account: AccountRow, field: string) {
  if (money.currency !== account.currency) {
    throw invalid('CURRENCY_MISMATCH', `${field} 币种须与账户币种 ${account.currency} 一致`);
  }
  return parseAmount(money.amount, money.currency);
}
async function checkCategory(tx: Tx, ledgerId: string, categoryId: string | undefined, kind: 'expense' | 'income') {
  if (!categoryId) return null;
  const [row] = await tx
    .select()
    .from(categories)
    .where(and(eq(categories.ledgerId, ledgerId), eq(categories.id, categoryId)));
  if (!row || row.archivedAt || row.kind !== kind) {
    throw invalid('INVALID_CATEGORY', `分类不存在、已归档或不是${kind === 'expense' ? '支出' : '收入'}分类`);
  }
  return row.id;
}
async function checkTags(tx: Tx, ledgerId: string, tagIds: string[] | undefined) {
  const ids = [...new Set(tagIds ?? [])].sort();
  if (!ids.length) return [];
  const rows = await tx
    .select({ id: tags.id })
    .from(tags)
    .where(and(eq(tags.ledgerId, ledgerId), inArray(tags.id, ids), isNull(tags.archivedAt)));
  if (rows.length !== ids.length) throw invalid('INVALID_TAG', '标签不存在或已归档');
  return ids;
}
const choiceRequired = (message: string) => [{ path: 'fxPolicy', message, code: 'choice_required' }];
/** Market reference rate at the transaction instant (M3-FX). Missing or stale quotes require an explicit user choice. */
async function marketRate(
  tx: Tx,
  from: string,
  to: string,
  at: string,
  policy: string,
  warnings: Warning[],
): Promise<Rate> {
  const q = await quote(tx, from, to, new Date(at));
  if (q.freshness === 'missing') {
    throw new DomainError(
      422,
      'FX_RATE_MISSING',
      `暂无 ${from}/${to} 可用汇率：请填写人工汇率，或稍后重试（历史汇率已排队补录）`,
      {},
      choiceRequired('请填写人工汇率或稍后重试'),
    );
  }
  if (q.freshness === 'stale' && policy !== 'accept-stale') {
    throw new DomainError(
      422,
      'FX_RATE_STALE',
      '汇率已过期',
      {},
      choiceRequired('请选择沿用旧率、输入人工汇率或保存草稿'),
    );
  }
  const sourceAt = q.sourceAt?.toISOString() ?? null;
  if (q.freshness === 'delayed') warnings.push({ code: 'FX_DELAYED', message: `汇率更新延迟，报价时间 ${sourceAt}` });
  if (q.freshness === 'stale') {
    warnings.push({ code: 'FX_STALE_ACCEPTED', message: `已确认沿用旧汇率，报价时间 ${sourceAt}` });
  }
  return {
    batchId: q.batchId,
    base: from,
    quote: to,
    value: q.value,
    source: q.source ?? 'market',
    sourceAt,
    freshness: q.freshness,
    manualReason: null,
  };
}
/**
 * Settlement → base. A manual rate needs fxPolicy "manual"; otherwise the market quote at the instant is used.
 * On submit `locked` is the rate the preview showed: it is reused as-is, never re-quoted at a newer price.
 */
async function baseValue(
  tx: Tx,
  input: { fxPolicy: string; manualRate?: { value: string; reason: string } },
  settlement: Money,
  baseCurrency: string,
  at: string,
  locked: Rate | null | undefined,
  warnings: Warning[],
): Promise<{ base: Money & { estimated: boolean }; rate: Rate | null }> {
  if (input.manualRate && input.fxPolicy !== 'manual') {
    throw invalid('INVALID_FX_POLICY', '提供人工汇率时 fxPolicy 须为 manual');
  }
  if (settlement.currency === baseCurrency) return { base: { ...settlement, estimated: false }, rate: null };
  let rate: Rate;
  if (input.fxPolicy === 'manual') {
    if (!input.manualRate) {
      throw new DomainError(
        422,
        'FX_RATE_MISSING',
        '选择人工汇率时请填写汇率与理由',
        {},
        choiceRequired('请填写人工汇率'),
      );
    }
    rate = {
      base: settlement.currency,
      quote: baseCurrency,
      value: parseRate(input.manualRate.value),
      source: 'manual',
      sourceAt: null,
      freshness: 'manual',
      manualReason: input.manualRate.reason,
    };
  } else if (locked !== undefined) {
    if (!locked || locked.base !== settlement.currency || locked.quote !== baseCurrency) {
      throw conflict('PREVIEW_STALE', '汇率条件已变化，请重新预览');
    }
    rate = locked;
  } else rate = await marketRate(tx, settlement.currency, baseCurrency, at, input.fxPolicy, warnings);
  return {
    base: {
      amount: convert(settlement.amount, settlement.currency, rate.value, baseCurrency),
      currency: baseCurrency,
      estimated: false,
    },
    rate,
  };
}
async function refundedSoFar(tx: Tx, ledgerId: string, originalId: string) {
  // Locking read: sees refunds committed after this transaction's snapshot, so two refunds cannot both pass the cap.
  // A refund's original amount is what it gives back in the original payment's currency (equal to settlement unless cross-currency).
  const rows = await tx
    .select({ amount: transactionAmounts.originalAmount })
    .from(transactionAmounts)
    .innerJoin(
      transactions,
      and(
        eq(transactions.ledgerId, transactionAmounts.ledgerId),
        eq(transactions.id, transactionAmounts.transactionId),
      ),
    )
    .where(
      and(
        eq(transactions.ledgerId, ledgerId),
        eq(transactions.refundOf, originalId),
        eq(transactions.status, 'posted'),
      ),
    )
    .for('share');
  return sum(rows.map(r => r.amount));
}

async function plan(
  tx: Tx,
  ledgerId: string,
  baseCurrency: string,
  input: Input,
  lock: boolean,
  locked?: Plan,
): Promise<{
  plan: Plan;
  accountVersions: Record<string, number>;
  balances: Map<string, AccountRow>;
  warnings: Warning[];
}> {
  const warnings: Warning[] = [];
  const when = {
    occurredAt: new Date(input.occurredAt).toISOString(),
    localDate: localDate(new Date(input.occurredAt), input.timezone),
    timezone: input.timezone,
  };
  if (input.kind === 'transfer') {
    if (input.sourceAccountId === input.targetAccountId) throw invalid('SAME_ACCOUNT', '转出与转入账户不能相同');
    const found = await loadAccounts(tx, ledgerId, [input.sourceAccountId, input.targetAccountId], lock);
    const source = found.get(input.sourceAccountId)!;
    const target = found.get(input.targetAccountId)!;
    const sourceAmount = { amount: amountIn(input.sourceAmount, source, '转出金额'), currency: source.currency };
    const targetAmount = { amount: amountIn(input.targetAmount, target, '转入金额'), currency: target.currency };
    if (source.currency === target.currency && compare(sourceAmount.amount, targetAmount.amount) !== 0) {
      throw invalid('TRANSFER_AMOUNT_MISMATCH', '同币种转账的转出与转入金额必须相等；手续费请单独填写');
    }
    let valued: { base: Money & { estimated: boolean }; rate: Rate | null };
    if (source.currency !== baseCurrency && target.currency === baseCurrency) {
      // The transfer itself states the rate: what left the source bought exactly this much base currency.
      valued = {
        base: { ...targetAmount, estimated: false },
        rate: {
          base: source.currency,
          quote: target.currency,
          value: crossRate(sourceAmount.amount, targetAmount.amount),
          source: 'transfer',
          sourceAt: null,
          freshness: 'manual',
          manualReason: '由转账双方金额推算',
        },
      };
    } else {
      valued = await baseValue(tx, input, sourceAmount, baseCurrency, when.occurredAt, locked?.main.rate, warnings);
    }
    const main: Entry = {
      kind: 'transfer',
      accountId: null,
      categoryId: null,
      tagIds: [],
      merchant: null,
      note: input.note ?? null,
      ...when,
      refundOf: null,
      original: sourceAmount,
      settlement: sourceAmount,
      ...valued,
      postings: [
        { accountId: source.id, amount: signedAmount('transfer_out', sourceAmount.amount) },
        { accountId: target.id, amount: signedAmount('transfer_in', targetAmount.amount) },
      ],
    };
    let fee: Entry | null = null;
    if (input.fee) {
      const feeAmount = { amount: amountIn(input.fee.amount, source, '手续费'), currency: source.currency };
      const base = valued.rate
        ? {
            amount: convert(feeAmount.amount, feeAmount.currency, valued.rate.value, baseCurrency),
            currency: baseCurrency,
            estimated: false,
          }
        : { ...feeAmount, estimated: false };
      fee = {
        kind: 'expense',
        accountId: source.id,
        categoryId: await checkCategory(tx, ledgerId, input.fee.categoryId, 'expense'),
        tagIds: [],
        merchant: null,
        note: '转账手续费',
        ...when,
        refundOf: null,
        original: feeAmount,
        settlement: feeAmount,
        base,
        rate: valued.rate,
        postings: [{ accountId: source.id, amount: signedAmount('expense', feeAmount.amount) }],
      };
    }
    return {
      plan: { main, fee },
      accountVersions: { [source.id]: source.version, [target.id]: target.version },
      balances: found,
      warnings,
    };
  }
  if (input.kind === 'refund') {
    const originalQuery = tx
      .select()
      .from(transactions)
      .where(and(eq(transactions.ledgerId, ledgerId), eq(transactions.id, input.originalTransactionId)));
    const [original] = lock ? await originalQuery.for('update') : await originalQuery; // submit must see the latest status
    if (!original) throw invalid('ORIGINAL_NOT_FOUND', '原交易不存在');
    if (original.kind !== 'expense' || original.status !== 'posted') {
      throw invalid('NOT_REFUNDABLE', '只能对有效的支出登记退款');
    }
    const [paid] = await tx
      .select()
      .from(transactionAmounts)
      .where(and(eq(transactionAmounts.ledgerId, ledgerId), eq(transactionAmounts.transactionId, original.id)));
    const found = await loadAccounts(tx, ledgerId, [input.accountId], lock);
    const account = found.get(input.accountId)!;
    const settlement = { amount: amountIn(input.settlement, account, '退款金额'), currency: account.currency };
    // `refunded` is what goes back in the original payment's currency; it drives the cap and the base offset.
    let refunded: Money = settlement;
    if (account.currency !== paid.settlementCurrency || input.originalAmount) {
      if (!input.originalAmount) {
        throw invalid(
          'ORIGINAL_AMOUNT_REQUIRED',
          `跨币种退款需填写按原支付币种 ${paid.settlementCurrency} 计的退款金额`,
        );
      }
      if (input.originalAmount.currency !== paid.settlementCurrency) {
        throw invalid('CURRENCY_MISMATCH', `退款对应金额须为原支付币种 ${paid.settlementCurrency}`);
      }
      refunded = {
        amount: parseAmount(input.originalAmount.amount, input.originalAmount.currency),
        currency: paid.settlementCurrency,
      };
      if (account.currency === paid.settlementCurrency && compare(refunded.amount, settlement.amount) !== 0) {
        throw invalid('REFUND_AMOUNT_MISMATCH', '同币种退款的对应金额须与退款金额一致');
      }
    }
    const remaining = sum([paid.settlementAmount]).minus(await refundedSoFar(tx, ledgerId, original.id));
    if (remaining.lessThan(refunded.amount)) {
      throw conflict(
        'REFUND_EXCEEDS_PAID',
        `退款累计不能超过原支付金额，可退 ${formatAmount(remaining, paid.settlementCurrency)} ${paid.settlementCurrency}`,
      );
    }
    // A refund is valued at the original's locked rate, so it offsets exactly what the expense counted.
    let originalRate: Rate | null = null;
    let base: Money = refunded;
    if (paid.fxSnapshotId) {
      const [snapshot] = await tx
        .select()
        .from(fxSnapshots)
        .where(and(eq(fxSnapshots.ledgerId, ledgerId), eq(fxSnapshots.id, paid.fxSnapshotId)));
      originalRate = {
        snapshotId: snapshot.id,
        base: snapshot.baseCurrency,
        quote: snapshot.quoteCurrency,
        value: sum([snapshot.rate]).toFixed(),
        source: snapshot.source,
        sourceAt: snapshot.sourceAt?.toISOString() ?? null,
        freshness: snapshot.freshness,
        manualReason: snapshot.manualReason,
      };
      base = {
        amount: convert(refunded.amount, refunded.currency, originalRate.value, paid.baseCurrency),
        currency: paid.baseCurrency,
      };
    }
    let rate: Rate | null = null;
    // Money received in the base currency is its own valuation; any difference to the original is an FX effect.
    if (settlement.currency === paid.baseCurrency) base = settlement;
    else if (settlement.currency === refunded.currency) rate = originalRate;
    else {
      if (compare(base.amount, '0') <= 0) throw invalid('REFUND_TOO_SMALL', '退款金额过小，无法折算');
      rate = {
        base: settlement.currency,
        quote: base.currency,
        value: crossRate(settlement.amount, base.amount),
        source: 'refund',
        sourceAt: null,
        freshness: 'manual',
        manualReason: '由跨币种退款金额推算',
      };
    }
    const main: Entry = {
      kind: 'refund',
      accountId: account.id,
      categoryId: original.categoryId,
      tagIds: [],
      merchant: original.merchant,
      note: input.note ?? null,
      ...when,
      refundOf: original.id,
      original: refunded,
      settlement,
      base: { ...base, estimated: false },
      rate,
      postings: [{ accountId: account.id, amount: signedAmount('refund', settlement.amount) }],
    };
    return { plan: { main, fee: null }, accountVersions: { [account.id]: account.version }, balances: found, warnings };
  }
  const found = await loadAccounts(tx, ledgerId, [input.accountId], lock);
  const account = found.get(input.accountId)!;
  const settlement = { amount: amountIn(input.settlement, account, '结算金额'), currency: account.currency };
  const original = input.original
    ? { amount: parseAmount(input.original.amount, input.original.currency), currency: input.original.currency }
    : settlement;
  const main: Entry = {
    kind: input.kind,
    accountId: account.id,
    categoryId: await checkCategory(tx, ledgerId, input.categoryId, input.kind),
    tagIds: await checkTags(tx, ledgerId, input.tagIds),
    merchant: input.merchant ?? null,
    note: input.note ?? null,
    ...when,
    refundOf: null,
    original,
    settlement,
    ...(await baseValue(tx, input, settlement, baseCurrency, when.occurredAt, locked?.main.rate, warnings)),
    postings: [{ accountId: account.id, amount: signedAmount(input.kind, settlement.amount) }],
  };
  return { plan: { main, fee: null }, accountVersions: { [account.id]: account.version }, balances: found, warnings };
}

function deltas(p: Plan) {
  const lines = [...p.main.postings, ...(p.fee?.postings ?? [])];
  const byAccount = new Map<string, string[]>();
  for (const line of lines) byAccount.set(line.accountId, [...(byAccount.get(line.accountId) ?? []), line.amount]);
  return byAccount;
}
const appliedRate = (rate: Rate | null) =>
  rate && {
    value: rate.value,
    base: rate.base,
    quote: rate.quote,
    sourceAt: rate.sourceAt,
    freshness: rate.freshness,
    source: rate.source,
    manualReason: rate.manualReason,
  };

export async function createPreview(ctx: AuthContext, ledgerId: string, body: unknown) {
  const input = TransactionPreviewCreate.parse(body);
  return database().transaction(async tx => {
    const ledger = await ledgerAccess(tx, ctx, ledgerId, 'editor');
    const {
      plan: p,
      accountVersions,
      balances,
      warnings: fxWarnings,
    } = await plan(tx, ledgerId, ledger.baseCurrency, input, false);
    const accountDeltas = [...deltas(p)].map(([accountId, amounts]) => ({
      accountId,
      delta: formatAmount(sum(amounts), balances.get(accountId)!.currency),
      currency: balances.get(accountId)!.currency,
    }));
    const warnings = [
      ...fxWarnings,
      ...accountDeltas.flatMap(d => {
        const account = balances.get(d.accountId)!;
        return account.type !== 'credit_card' && sum([account.balance, d.delta]).isNegative()
          ? [{ code: 'NEGATIVE_BALANCE', message: `${account.name} 记账后余额为负` }]
          : [];
      }),
    ];
    const id = randomUUID();
    const now = new Date();
    const expiresAt = new Date(now.getTime() + PREVIEW_TTL_MS);
    const normalizedInputHash = `sha256:${requestFingerprint(input)}`;
    await tx.insert(writePreviews).values({
      id,
      ledgerId,
      actorId: ctx.userId,
      kind: input.kind,
      bodyHash: normalizedInputHash.slice(7),
      normalizedInput: input,
      computed: p,
      accountVersions,
      expiresAt,
      createdAt: now,
    });
    return {
      previewId: id,
      expiresAt: expiresAt.toISOString(),
      normalizedInputHash,
      kind: input.kind,
      settlement: p.main.settlement,
      base: { amount: p.main.base.amount, currency: p.main.base.currency },
      exchangeRate: appliedRate(p.main.rate),
      accountDeltas,
      warnings,
    };
  });
}

// ---------- writing ----------

/** Locks and validates a preview, re-plans it under account locks and requires the same result before consuming it. */
async function consume(
  tx: Tx,
  ctx: AuthContext,
  ledgerId: string,
  baseCurrency: string,
  body: unknown,
  kinds: readonly Entry['kind'][],
) {
  const { previewId } = PreviewSubmit.parse(body);
  const [preview] = await tx
    .select()
    .from(writePreviews)
    .where(
      and(eq(writePreviews.id, previewId), eq(writePreviews.ledgerId, ledgerId), eq(writePreviews.actorId, ctx.userId)),
    )
    .for('update');
  if (!preview) throw invalid('PREVIEW_NOT_FOUND', '预览不存在或不属于当前用户');
  if (preview.consumedAt) throw conflict('PREVIEW_CONSUMED', '该预览已提交；如需再记一笔请重新预览');
  if (preview.expiresAt <= new Date()) throw invalid('PREVIEW_EXPIRED', '预览已过期，请重新预览');
  if (!kinds.includes(preview.kind)) throw invalid('PREVIEW_KIND_MISMATCH', '预览类型与该操作不符');
  // Re-plan under account locks with the preview's locked rate, so only account / catalog changes can make it stale.
  const replanned = await plan(
    tx,
    ledgerId,
    baseCurrency,
    preview.normalizedInput as Input,
    true,
    preview.computed as Plan,
  );
  if (
    canonicalJson(replanned.accountVersions) !== canonicalJson(preview.accountVersions) ||
    canonicalJson(replanned.plan) !== canonicalJson(preview.computed)
  ) {
    throw conflict('PREVIEW_STALE', '账户、分类或金额条件已变化，请重新预览');
  }
  return { preview, plan: preview.computed as Plan };
}

type Source = 'web' | 'import' | 'subscription';
async function writeEntry(
  tx: Tx,
  ctx: AuthContext,
  ledgerId: string,
  entry: Entry,
  replacesId: string | null,
  source: Source = SOURCE,
) {
  const id = randomUUID();
  const now = new Date();
  await tx.insert(transactions).values({
    id,
    ledgerId,
    kind: entry.kind,
    occurredAt: new Date(entry.occurredAt),
    localDate: entry.localDate,
    timezone: entry.timezone,
    accountId: entry.accountId,
    categoryId: entry.categoryId,
    merchant: entry.merchant,
    note: entry.note,
    refundOf: entry.refundOf,
    replacesId,
    source,
    createdBy: ctx.userId,
    createdAt: now,
    updatedAt: now,
  });
  let snapshotId = entry.rate?.snapshotId ?? null;
  if (entry.rate && !snapshotId) {
    snapshotId = randomUUID();
    await tx.insert(fxSnapshots).values({
      id: snapshotId,
      ledgerId,
      baseCurrency: entry.rate.base,
      quoteCurrency: entry.rate.quote,
      rate: entry.rate.value,
      source: entry.rate.source,
      sourceAt: entry.rate.sourceAt ? new Date(entry.rate.sourceAt) : null,
      freshness: entry.rate.freshness,
      batchId: entry.rate.batchId ?? null,
      manualReason: entry.rate.manualReason,
      createdBy: ctx.userId,
      createdAt: now,
    });
  }
  await tx.insert(transactionAmounts).values({
    ledgerId,
    transactionId: id,
    originalAmount: toColumn(entry.original.amount),
    originalCurrency: entry.original.currency,
    settlementAmount: toColumn(entry.settlement.amount),
    settlementCurrency: entry.settlement.currency,
    baseAmount: toColumn(entry.base.amount),
    baseCurrency: entry.base.currency,
    baseEstimated: entry.base.estimated,
    fxSnapshotId: snapshotId,
  });
  if (entry.tagIds.length) {
    await tx.insert(transactionTags).values(entry.tagIds.map(tagId => ({ ledgerId, transactionId: id, tagId })));
  }
  await appendPostings(tx, ledgerId, id, entry.postings);
  return id;
}
async function writePlan(
  tx: Tx,
  ctx: AuthContext,
  ledgerId: string,
  p: Plan,
  replacesId: string | null,
  action: string,
  source: Source = SOURCE,
) {
  const id = await writeEntry(tx, ctx, ledgerId, p.main, replacesId, source);
  if (p.fee) {
    await tx
      .insert(transactionLinks)
      .values({ ledgerId, childId: await writeEntry(tx, ctx, ledgerId, p.fee, null), parentId: id, kind: 'fee' });
  }
  await audit(tx, ctx, ledgerId, action, id);
  await emit(tx, ledgerId, action, { transactionId: id, kind: p.main.kind, replacesId });
  return id;
}
async function markConsumed(tx: Tx, previewId: string, transactionId: string) {
  await tx
    .update(writePreviews)
    .set({ consumedAt: new Date(), consumedBy: transactionId })
    .where(eq(writePreviews.id, previewId));
}

export async function createTransaction(
  ctx: AuthContext,
  ledgerId: string,
  body: unknown,
  db: Executor = database(),
  options: { source?: Source; kinds?: readonly Entry['kind'][] } = {},
) {
  return db.transaction(async tx => {
    const ledger = await ledgerAccess(tx, ctx, ledgerId, 'editor', true);
    const { preview, plan: p } = await consume(
      tx,
      ctx,
      ledgerId,
      ledger.baseCurrency,
      body,
      options.kinds ?? ['expense', 'income', 'transfer'],
    );
    const id = await writePlan(tx, ctx, ledgerId, p, null, 'transaction.created', options.source);
    await markConsumed(tx, preview.id, id);
    return (await present(tx, ledgerId, [id]))[0];
  });
}

async function lockTransaction(tx: Tx, ledgerId: string, id: string) {
  const [row] = await tx
    .select()
    .from(transactions)
    .where(and(eq(transactions.ledgerId, ledgerId), eq(transactions.id, id)))
    .for('update');
  if (!row) throw new DomainError(404, 'NOT_FOUND', '交易不存在或你没有访问权限');
  return row;
}
async function hasPostedRefunds(tx: Tx, ledgerId: string, id: string) {
  const [row] = await tx
    .select({ id: transactions.id })
    .from(transactions)
    .where(and(eq(transactions.ledgerId, ledgerId), eq(transactions.refundOf, id), eq(transactions.status, 'posted')))
    .limit(1)
    .for('share');
  return Boolean(row);
}
async function feeOf(tx: Tx, ledgerId: string, id: string) {
  const [link] = await tx
    .select({ childId: transactionLinks.childId })
    .from(transactionLinks)
    .where(and(eq(transactionLinks.ledgerId, ledgerId), eq(transactionLinks.parentId, id)));
  return link?.childId ?? null;
}
/** Voids one row: reversing postings, status and version in the same DB transaction; history stays readable. */
async function voidRow(tx: Tx, ledgerId: string, row: typeof transactions.$inferSelect) {
  await reversePostings(tx, ledgerId, row.id);
  const now = new Date();
  await tx
    .update(transactions)
    .set({ status: 'voided', voidedAt: now, version: row.version + 1, updatedAt: now })
    .where(and(eq(transactions.ledgerId, ledgerId), eq(transactions.id, row.id)));
  // A voided payment no longer pays its bill; the occurrence becomes payable again (status re-derived from its date).
  await tx
    .update(billOccurrences)
    .set({
      status: 'scheduled',
      transactionId: null,
      paidAt: null,
      version: sql`${billOccurrences.version} + 1`,
      updatedAt: now,
    })
    .where(and(eq(billOccurrences.ledgerId, ledgerId), eq(billOccurrences.transactionId, row.id)));
  const fee = row.kind === 'transfer' ? await feeOf(tx, ledgerId, row.id) : null;
  if (fee) {
    const child = await lockTransaction(tx, ledgerId, fee);
    if (child.status === 'posted') await voidRow(tx, ledgerId, child);
  }
}

export async function voidTransaction(ctx: AuthContext, ledgerId: string, id: string, etag: string | null) {
  return database().transaction(async tx => {
    await ledgerAccess(tx, ctx, ledgerId, 'editor', true);
    const row = await lockTransaction(tx, ledgerId, id);
    if (!etag) requireVersion(etag, row.version);
    if (row.status === 'voided') return (await present(tx, ledgerId, [id]))[0]; // repeating a void changes nothing
    requireVersion(etag, row.version);
    if (await hasPostedRefunds(tx, ledgerId, id)) throw conflict('HAS_REFUNDS', '该支出已有退款，请先作废退款');
    await voidRow(tx, ledgerId, row);
    await audit(tx, ctx, ledgerId, 'transaction.voided', id);
    await emit(tx, ledgerId, 'transaction.voided', { transactionId: id, kind: row.kind });
    return (await present(tx, ledgerId, [id]))[0];
  });
}

/** Correction = reverse the posted version and write a new version (replacesId) in one DB transaction. */
export async function correctTransaction(
  ctx: AuthContext,
  ledgerId: string,
  id: string,
  body: unknown,
  etag: string | null,
  db: Executor = database(),
) {
  return db.transaction(async tx => {
    const ledger = await ledgerAccess(tx, ctx, ledgerId, 'editor', true);
    const row = await lockTransaction(tx, ledgerId, id);
    requireVersion(etag, row.version);
    if (row.status !== 'posted') throw conflict('TRANSACTION_VOIDED', '已作废或已被更正的交易不能再更正');
    if (row.kind === 'refund') throw invalid('NOT_CORRECTABLE', '退款请作废后重新登记');
    if (await hasPostedRefunds(tx, ledgerId, id)) throw conflict('HAS_REFUNDS', '该支出已有退款，请先作废退款再更正');
    const { preview, plan: p } = await consume(tx, ctx, ledgerId, ledger.baseCurrency, body, [row.kind]);
    const [bill] = await tx
      .select({ id: billOccurrences.id })
      .from(billOccurrences)
      .where(and(eq(billOccurrences.ledgerId, ledgerId), eq(billOccurrences.transactionId, row.id)))
      .for('update');
    await voidRow(tx, ledgerId, row);
    const next = await writePlan(tx, ctx, ledgerId, p, row.id, 'transaction.corrected');
    // A corrected transfer fee stays attached to its transfer; a corrected bill payment keeps paying its bill.
    await tx
      .update(transactionLinks)
      .set({ childId: next })
      .where(and(eq(transactionLinks.ledgerId, ledgerId), eq(transactionLinks.childId, row.id)));
    if (bill) {
      await tx
        .update(billOccurrences)
        .set({
          status: 'paid',
          transactionId: next,
          paidAt: new Date(),
          version: sql`${billOccurrences.version} + 1`,
          updatedAt: new Date(),
        })
        .where(and(eq(billOccurrences.ledgerId, ledgerId), eq(billOccurrences.id, bill.id)));
    }
    await markConsumed(tx, preview.id, next);
    return (await present(tx, ledgerId, [next]))[0];
  });
}

export async function createRefund(
  ctx: AuthContext,
  ledgerId: string,
  originalId: string,
  body: unknown,
  db: Executor = database(),
) {
  return db.transaction(async tx => {
    const ledger = await ledgerAccess(tx, ctx, ledgerId, 'editor', true);
    await lockTransaction(tx, ledgerId, originalId); // serializes refunds of one expense
    const { preview, plan: p } = await consume(tx, ctx, ledgerId, ledger.baseCurrency, body, ['refund']);
    if (p.main.refundOf !== originalId) throw invalid('PREVIEW_KIND_MISMATCH', '退款预览针对的是另一笔交易');
    const id = await writePlan(tx, ctx, ledgerId, p, null, 'refund.created');
    await markConsumed(tx, preview.id, id);
    return (await present(tx, ledgerId, [id]))[0];
  });
}

// ---------- imports (M2-IMPORT) ----------

/** A pre-validated CSV row: amounts and the locked rate were computed at validation and are booked unchanged. */
export type ImportedEntry = {
  kind: 'expense' | 'income';
  accountId: string;
  categoryId: string | null;
  merchant: string | null;
  note: string | null;
  occurredAt: string;
  localDate: string;
  timezone: string;
  settlement: Money;
  base: Money;
  rate: Rate | null;
};
/** Books one import row with source "import" inside the caller's transaction (audit + outbox included). */
export async function bookImportedEntry(tx: Tx, ctx: AuthContext, ledgerId: string, row: ImportedEntry) {
  const entry: Entry = {
    kind: row.kind,
    accountId: row.accountId,
    categoryId: row.categoryId,
    tagIds: [],
    merchant: row.merchant,
    note: row.note,
    occurredAt: row.occurredAt,
    localDate: row.localDate,
    timezone: row.timezone,
    refundOf: null,
    original: row.settlement,
    settlement: row.settlement,
    base: { ...row.base, estimated: false },
    rate: row.rate,
    postings: [{ accountId: row.accountId, amount: signedAmount(row.kind, row.settlement.amount) }],
  };
  const id = await writeEntry(tx, ctx, ledgerId, entry, null, 'import');
  await audit(tx, ctx, ledgerId, 'transaction.imported', id);
  await emit(tx, ledgerId, 'transaction.created', {
    transactionId: id,
    kind: row.kind,
    replacesId: null,
    source: 'import',
  });
  return id;
}
/** Voids one imported transaction for a batch reversal; a refunded expense is left alone and reported. */
export async function voidImportedTransaction(
  tx: Tx,
  ctx: AuthContext,
  ledgerId: string,
  id: string,
): Promise<'voided' | 'already_voided' | 'has_refunds'> {
  const row = await lockTransaction(tx, ledgerId, id);
  if (row.status === 'voided') return 'already_voided';
  if (await hasPostedRefunds(tx, ledgerId, id)) return 'has_refunds';
  await voidRow(tx, ledgerId, row);
  await audit(tx, ctx, ledgerId, 'transaction.voided', id);
  await emit(tx, ledgerId, 'transaction.voided', { transactionId: id, kind: row.kind, source: 'import_reversal' });
  return 'voided';
}

// ---------- reading ----------

async function present(db: Executor | Tx, ledgerId: string, ids: string[]) {
  if (!ids.length) return [];
  const rows = await db
    .select()
    .from(transactions)
    .where(and(eq(transactions.ledgerId, ledgerId), inArray(transactions.id, ids)));
  const amounts = new Map(
    (
      await db
        .select()
        .from(transactionAmounts)
        .where(and(eq(transactionAmounts.ledgerId, ledgerId), inArray(transactionAmounts.transactionId, ids)))
    ).map(a => [a.transactionId, a]),
  );
  const snapshotIds = [...amounts.values()].map(a => a.fxSnapshotId).filter((v): v is string => Boolean(v));
  const snapshots = new Map(
    snapshotIds.length
      ? (
          await db
            .select()
            .from(fxSnapshots)
            .where(and(eq(fxSnapshots.ledgerId, ledgerId), inArray(fxSnapshots.id, snapshotIds)))
        ).map(s => [s.id, s])
      : [],
  );
  const tagRows = await db
    .select()
    .from(transactionTags)
    .where(and(eq(transactionTags.ledgerId, ledgerId), inArray(transactionTags.transactionId, ids)));
  const transferIds = rows.filter(r => r.kind === 'transfer').map(r => r.id);
  const lines = transferIds.length
    ? await db
        .select()
        .from(accountPostings)
        .where(
          and(
            eq(accountPostings.ledgerId, ledgerId),
            inArray(accountPostings.transactionId, transferIds),
            isNull(accountPostings.reversesId),
          ),
        )
    : [];
  // Only voided rows can have been replaced; the (ledger_id, replaces_id) foreign-key index serves this lookup.
  const voidedIds = rows.filter(r => r.status === 'voided').map(r => r.id);
  const replacedBy = new Map(
    voidedIds.length
      ? (
          await db
            .select({ id: transactions.id, replacesId: transactions.replacesId })
            .from(transactions)
            .where(and(eq(transactions.ledgerId, ledgerId), inArray(transactions.replacesId, voidedIds)))
        ).map(r => [r.replacesId!, r.id])
      : [],
  );
  const fees = new Map(
    transferIds.length
      ? (
          await db
            .select()
            .from(transactionLinks)
            .where(and(eq(transactionLinks.ledgerId, ledgerId), inArray(transactionLinks.parentId, transferIds)))
        ).map(l => [l.parentId, l.childId])
      : [],
  );
  const byId = new Map(
    rows.map(row => {
      const a = amounts.get(row.id)!;
      const s = a.fxSnapshotId ? snapshots.get(a.fxSnapshotId)! : null;
      const out = lines.find(l => l.transactionId === row.id && compare(l.signedAmount, '0') < 0);
      const into = lines.find(l => l.transactionId === row.id && compare(l.signedAmount, '0') > 0);
      return [
        row.id,
        {
          id: row.id,
          kind: row.kind,
          status: row.status,
          occurredAt: row.occurredAt.toISOString(),
          localDate: row.localDate,
          timezone: row.timezone,
          accountId: row.accountId,
          categoryId: row.categoryId,
          tagIds: tagRows
            .filter(t => t.transactionId === row.id)
            .map(t => t.tagId)
            .sort(),
          merchant: row.merchant,
          note: row.note,
          original: { amount: formatAmount(a.originalAmount, a.originalCurrency), currency: a.originalCurrency },
          settlement: {
            amount: formatAmount(a.settlementAmount, a.settlementCurrency),
            currency: a.settlementCurrency,
          },
          base: {
            amount: formatAmount(a.baseAmount, a.baseCurrency),
            currency: a.baseCurrency,
            estimated: a.baseEstimated,
          },
          exchangeRate: s && {
            value: sum([s.rate]).toFixed(),
            base: s.baseCurrency,
            quote: s.quoteCurrency,
            sourceAt: s.sourceAt?.toISOString() ?? null,
            freshness: s.freshness,
            source: s.source,
            manualReason: s.manualReason,
          },
          transfer:
            out && into
              ? {
                  sourceAccountId: out.accountId,
                  targetAccountId: into.accountId,
                  sourceAmount: {
                    amount: formatAmount(sum([out.signedAmount]).negated(), out.currency),
                    currency: out.currency,
                  },
                  targetAmount: { amount: formatAmount(into.signedAmount, into.currency), currency: into.currency },
                  feeTransactionId: fees.get(row.id) ?? null,
                }
              : null,
          refundOf: row.refundOf,
          replacesId: row.replacesId,
          replacedById: replacedBy.get(row.id) ?? null,
          source: row.source,
          version: row.version,
          createdAt: row.createdAt.toISOString(),
          updatedAt: row.updatedAt.toISOString(),
        },
      ];
    }),
  );
  return ids.map(id => byId.get(id)!);
}

export async function getTransaction(ctx: AuthContext, ledgerId: string, id: string, db: Executor | Tx = database()) {
  await ledgerAccess(db, ctx, ledgerId, 'viewer');
  const [found] = await present(db, ledgerId, [id]);
  if (!found) throw new DomainError(404, 'NOT_FOUND', '交易不存在或你没有访问权限');
  return found;
}

/** Refund history of an expense and what can still be refunded (in its settlement currency). */
export async function refundsOf(ctx: AuthContext, ledgerId: string, id: string) {
  await ledgerAccess(database(), ctx, ledgerId, 'viewer');
  const rows = await database()
    .select({ id: transactions.id, original: transactionAmounts.originalAmount })
    .from(transactions)
    .innerJoin(
      transactionAmounts,
      and(
        eq(transactionAmounts.ledgerId, transactions.ledgerId),
        eq(transactionAmounts.transactionId, transactions.id),
      ),
    )
    .where(and(eq(transactions.ledgerId, ledgerId), eq(transactions.refundOf, id), eq(transactions.status, 'posted')));
  const [paid] = await database()
    .select()
    .from(transactionAmounts)
    .where(and(eq(transactionAmounts.ledgerId, ledgerId), eq(transactionAmounts.transactionId, id)));
  return {
    refunds: await present(
      database(),
      ledgerId,
      rows.map(r => r.id),
    ),
    remaining: paid
      ? formatAmount(sum([paid.settlementAmount]).minus(sum(rows.map(r => r.original))), paid.settlementCurrency)
      : null,
  };
}

type Query = z.infer<typeof TransactionQuery>;
/** Keyset position: [localDate, id] for date sorts, [baseAmount, id] for amount sorts. */
export async function listTransactions(
  ctx: AuthContext,
  ledgerId: string,
  query: Omit<Query, 'limit' | 'cursor'> & { limit: number; after?: [string, string] },
) {
  await ledgerAccess(database(), ctx, ledgerId, 'viewer');
  const byAmount = query.sort.endsWith('amount');
  const descending = query.sort.startsWith('-');
  const key = byAmount ? transactionAmounts.baseAmount : transactions.localDate;
  const [beyond, order] = descending ? [lt, desc] : [gt, asc];
  const conditions: (SQL | undefined)[] = [
    eq(transactions.ledgerId, ledgerId),
    query.status === 'all' ? undefined : eq(transactions.status, query.status),
    query.dateFrom ? gte(transactions.localDate, query.dateFrom) : undefined,
    query.dateTo ? lt(transactions.localDate, query.dateTo) : undefined,
    query.kind ? eq(transactions.kind, query.kind) : undefined,
    query.categoryId ? eq(transactions.categoryId, query.categoryId) : undefined,
    // Transfers have no account_id; their accounts live on the postings.
    query.accountId
      ? inArray(
          transactions.id,
          database()
            .select({ id: accountPostings.transactionId })
            .from(accountPostings)
            .where(and(eq(accountPostings.ledgerId, ledgerId), eq(accountPostings.accountId, query.accountId))),
        )
      : undefined,
    query.q
      ? or(
          like(transactions.merchant, `%${query.q.replace(/[\\%_]/g, '\\$&')}%`),
          like(transactions.note, `%${query.q.replace(/[\\%_]/g, '\\$&')}%`),
        )
      : undefined,
    query.after
      ? or(beyond(key, query.after[0]), and(eq(key, query.after[0]), beyond(transactions.id, query.after[1])))
      : undefined,
  ];
  const rows = await database()
    .select({ id: transactions.id, localDate: transactions.localDate, baseAmount: transactionAmounts.baseAmount })
    .from(transactions)
    .innerJoin(
      transactionAmounts,
      and(
        eq(transactionAmounts.ledgerId, transactions.ledgerId),
        eq(transactionAmounts.transactionId, transactions.id),
      ),
    )
    .where(and(...conditions))
    .orderBy(order(key), order(transactions.id))
    .limit(query.limit + 1);
  return {
    rows,
    position: (row: (typeof rows)[number]) => [byAmount ? row.baseAmount : row.localDate, row.id] as [string, string],
    present: (ids: string[]) => present(database(), ledgerId, ids),
  };
}

/** Worker housekeeping: previews expire after 10 minutes; drop them a day later in small batches. */
export async function pruneExpiredPreviews(now = new Date()) {
  const [result] = await database()
    .delete(writePreviews)
    .where(lt(writePreviews.expiresAt, new Date(now.getTime() - 24 * 60 * 60 * 1000)))
    .limit(1000);
  return result.affectedRows;
}
