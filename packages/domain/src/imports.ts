import { createHash, randomUUID } from 'node:crypto';
import { and, asc, desc, eq, inArray, isNotNull, lt, or, sql } from 'drizzle-orm';
import type { z } from 'zod';
import { ImportMapping } from '../../contracts/src/platform';
import { database, type Executor, type Tx } from '../../db/src/index';
import { accounts, categories, importJobs, importRows, ledgers } from '../../db/src/schema';
import { ledgerAccess } from './access';
import { audit, emit } from './audit';
import { zonedInstant } from './dates';
import { CsvError, normalizeAmountCell, normalizeDateCell, normalizeKindCell, parseCsv, unescapeFormula, type DateFormat } from './csv';
import { quote } from './fx';
import type { AuthContext, Keyset } from './identity';
import { convert, negate, parseAmount } from './money';
import { DomainError } from './policy';
import { bookImportedEntry, voidImportedTransaction, type ImportedEntry, type Rate } from './transactions';

export const IMPORT_MAX_BYTES = 5 * 1024 * 1024;
export const IMPORT_MAX_ROWS = 10_000;
const BATCH = 100;
type Mapping = z.infer<typeof ImportMapping>;
type JobRow = typeof importJobs.$inferSelect;
type RowError = { row: number; column: string | null; code: string; message: string };
const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');
const notFound = () => new DomainError(404, 'NOT_FOUND', '导入任务不存在或你没有访问权限');
const duplicate = (error: unknown) => [error, (error as { cause?: unknown })?.cause].some(e => (e as { code?: string })?.code === 'ER_DUP_ENTRY');

// ---------- presentation ----------

async function errorsOf(db: Executor | Tx, jobId: string) {
  const rows = await db.select({ row: importRows.rowNo, column: importRows.errorColumn, code: importRows.errorCode, message: importRows.errorMessage }).from(importRows)
    .where(and(eq(importRows.jobId, jobId), isNotNull(importRows.errorCode))).orderBy(asc(importRows.rowNo)).limit(100);
  return rows.map(r => ({ row: r.row, column: r.column, code: r.code!, message: r.message ?? '' }));
}
async function present(db: Executor | Tx, job: JobRow) {
  const [dupes] = await db.select({ n: sql<number>`COUNT(*)` }).from(importRows).where(and(eq(importRows.jobId, job.id), eq(importRows.status, 'duplicate')));
  return {
    id: job.id, status: job.status, fileName: job.fileName, fileSha256: job.fileSha256, rowCount: job.rowCount, validRows: job.validRows, errorRows: job.errorRows,
    duplicateRows: Number(dupes?.n ?? 0), committedRows: job.committedRows, revertedRows: job.revertedRows, failureReason: job.failureReason,
    errors: await errorsOf(db, job.id), createdAt: job.createdAt.toISOString(), committedAt: job.committedAt?.toISOString() ?? null, revertedAt: job.revertedAt?.toISOString() ?? null,
  };
}

// ---------- request side (web) ----------

