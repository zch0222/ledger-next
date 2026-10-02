import { randomUUID } from 'node:crypto';
import { and, eq, inArray } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { database, databasePool } from '../../packages/db/src/index';
import { closeRedis } from '../../packages/db/src/redis';
import { exportJobs, importJobs, importRows, memberships, transactionAmounts, transactions } from '../../packages/db/src/schema';
import { createAccount } from '../../packages/domain/src/accounts';
import { createCategory } from '../../packages/domain/src/catalog';
import { parseCsv } from '../../packages/domain/src/csv';
import { createExportJob, downloadExport, expireExports, getExportJob, listExportJobs, runExport } from '../../packages/domain/src/exports';
import { ingestBatch } from '../../packages/domain/src/fx';
import { fxConfig } from '../../packages/domain/src/fx-provider';
import type { AuthContext } from '../../packages/domain/src/identity';
import { commitImport, createImportJob, getImportJob, importEventFor, listImportJobs, requestImportCommit, requestImportReversal, revertImport, stalledImportJobs, validateImport } from '../../packages/domain/src/imports';
import { sum } from '../../packages/domain/src/money';
import { verifyBalance } from '../../packages/domain/src/postings';
import { createPreview, createRefund } from '../../packages/domain/src/transactions';
import { seedLedger, seedUser } from './db';

let owner: AuthContext, editor: AuthContext, viewer: AuthContext, ledger: string, cash: string, usd: string, food: string;
const mapping = JSON.stringify({ columns: { date: '日期', amount: '金额', account: '账户', category: '分类', merchant: '商家', note: '备注' } });
const balance = async (account: string) => { const b = await verifyBalance(ledger, account); expect(b.consistent).toBe(true); return b.cached; };
// In the Docker stack the live worker consumes the same events; either it or the direct call finishes the job.
async function settle(id: string, run: (id: string) => Promise<unknown>, until: string[]) {
  await run(id);
  await expect.poll(async () => (await getImportJob(owner, ledger, id)).status, { timeout: 20000 }).toSatisfy(s => until.includes(s));
  return getImportJob(owner, ledger, id);
}
const upload = (content: string, ctx = editor, map = mapping) => createImportJob(ctx, ledger, { fileName: 'bank.csv', content, mapping: map });

const FILE = [
  '日期,金额,账户,分类,商家,备注',
  '2026-09-15,-28.50,现金,餐饮,茶餐厅,',
  '2026-09-15,-28.50,现金,餐饮,茶餐厅,',            // same line twice in one file: two real purchases
  '2026-09-16,"1,200.00",现金,工资,公司,"九月 ""奖金"""',
  '2026-09-16,-12.00,美元卡,餐饮,"=HYPERLINK(""x"")",\'=cmd',
  '2026-02-30,-1.00,现金,餐饮,,',                  // impossible date
  '2026-09-17,-1.00,不存在,餐饮,,',                // unknown account
  '2026-09-17,-1.005,现金,餐饮,,',                 // excess precision
  '2026-09-17,-3.00,现金,不存在的分类,,',
].join('\r\n');

beforeAll(async () => {
  const ownerId = await seedUser(), editorId = await seedUser(), viewerId = await seedUser();
  owner = { userId: ownerId, requestId: randomUUID() }; editor = { userId: editorId, requestId: randomUUID() }; viewer = { userId: viewerId, requestId: randomUUID() };
  ledger = await seedLedger(ownerId, 'CNY');
  await database().insert(memberships).values([{ id: randomUUID(), ledgerId: ledger, userId: editorId, role: 'editor', createdAt: new Date() }, { id: randomUUID(), ledgerId: ledger, userId: viewerId, role: 'viewer', createdAt: new Date() }]);
  cash = (await createAccount(owner, ledger, { name: '现金', type: 'cash', currency: 'CNY', openingBalance: '100' })).id;
  usd = (await createAccount(owner, ledger, { name: '美元卡', type: 'credit_card', currency: 'USD' })).id;
  food = (await createCategory(owner, ledger, { name: '餐饮', kind: 'expense' })).id;
  await createCategory(owner, ledger, { name: '工资', kind: 'income' });
  // A daily historical USD rate for the foreign row (own provider name; see fx.test.ts).
  process.env.FX_PROVIDER = `itest-import-${randomUUID().slice(0, 8)}`;
  await ingestBatch({ pivot: 'EUR', sourceAt: new Date('2026-09-16T23:59:59Z'), date: '2026-09-16', rates: { USD: '1.08', CNY: '7.8', HKD: '8.43', JPY: '161' } }, 'historical', fxConfig());
});
afterAll(async () => { await closeRedis(); await databasePool().end(); });

