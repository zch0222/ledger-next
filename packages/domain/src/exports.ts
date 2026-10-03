import { createHash, randomUUID } from 'node:crypto';
import { and, asc, desc, eq, gte, inArray, lt, or } from 'drizzle-orm';
import { ExportJobCreate } from '../../contracts/src/platform';
import { database, type Executor } from '../../db/src/index';
import {
  accountPostings,
  accounts,
  categories,
  exportJobs,
  tags,
  transactionAmounts,
  transactionTags,
  transactions,
} from '../../db/src/schema';
import { ledgerAccess } from './access';
import { audit, emit } from './audit';
import { csvLine } from './csv';
import type { AuthContext, Keyset } from './identity';
import { formatAmount, sum } from './money';
import { DomainError } from './policy';

export const EXPORT_TTL_MS = 60 * 60 * 1000;
export const EXPORT_MAX_ROWS = 100_000;
const KIND_LABEL = { expense: '支出', income: '收入', transfer: '转账', refund: '退款' } as const;
export const EXPORT_HEADER = [
  '日期',
  '类型',
  '账户',
  '金额',
  '币种',
  '基准金额',
  '基准币种',
  '分类',
  '商家',
  '备注',
  '标签',
  '转入账户',
  '转入金额',
  '转入币种',
  '关联交易ID',
  '交易ID',
];
type JobRow = typeof exportJobs.$inferSelect;
const notFound = () => new DomainError(404, 'NOT_FOUND', '导出任务不存在或你没有访问权限');

const downloadUrl = (job: JobRow, now: Date) =>
  job.status === 'ready' && job.expiresAt && job.expiresAt > now
    ? `/api/v1/ledgers/${job.ledgerId}/export-jobs/${job.id}/file`
    : null;
function present(job: JobRow, now = new Date()) {
  const expired = job.status === 'ready' && job.expiresAt !== null && job.expiresAt <= now;
  return {
    id: job.id,
    status: expired ? ('expired' as const) : job.status,
    format: job.format,
    rowCount: job.rowCount,
    downloadUrl: downloadUrl(job, now),
    expiresAt: job.expiresAt?.toISOString() ?? null,
    createdAt: job.createdAt.toISOString(),
  };
}

export async function createExportJob(ctx: AuthContext, ledgerId: string, input: unknown, db: Executor = database()) {
  const filters = ExportJobCreate.parse(input);
  if (filters.dateFrom && filters.dateTo && filters.dateFrom >= filters.dateTo) {
    throw new DomainError(422, 'INVALID_RANGE', 'dateTo 须晚于 dateFrom（不含当日）');
  }
  return db.transaction(async tx => {
    await ledgerAccess(tx, ctx, ledgerId, 'viewer', true);
    const now = new Date();
    const row = {
      id: randomUUID(),
      ledgerId,
      createdBy: ctx.userId,
      status: 'queued' as const,
      format: 'csv' as const,
      filters,
      createdAt: now,
      updatedAt: now,
    };
    await tx.insert(exportJobs).values(row);
    await audit(tx, ctx, ledgerId, 'export.created', row.id);
    await emit(tx, ledgerId, 'export.run', { exportJobId: row.id });
    return present({
      ...row,
      rowCount: null,
      content: null,
      contentSha256: null,
      failureReason: null,
      expiresAt: null,
      completedAt: null,
    });
  });
}
/** Exports are personal: members see and download only the jobs they created. */
async function ownJob(ctx: AuthContext, ledgerId: string, id: string) {
  await ledgerAccess(database(), ctx, ledgerId, 'viewer');
  const [job] = await database()
    .select()
    .from(exportJobs)
    .where(and(eq(exportJobs.ledgerId, ledgerId), eq(exportJobs.id, id), eq(exportJobs.createdBy, ctx.userId)));
  if (!job) throw notFound();
  return job;
}
export async function getExportJob(ctx: AuthContext, ledgerId: string, id: string) {
  return present(await ownJob(ctx, ledgerId, id));
}
export async function listExportJobs(ctx: AuthContext, ledgerId: string, page: Keyset) {
  await ledgerAccess(database(), ctx, ledgerId, 'viewer');
  const after =
    page.after &&
    or(
      lt(exportJobs.createdAt, new Date(page.after[0])),
      and(eq(exportJobs.createdAt, new Date(page.after[0])), lt(exportJobs.id, page.after[1])),
    );
  const rows = await database()
    .select()
    .from(exportJobs)
    .where(and(eq(exportJobs.ledgerId, ledgerId), eq(exportJobs.createdBy, ctx.userId), after))
    .orderBy(desc(exportJobs.createdAt), desc(exportJobs.id))
    .limit(page.limit + 1);
  return rows.map(row => ({ ...present(row), position: [row.createdAt.toISOString(), row.id] as [string, string] }));
}
/** The file itself: creator only, while the ledger membership lasts and before expiry. */
export async function downloadExport(ctx: AuthContext, ledgerId: string, id: string, now = new Date()) {
  const job = await ownJob(ctx, ledgerId, id);
  if (job.status === 'queued' || job.status === 'running') {
    throw new DomainError(409, 'EXPORT_NOT_READY', '导出仍在生成，请稍后');
  }
  if (job.status !== 'ready' || !job.content || !job.expiresAt || job.expiresAt <= now) {
    throw new DomainError(404, 'EXPORT_EXPIRED', '下载链接已过期，请重新导出');
  }
  return {
    fileName: `ledger-export-${job.createdAt.toISOString().slice(0, 10)}-${job.id.slice(0, 8)}.csv`,
    content: job.content,
  };
}