/** Stores the upload and queues validation. Only the mapping and header are checked synchronously. */
export async function createImportJob(ctx: AuthContext, ledgerId: string, upload: { fileName: string; content: string; mapping: string }, db: Executor = database()) {
  let mapping: Mapping;
  try { mapping = ImportMapping.parse(JSON.parse(upload.mapping)); } catch { throw new DomainError(422, 'INVALID_MAPPING', '列映射无效：需为 ImportMapping JSON', {}, [{ path: 'mapping', message: '请检查列映射' }]); }
  if (Buffer.byteLength(upload.content) > IMPORT_MAX_BYTES) throw new DomainError(413, 'PAYLOAD_TOO_LARGE', '文件超过 5 MB 上限');
  if (upload.content.includes('�')) throw new DomainError(422, 'INVALID_ENCODING', '文件不是有效的 UTF-8 编码');
  let header: string[];
  try { header = parseCsv(upload.content, Infinity, 1)[0] ?? []; } catch (error) { throw new DomainError(422, 'INVALID_CSV', error instanceof CsvError ? `第 ${error.row} 行：${error.message}` : 'CSV 格式无效'); }
  const missing = Object.entries(mapping.columns).filter(([, name]) => !header.map(h => h.trim()).includes(name));
  if (missing.length) throw new DomainError(422, 'MAPPING_COLUMN_MISSING', `表头中找不到映射的列：${missing.map(([, n]) => n).join('、')}`, {}, missing.map(([field, name]) => ({ path: `mapping.columns.${field}`, message: `找不到列 ${name}` })));
  return db.transaction(async tx => {
    await ledgerAccess(tx, ctx, ledgerId, 'editor', true);
    const now = new Date(), id = randomUUID();
    const row = { id, ledgerId, createdBy: ctx.userId, status: 'validating' as const, fileName: upload.fileName.slice(0, 255) || 'import.csv', fileSha256: sha256(upload.content), mapping, content: upload.content, createdAt: now, updatedAt: now };
    await tx.insert(importJobs).values(row);
    await audit(tx, ctx, ledgerId, 'import.created', id);
    await emit(tx, ledgerId, 'import.validate', { importJobId: id });
    return present(tx, (await tx.select().from(importJobs).where(eq(importJobs.id, id)))[0]);
  });
}
async function lockJob(tx: Tx, ledgerId: string, id: string) {
  const [job] = await tx.select().from(importJobs).where(and(eq(importJobs.ledgerId, ledgerId), eq(importJobs.id, id))).for('update');
  if (!job) throw notFound();
  return job;
}
export async function getImportJob(ctx: AuthContext, ledgerId: string, id: string) {
  await ledgerAccess(database(), ctx, ledgerId, 'editor');
  const [job] = await database().select().from(importJobs).where(and(eq(importJobs.ledgerId, ledgerId), eq(importJobs.id, id)));
  if (!job) throw notFound();
  return present(database(), job);
}
export async function listImportJobs(ctx: AuthContext, ledgerId: string, page: Keyset) {
  await ledgerAccess(database(), ctx, ledgerId, 'editor');
  const after = page.after && or(lt(importJobs.createdAt, new Date(page.after[0])), and(eq(importJobs.createdAt, new Date(page.after[0])), lt(importJobs.id, page.after[1])));
  const rows = await database().select().from(importJobs).where(and(eq(importJobs.ledgerId, ledgerId), after)).orderBy(desc(importJobs.createdAt), desc(importJobs.id)).limit(page.limit + 1);
  return Promise.all(rows.map(async row => ({ ...(await present(database(), row)), position: [row.createdAt.toISOString(), row.id] as [string, string] })));
}
/** Queues booking of a validated batch. Repeating it while committing / committed returns the job unchanged. */
export async function requestImportCommit(ctx: AuthContext, ledgerId: string, id: string, db: Executor = database()) {
  return db.transaction(async tx => {
    await ledgerAccess(tx, ctx, ledgerId, 'editor', true);
    const job = await lockJob(tx, ledgerId, id);
    if (job.status === 'validated') {
      await tx.update(importJobs).set({ status: 'committing', requestedBy: ctx.userId, updatedAt: new Date() }).where(eq(importJobs.id, id));
      await audit(tx, ctx, ledgerId, 'import.commit_requested', id);
      await emit(tx, ledgerId, 'import.commit', { importJobId: id });
    } else if (job.status !== 'committing' && job.status !== 'committed') throw new DomainError(409, 'IMPORT_NOT_VALIDATED', job.status === 'validating' ? '仍在校验，请稍后提交' : '该批次不能提交');
    return present(tx, (await tx.select().from(importJobs).where(eq(importJobs.id, id)))[0]);
  });
}
/** Owner-only: queues voiding everything the batch booked. */
export async function requestImportReversal(ctx: AuthContext, ledgerId: string, id: string, db: Executor = database()) {
  return db.transaction(async tx => {
    await ledgerAccess(tx, ctx, ledgerId, 'owner', true);
    const job = await lockJob(tx, ledgerId, id);
    if (job.status === 'committed') {
      await tx.update(importJobs).set({ status: 'reverting', requestedBy: ctx.userId, updatedAt: new Date() }).where(eq(importJobs.id, id));
      await audit(tx, ctx, ledgerId, 'import.reversal_requested', id);
      await emit(tx, ledgerId, 'import.revert', { importJobId: id });
    } else if (job.status !== 'reverting' && job.status !== 'reverted') throw new DomainError(409, 'IMPORT_NOT_COMMITTED', '只有已提交的批次可以撤销');
    return present(tx, (await tx.select().from(importJobs).where(eq(importJobs.id, id)))[0]);
  });
}

// ---------- worker side ----------

type Draft = ImportedEntry & { fingerprint: string };
type Context = { ledgerId: string; baseCurrency: string; timezone: string; accounts: (typeof accounts.$inferSelect)[]; categories: (typeof categories.$inferSelect)[] };
const fail = (row: number, column: string | null, code: string, message: string): RowError => ({ row, column, code, message });