describe('CSV import batches', () => {
  it('validates with row-level errors, books valid rows once and dedupes a re-upload', async () => {
    const job = await upload(FILE);
    expect(job).toMatchObject({ status: 'validating', fileName: 'bank.csv', rowCount: 0 });
    const validated = await settle(job.id, validateImport, ['validated', 'failed']);
    expect(validated).toMatchObject({ status: 'validated', rowCount: 8, validRows: 4, errorRows: 4, duplicateRows: 0 });
    expect(validated.errors.map(e => [e.row, e.column, e.code])).toEqual([[6, '日期', 'INVALID_DATE'], [7, '账户', 'ACCOUNT_NOT_FOUND'], [8, '金额', 'AMOUNT_PRECISION'], [9, '分类', 'CATEGORY_NOT_FOUND']]);
    expect(await balance(cash)).toBe('100.00'); // validation books nothing

    await expect(requestImportCommit(viewer, ledger, job.id)).rejects.toMatchObject({ status: 403 });
    expect((await requestImportCommit(editor, ledger, job.id)).status).toBe('committing');
    expect((await requestImportCommit(editor, ledger, job.id)).status).toMatch(/committing|committed/); // repeat is harmless
    const committed = await settle(job.id, commitImport, ['committed']);
    expect(committed).toMatchObject({ committedRows: 4, validRows: 4 });
    expect(await balance(cash)).toBe('1243.00'); // 100 − 28.50 × 2 + 1200
    expect(await balance(usd)).toBe('-12.00');
    const booked = await database().select().from(transactions).where(and(eq(transactions.ledgerId, ledger), eq(transactions.source, 'import')));
    expect(booked).toHaveLength(4);
    expect(booked.find(t => t.merchant === '=HYPERLINK("x")')).toMatchObject({ note: '=cmd', localDate: '2026-09-16' }); // apostrophe escape reversed
    expect(booked.find(t => t.kind === 'income')).toMatchObject({ merchant: '公司', note: '九月 "奖金"' });

    const again = await settle((await upload(FILE)).id, validateImport, ['validated', 'failed']);
    expect(again).toMatchObject({ status: 'failed', validRows: 0, duplicateRows: 4, failureReason: '没有可导入的有效行' });
    expect(again.errors.filter(e => e.code === 'DUPLICATE_ROW').map(e => e.row)).toEqual([2, 3, 4, 5]);
    await expect(requestImportCommit(editor, ledger, again.id)).rejects.toMatchObject({ status: 409, code: 'IMPORT_NOT_VALIDATED' });

    // Reversal is owner-only, voids what the batch booked and frees its lines for a later import.
    await expect(requestImportReversal(editor, ledger, job.id)).rejects.toMatchObject({ status: 403 });
    expect((await requestImportReversal(owner, ledger, job.id)).status).toBe('reverting');
    const reverted = await settle(job.id, revertImport, ['reverted']);
    expect(reverted).toMatchObject({ revertedRows: 4 });
    expect(await balance(cash)).toBe('100.00');
    expect(await balance(usd)).toBe('0.00');
    await expect(requestImportReversal(owner, ledger, again.id)).rejects.toMatchObject({ code: 'IMPORT_NOT_COMMITTED' });
    const third = await settle((await upload(FILE)).id, validateImport, ['validated', 'failed']);
    expect(third).toMatchObject({ status: 'validated', validRows: 4, duplicateRows: 0 });
    expect((await listImportJobs(owner, ledger, { limit: 10 })).map(j => j.id)).toContain(third.id);
  });

  it('keeps a refunded expense when the batch is reversed and reports it', async () => {
    const job = await upload('日期,金额,账户,分类,商家,备注\n2026-09-20,-50.00,现金,餐饮,超市,refund-me\n2026-09-20,-5.00,现金,餐饮,便利店,');
    await settle(job.id, validateImport, ['validated']);
    await requestImportCommit(editor, ledger, job.id);
    await settle(job.id, commitImport, ['committed']);
    const [paid] = await database().select().from(transactions).where(and(eq(transactions.ledgerId, ledger), eq(transactions.note, 'refund-me')));
    await createRefund(owner, ledger, paid.id, { previewId: (await createPreview(owner, ledger, { kind: 'refund', originalTransactionId: paid.id, accountId: cash, settlement: { amount: '10.00', currency: 'CNY' }, occurredAt: new Date().toISOString(), timezone: 'UTC' })).previewId });
    await requestImportReversal(owner, ledger, job.id);
    const reverted = await settle(job.id, revertImport, ['reverted']);
    expect(reverted).toMatchObject({ revertedRows: 1 });
    expect(reverted.errors).toEqual([{ row: 2, column: null, code: 'HAS_REFUNDS', message: '该笔已有退款，未撤销；请先处理退款' }]);
    expect((await database().select().from(transactions).where(eq(transactions.id, paid.id)))[0].status).toBe('posted');
  });

  it('books a line once even when two batches with it commit at the same time', async () => {
    const content = '日期,金额,账户,分类,商家,备注\n2026-09-25,-7.70,现金,餐饮,咖啡,race';
    const [a, b] = [await upload(content), await upload(content)];
    await settle(a.id, validateImport, ['validated']); await settle(b.id, validateImport, ['validated']);
    await requestImportCommit(editor, ledger, a.id); await requestImportCommit(editor, ledger, b.id);
    await Promise.all([commitImport(a.id), commitImport(b.id)]);
    const [ja, jb] = [await settle(a.id, commitImport, ['committed']), await settle(b.id, commitImport, ['committed'])];
    expect(ja.committedRows + jb.committedRows).toBe(1);
    expect([...ja.errors, ...jb.errors].map(e => e.code)).toEqual(['DUPLICATE_ROW']);
    expect((await database().select().from(transactions).where(and(eq(transactions.ledgerId, ledger), eq(transactions.note, 'race'), eq(transactions.status, 'posted'))))).toHaveLength(1);
  });

  it('rejects broken uploads before queueing anything', async () => {
    const header = '日期,金额,账户,分类,商家,备注\n';
    await expect(upload(header, editor, '{"columns":{}}')).rejects.toMatchObject({ status: 422, code: 'INVALID_MAPPING' });
    await expect(upload(header, editor, 'not json')).rejects.toMatchObject({ code: 'INVALID_MAPPING' });
    await expect(upload('date,amount\n', editor)).rejects.toMatchObject({ code: 'MAPPING_COLUMN_MISSING', errors: expect.arrayContaining([{ path: 'mapping.columns.account', message: '找不到列 账户' }]) });
    await expect(upload(`${header}�`, editor)).rejects.toMatchObject({ code: 'INVALID_ENCODING' });
    await expect(upload('"unterminated', editor)).rejects.toMatchObject({ code: 'INVALID_CSV' });
    await expect(upload(header + 'x'.repeat(5 * 1024 * 1024), editor)).rejects.toMatchObject({ status: 413 });
    await expect(upload(header, viewer)).rejects.toMatchObject({ status: 403 });
    const kinds = JSON.stringify({ columns: { date: '日期', amount: '金额', account: '账户', kind: '类型' } });
    const job = await upload('日期,金额,账户,类型\n2026-09-01,5,现金,转账\n2026-09-01,5,现金,收入', editor, kinds);
    expect((await settle(job.id, validateImport, ['validated'])).errors).toEqual([{ row: 2, column: '类型', code: 'UNSUPPORTED_KIND', message: '只支持导入收入 / 支出；转账与退款请在应用内登记' }]);
    const empty = await upload(header, editor);
    expect(await settle(empty.id, validateImport, ['failed'])).toMatchObject({ failureReason: '文件没有数据行' });
    expect(importEventFor('committing')).toBe('import.commit');
    expect(await stalledImportJobs(new Date(Date.now() + 10 * 60_000))).toEqual(expect.any(Array));
    const [stored] = await database().select().from(importJobs).where(eq(importJobs.id, job.id));
    expect(stored.content).toBeNull(); // the raw file is dropped after validation
    expect((await database().select().from(importRows).where(eq(importRows.jobId, job.id))).map(r => r.status)).toEqual(['error', 'valid']);
  });
});