/**
 * Worker: renders the CSV (UTF-8 BOM for spreadsheet apps). Amounts are always positive with an explicit type column,
 * so numeric cells never begin with "-"; every other cell is formula-escaped by csvLine.
 */
export async function runExport(jobId: string, now = new Date()) {
  return database().transaction(async tx => {
    const [job] = await tx
      .select()
      .from(exportJobs)
      .where(eq(exportJobs.id, jobId))
      .for('update', { skipLocked: true });
    if (!job || (job.status !== 'queued' && job.status !== 'running')) return 'skipped';
    try {
      await ledgerAccess(tx, { userId: job.createdBy, requestId: randomUUID() }, job.ledgerId, 'viewer', true);
    } catch {
      await tx
        .update(exportJobs)
        .set({ status: 'failed', failureReason: '创建者已无访问权限', updatedAt: now })
        .where(eq(exportJobs.id, jobId));
      return 'failed';
    }
    const filters = ExportJobCreate.parse(job.filters);
    const names = new Map(
      (
        await tx
          .select({ id: accounts.id, name: accounts.name })
          .from(accounts)
          .where(eq(accounts.ledgerId, job.ledgerId))
      ).map(a => [a.id, a.name]),
    );
    const categoryNames = new Map(
      (
        await tx
          .select({ id: categories.id, name: categories.name })
          .from(categories)
          .where(eq(categories.ledgerId, job.ledgerId))
      ).map(c => [c.id, c.name]),
    );
    const tagNames = new Map(
      (await tx.select({ id: tags.id, name: tags.name }).from(tags).where(eq(tags.ledgerId, job.ledgerId))).map(t => [
        t.id,
        t.name,
      ]),
    );
    const conditions = [
      eq(transactions.ledgerId, job.ledgerId),
      eq(transactions.status, 'posted'),
      filters.dateFrom ? gte(transactions.localDate, filters.dateFrom) : undefined,
      filters.dateTo ? lt(transactions.localDate, filters.dateTo) : undefined,
      filters.categoryId ? eq(transactions.categoryId, filters.categoryId) : undefined,
      filters.accountId
        ? inArray(
            transactions.id,
            tx
              .select({ id: accountPostings.transactionId })
              .from(accountPostings)
              .where(and(eq(accountPostings.ledgerId, job.ledgerId), eq(accountPostings.accountId, filters.accountId))),
          )
        : undefined,
    ];
    const rows = await tx
      .select({ t: transactions, a: transactionAmounts })
      .from(transactions)
      .innerJoin(
        transactionAmounts,
        and(
          eq(transactionAmounts.ledgerId, transactions.ledgerId),
          eq(transactionAmounts.transactionId, transactions.id),
        ),
      )
      .where(and(...conditions))
      .orderBy(asc(transactions.localDate), asc(transactions.occurredAt), asc(transactions.id))
      .limit(EXPORT_MAX_ROWS + 1);
    if (rows.length > EXPORT_MAX_ROWS) {
      await tx
        .update(exportJobs)
        .set({ status: 'failed', failureReason: `超过 ${EXPORT_MAX_ROWS} 行，请缩小日期范围`, updatedAt: now })
        .where(eq(exportJobs.id, jobId));
      return 'failed';
    }
    const ids = rows.map(r => r.t.id);
    const tagRows = ids.length
      ? await tx
          .select()
          .from(transactionTags)
          .where(and(eq(transactionTags.ledgerId, job.ledgerId), inArray(transactionTags.transactionId, ids)))
      : [];
    const transfers = rows.filter(r => r.t.kind === 'transfer').map(r => r.t.id);
    const lines = transfers.length
      ? await tx
          .select()
          .from(accountPostings)
          .where(and(eq(accountPostings.ledgerId, job.ledgerId), inArray(accountPostings.transactionId, transfers)))
      : [];
    const out = [csvLine(EXPORT_HEADER)];
    for (const { t, a } of rows) {
      const legs = lines.filter(l => l.transactionId === t.id && !l.reversesId);
      const into = legs.find(l => sum([l.signedAmount]).isPositive());
      const from = legs.find(l => sum([l.signedAmount]).isNegative());
      const accountId = t.kind === 'transfer' ? from?.accountId : t.accountId;
      out.push(
        csvLine([
          t.localDate,
          KIND_LABEL[t.kind],
          accountId ? (names.get(accountId) ?? '') : '',
          formatAmount(a.settlementAmount, a.settlementCurrency),
          a.settlementCurrency,
          formatAmount(a.baseAmount, a.baseCurrency),
          a.baseCurrency,
          t.categoryId ? (categoryNames.get(t.categoryId) ?? '') : '',
          t.merchant,
          t.note,
          tagRows
            .filter(x => x.transactionId === t.id)
            .map(x => tagNames.get(x.tagId) ?? '')
            .sort()
            .join(';'),
          into ? (names.get(into.accountId) ?? '') : '',
          into ? formatAmount(into.signedAmount, into.currency) : '',
          into?.currency ?? '',
          t.refundOf,
          t.id,
        ]),
      );
    }
    const content = '﻿' + out.join('\r\n') + '\r\n';
    await tx
      .update(exportJobs)
      .set({
        status: 'ready',
        rowCount: rows.length,
        content,
        contentSha256: createHash('sha256').update(content).digest('hex'),
        expiresAt: new Date(now.getTime() + EXPORT_TTL_MS),
        completedAt: now,
        updatedAt: now,
      })
      .where(eq(exportJobs.id, jobId));
    return 'ready';
  });
}

/** Housekeeping: drop expired files and requeue exports a crashed worker left behind. */
export async function expireExports(now = new Date()) {
  const [result] = await database()
    .update(exportJobs)
    .set({ status: 'expired', content: null, updatedAt: now })
    .where(and(eq(exportJobs.status, 'ready'), lt(exportJobs.expiresAt, now)));
  return result.affectedRows;
}
export async function stalledExportJobs(now = new Date()) {
  return database()
    .select({ id: exportJobs.id, ledgerId: exportJobs.ledgerId })
    .from(exportJobs)
    .where(
      and(
        inArray(exportJobs.status, ['queued', 'running']),
        lt(exportJobs.updatedAt, new Date(now.getTime() - 120_000)),
      ),
    )
    .limit(50);
}