async function draftRow(tx: Tx, ctx: Context, mapping: Mapping, cells: Record<string, string>, rowNo: number, rates: Map<string, Awaited<ReturnType<typeof quote>>>): Promise<Draft | RowError> {
  const c = mapping.columns, cell = (name?: string) => (name ? unescapeFormula((cells[name] ?? '').trim()) : '');
  const date = normalizeDateCell(cell(c.date), (mapping.dateFormat ?? 'YYYY-MM-DD') as DateFormat);
  if (!date) return fail(rowNo, c.date, 'INVALID_DATE', `日期无效，应为 ${mapping.dateFormat ?? 'YYYY-MM-DD'}`);
  const named = ctx.accounts.filter(a => a.name === cell(c.account) && !a.archivedAt);
  if (!named.length) return fail(rowNo, c.account, 'ACCOUNT_NOT_FOUND', `找不到未归档账户“${cell(c.account).slice(0, 40)}”`);
  if (named.length > 1) return fail(rowNo, c.account, 'ACCOUNT_AMBIGUOUS', '存在多个同名账户，请先改名');
  const account = named[0];
  if (c.currency && cell(c.currency).toUpperCase() !== account.currency) return fail(rowNo, c.currency, 'CURRENCY_MISMATCH', `币种须与账户币种 ${account.currency} 一致`);
  let amount = normalizeAmountCell(cell(c.amount)), kind: 'expense' | 'income';
  if (c.kind) {
    const k = normalizeKindCell(cell(c.kind));
    if (k !== 'expense' && k !== 'income') return fail(rowNo, c.kind, 'UNSUPPORTED_KIND', '只支持导入收入 / 支出；转账与退款请在应用内登记');
    kind = k;
  } else if (mapping.defaultKind) kind = mapping.defaultKind;
  else { kind = amount.startsWith('-') ? 'expense' : 'income'; if (kind === 'expense') amount = negate(amount); }
  let settlement: string;
  try { settlement = parseAmount(amount, account.currency); } catch (error) { return fail(rowNo, c.amount, (error as DomainError).code ?? 'INVALID_AMOUNT', (error as Error).message); }
  let categoryId: string | null = null;
  if (c.category && cell(c.category)) {
    const matches = ctx.categories.filter(x => x.name === cell(c.category) && x.kind === kind && !x.archivedAt);
    if (matches.length !== 1) return fail(rowNo, c.category, matches.length ? 'CATEGORY_AMBIGUOUS' : 'CATEGORY_NOT_FOUND', matches.length ? '存在多个同名分类' : `找不到${kind === 'expense' ? '支出' : '收入'}分类“${cell(c.category).slice(0, 40)}”`);
    categoryId = matches[0].id;
  }
  const merchant = cell(c.merchant).slice(0, 120) || null, note = cell(c.note).slice(0, 500) || null;
  const timezone = mapping.timezone ?? ctx.timezone, occurredAt = zonedInstant(date, '12:00', timezone); // noon keeps the business date for any offset
  let base = { amount: settlement, currency: account.currency }, rate: Rate | null = null;
  if (account.currency !== ctx.baseCurrency) {
    const key = `${account.currency}:${date}`;
    if (!rates.has(key)) rates.set(key, await quote(tx, account.currency, ctx.baseCurrency, occurredAt));
    const q = rates.get(key)!;
    if (q.freshness !== 'fresh' || !q.value) return fail(rowNo, c.date, 'FX_RATE_MISSING', `${date} 的 ${account.currency}/${ctx.baseCurrency} 汇率暂缺，已排队补录；稍后重新上传`);
    rate = { batchId: q.batchId, base: account.currency, quote: ctx.baseCurrency, value: q.value, source: q.source ?? 'market', sourceAt: q.sourceAt?.toISOString() ?? null, freshness: 'fresh', manualReason: null };
    base = { amount: convert(settlement, account.currency, q.value, ctx.baseCurrency), currency: ctx.baseCurrency };
  }
  const entry: ImportedEntry = { kind, accountId: account.id, categoryId, merchant, note, occurredAt: occurredAt.toISOString(), localDate: date, timezone, settlement: { amount: settlement, currency: account.currency }, base, rate };
  return { ...entry, fingerprint: sha256(JSON.stringify([ctx.ledgerId, date, kind, account.id, settlement, categoryId, merchant, note])) };
}

/**
 * Validates every row of a queued upload in one transaction (all-or-nothing, so a crashed run simply restarts).
 * Repeated identical lines inside one file are numbered into their fingerprint; lines already booked by an earlier
 * batch become "duplicate" and are never booked twice.
 */