describe('CSV export', () => {
  it('exports the creator’s filtered ledger with formula escaping, totals that match and short-lived access', async () => {
    const seeded = await upload('日期,金额,账户,分类,商家,备注\n2026-09-10,-9.90,现金,餐饮,"=HYPERLINK(""x"")",@note\n2026-09-11,-3.30,美元卡,餐饮,,');
    await settle(seeded.id, validateImport, ['validated']);
    await requestImportCommit(editor, ledger, seeded.id);
    await settle(seeded.id, commitImport, ['committed']);
    const job = await createExportJob(viewer, ledger, { format: 'csv', dateFrom: '2026-09-01', dateTo: '2026-10-01' });
    expect(job).toMatchObject({ status: 'queued', downloadUrl: null });
    await expect(downloadExport(viewer, ledger, job.id)).rejects.toMatchObject({ status: 409, code: 'EXPORT_NOT_READY' });
    await runExport(job.id);
    await expect.poll(async () => (await getExportJob(viewer, ledger, job.id)).status, { timeout: 20000 }).toBe('ready');
    const ready = await getExportJob(viewer, ledger, job.id);
    expect(ready.downloadUrl).toBe(`/api/v1/ledgers/${ledger}/export-jobs/${job.id}/file`);
    const file = await downloadExport(viewer, ledger, job.id);
    expect(file.content.startsWith('﻿日期,类型,账户,金额,币种,基准金额,基准币种')).toBe(true);
    const [header, ...rows] = parseCsv(file.content);
    expect(rows).toHaveLength(ready.rowCount!);
    const col = (name: string) => header.indexOf(name);
    expect(rows.find(r => r[col('商家')] === `'=HYPERLINK("x")`)?.[col('备注')]).toBe("'@note");
    expect(rows.every(r => !r[col('金额')].startsWith('-'))).toBe(true);
    // Totals by kind equal the database for the same period and status.
    const posted = await database().select().from(transactions).where(and(eq(transactions.ledgerId, ledger), eq(transactions.status, 'posted')));
    const inPeriod = posted.filter(t => t.localDate >= '2026-09-01' && t.localDate < '2026-10-01');
    expect(rows.map(r => r[col('交易ID')]).sort()).toEqual(inPeriod.map(t => t.id).sort());
    const exportedExpense = sum(rows.filter(r => r[col('类型')] === '支出').map(r => r[col('基准金额')])).toFixed(2);
    const amounts = await database().select().from(transactionAmounts).where(inArray(transactionAmounts.transactionId, inPeriod.filter(t => t.kind === 'expense').map(t => t.id)));
    expect(exportedExpense).toBe(sum(amounts.map(a => a.baseAmount)).toFixed(2));
    expect(Number(exportedExpense)).toBeGreaterThan(0);
    // Only the creator sees and downloads it.
    await expect(downloadExport(owner, ledger, job.id)).rejects.toMatchObject({ status: 404 });
    expect(await listExportJobs(owner, ledger, { limit: 10 })).toEqual([]);
    expect((await listExportJobs(viewer, ledger, { limit: 10 })).map(j => j.id)).toEqual([job.id]);
    // After an hour the link is gone and housekeeping drops the file.
    await expect(downloadExport(viewer, ledger, job.id, new Date(Date.now() + 61 * 60_000))).rejects.toMatchObject({ status: 404, code: 'EXPORT_EXPIRED' });
    expect(await expireExports(new Date(Date.now() + 61 * 60_000))).toBeGreaterThanOrEqual(1);
    const [stored] = await database().select().from(exportJobs).where(eq(exportJobs.id, job.id));
    expect(stored).toMatchObject({ status: 'expired', content: null });
    await expect(createExportJob(viewer, ledger, { format: 'csv', dateFrom: '2026-10-01', dateTo: '2026-09-01' })).rejects.toMatchObject({ code: 'INVALID_RANGE' });
  });
  it('fails an export whose creator lost access', async () => {
    const outsider = await seedUser();
    await database().insert(memberships).values({ id: randomUUID(), ledgerId: ledger, userId: outsider, role: 'viewer', createdAt: new Date() });
    const ctx = { userId: outsider, requestId: randomUUID() };
    const job = await createExportJob(ctx, ledger, { format: 'csv' });
    await database().delete(memberships).where(and(eq(memberships.ledgerId, ledger), eq(memberships.userId, outsider)));
    await runExport(job.id);
    await expect.poll(async () => (await database().select().from(exportJobs).where(eq(exportJobs.id, job.id)))[0].status, { timeout: 20000 }).toBe('failed');
    void food;
  });
});