export async function validateImport(jobId: string) {
  return database().transaction(async tx => {
    const [job] = await tx.select().from(importJobs).where(eq(importJobs.id, jobId)).for('update', { skipLocked: true });
    if (!job || job.status !== 'validating') return 'skipped';
    const finish = async (changes: Partial<typeof importJobs.$inferInsert>) => { await tx.update(importJobs).set({ ...changes, content: null, updatedAt: new Date() }).where(eq(importJobs.id, jobId)); };
    let table: string[][];
    try { table = parseCsv(job.content ?? '', IMPORT_MAX_ROWS + 1); } catch (error) {
      await finish({ status: 'failed', failureReason: error instanceof CsvError ? `第 ${error.row} 行：${error.message}`.slice(0, 200) : 'CSV 格式无效' });
      return 'failed';
    }
    const [header, ...lines] = table;
    if (!lines.length) { await finish({ status: 'failed', failureReason: '文件没有数据行' }); return 'failed'; }
    const [ledger] = await tx.select().from(ledgers).where(eq(ledgers.id, job.ledgerId));
    const ctx: Context = { ledgerId: job.ledgerId, baseCurrency: ledger.baseCurrency, timezone: ledger.timezone,
      accounts: await tx.select().from(accounts).where(eq(accounts.ledgerId, job.ledgerId)), categories: await tx.select().from(categories).where(eq(categories.ledgerId, job.ledgerId)) };
    const mapping = job.mapping as Mapping, names = header.map(h => h.trim());
    const rates = new Map<string, Awaited<ReturnType<typeof quote>>>(), seen = new Map<string, number>();
    const rows: (typeof importRows.$inferInsert)[] = [];
    for (const [index, line] of lines.entries()) {
      const rowNo = index + 2; // header is row 1
      const cells = Object.fromEntries(names.map((name, i) => [name, line[i] ?? '']));
      const drafted = await draftRow(tx, ctx, mapping, cells, rowNo, rates);
      if ('code' in drafted) { rows.push({ id: randomUUID(), ledgerId: job.ledgerId, jobId, rowNo, fingerprint: sha256(`error:${jobId}:${rowNo}`), status: 'error', errorCode: drafted.code, errorColumn: drafted.column, errorMessage: drafted.message.slice(0, 200) }); continue; }
      const occurrence = (seen.get(drafted.fingerprint) ?? 0) + 1;
      seen.set(drafted.fingerprint, occurrence);
      const { fingerprint, ...data } = drafted;
      rows.push({ id: randomUUID(), ledgerId: job.ledgerId, jobId, rowNo, fingerprint: sha256(`${fingerprint}#${occurrence}`), status: 'valid', data });
    }
    const valid = rows.filter(r => r.status === 'valid');
    for (let i = 0; i < valid.length; i += 500) {
      const chunk = valid.slice(i, i + 500);
      const booked = await tx.select({ fingerprint: importRows.fingerprint, jobId: importRows.jobId }).from(importRows)
        .where(and(eq(importRows.ledgerId, job.ledgerId), eq(importRows.status, 'committed'), inArray(importRows.fingerprint, chunk.map(r => r.fingerprint))));
      const bookedBy = new Map(booked.map(b => [b.fingerprint, b.jobId]));
      for (const row of chunk) if (bookedBy.has(row.fingerprint)) Object.assign(row, { status: 'duplicate', errorCode: 'DUPLICATE_ROW', errorColumn: null, errorMessage: `该行已由批次 ${bookedBy.get(row.fingerprint)!.slice(0, 8)} 入账，已跳过` });
    }
    for (let i = 0; i < rows.length; i += 500) await tx.insert(importRows).values(rows.slice(i, i + 500));
    const validRows = rows.filter(r => r.status === 'valid').length;
    await finish({ status: validRows ? 'validated' : 'failed', rowCount: rows.length, validRows, errorRows: rows.length - validRows, failureReason: validRows ? null : '没有可导入的有效行' });
    return validRows ? 'validated' : 'failed';
  });
}

/** Books valid rows in batches of 100; each batch is one DB transaction and a crash resumes with the rows left. */
export async function commitImport(jobId: string) {
  for (;;) {
    const outcome = await database().transaction(async tx => {
      const [job] = await tx.select().from(importJobs).where(eq(importJobs.id, jobId)).for('update', { skipLocked: true });
      if (!job || job.status !== 'committing') return 'done';
      const ctx: AuthContext = { userId: job.requestedBy!, requestId: randomUUID() };
      try { await ledgerAccess(tx, ctx, job.ledgerId, 'editor', true); } catch {
        await tx.update(importJobs).set({ status: 'validated', failureReason: '提交者已无编辑权限', updatedAt: new Date() }).where(eq(importJobs.id, jobId));
        return 'done';
      }
      const rows = await tx.select().from(importRows).where(and(eq(importRows.jobId, jobId), eq(importRows.status, 'valid'))).orderBy(asc(importRows.rowNo)).limit(BATCH);
      for (const row of rows) {
        try {
          await tx.transaction(async savepoint => {
            const transactionId = await bookImportedEntry(savepoint, ctx, job.ledgerId, row.data as ImportedEntry);
            await savepoint.update(importRows).set({ status: 'committed', transactionId }).where(eq(importRows.id, row.id));
          });
        } catch (error) {
          // Another batch booked the same line meanwhile, or the account was archived after validation.
          const code = duplicate(error) ? 'DUPLICATE_ROW' : (error as DomainError).code ?? 'COMMIT_FAILED';
          if (!(error instanceof DomainError) && !duplicate(error)) throw error;
          await tx.update(importRows).set({ status: duplicate(error) ? 'duplicate' : 'skipped', errorCode: code, errorMessage: duplicate(error) ? '该行已由其他批次入账，已跳过' : (error as Error).message.slice(0, 200) }).where(eq(importRows.id, row.id));
        }
      }
      const [counts] = await tx.select({ committed: sql<number>`SUM(${importRows.status} = 'committed')`, left: sql<number>`SUM(${importRows.status} = 'valid')`, problems: sql<number>`SUM(${importRows.status} IN ('error','duplicate','skipped'))` })
        .from(importRows).where(eq(importRows.jobId, jobId));
      const finished = Number(counts.left) === 0;
      await tx.update(importJobs).set({ committedRows: Number(counts.committed), errorRows: Number(counts.problems), validRows: Number(counts.committed) + Number(counts.left), updatedAt: new Date(), ...(finished ? { status: 'committed', committedAt: new Date() } : {}) }).where(eq(importJobs.id, jobId));
      if (finished) await audit(tx, ctx, job.ledgerId, 'import.committed', jobId);
      return finished ? 'done' : 'more';
    });
    if (outcome === 'done') return;
  }
}

/** Voids the batch's transactions in batches; refunded expenses are kept and reported as skipped. */
export async function revertImport(jobId: string) {
  for (;;) {
    const outcome = await database().transaction(async tx => {
      const [job] = await tx.select().from(importJobs).where(eq(importJobs.id, jobId)).for('update', { skipLocked: true });
      if (!job || job.status !== 'reverting') return 'done';
      const ctx: AuthContext = { userId: job.requestedBy!, requestId: randomUUID() };
      try { await ledgerAccess(tx, ctx, job.ledgerId, 'owner', true); } catch {
        await tx.update(importJobs).set({ status: 'committed', failureReason: '撤销者已无所有者权限', updatedAt: new Date() }).where(eq(importJobs.id, jobId));
        return 'done';
      }
      const rows = await tx.select().from(importRows).where(and(eq(importRows.jobId, jobId), eq(importRows.status, 'committed'))).orderBy(asc(importRows.rowNo)).limit(BATCH);
      for (const row of rows) {
        const result = await voidImportedTransaction(tx, ctx, job.ledgerId, row.transactionId!);
        await tx.update(importRows).set(result === 'has_refunds'
          ? { status: 'skipped', errorCode: 'HAS_REFUNDS', errorMessage: '该笔已有退款，未撤销；请先处理退款' }
          : { status: 'reverted' }).where(eq(importRows.id, row.id));
      }
      if (rows.length === BATCH) return 'more';
      const [counts] = await tx.select({ reverted: sql<number>`SUM(${importRows.status} = 'reverted')` }).from(importRows).where(eq(importRows.jobId, jobId));
      await tx.update(importJobs).set({ status: 'reverted', revertedRows: Number(counts.reverted), revertedAt: new Date(), updatedAt: new Date() }).where(eq(importJobs.id, jobId));
      await audit(tx, ctx, job.ledgerId, 'import.reverted', jobId);
      return 'done';
    });
    if (outcome === 'done') return;
  }
}

/** Jobs whose worker died mid-way (no progress for 2 minutes) are queued again; every step is idempotent. */
export async function stalledImportJobs(now = new Date()) {
  return database().select({ id: importJobs.id, ledgerId: importJobs.ledgerId, status: importJobs.status }).from(importJobs)
    .where(and(inArray(importJobs.status, ['validating', 'committing', 'reverting']), lt(importJobs.updatedAt, new Date(now.getTime() - 120_000)))).limit(50);
}
export const importEventFor = (status: string) => ({ validating: 'import.validate', committing: 'import.commit', reverting: 'import.revert' })[status as 'validating'];
