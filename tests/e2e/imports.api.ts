import { randomUUID } from 'node:crypto';
import { expect } from '@playwright/test';
import { expectContract } from './contract';
import { ledger, test, user } from './helpers';

const mapping = JSON.stringify({ columns: { date: '日期', amount: '金额', account: '账户', category: '分类', merchant: '商家', note: '备注' } });
const csv = ['日期,金额,账户,分类,商家,备注', '2026-09-15,-28.50,现金,餐饮,茶餐厅,', '2026-09-16,-12.00,现金,餐饮,"=HYPERLINK(""evil"")",', '2026-09-17,-1.005,现金,餐饮,,', '2026-09-18,"1,000.00",现金,,公司,工资'].join('\r\n');
const file = (content = csv) => ({ name: '招行流水.csv', mimeType: 'text/csv', buffer: Buffer.from(content, 'utf8') });

test('CSV import is validated, committed and reversed asynchronously through the REST contract', async () => {
  test.setTimeout(90_000);
  const owner = await user('import'), book = await ledger(owner.client), base = `/api/v1/ledgers/${book.id}`;
  const cash = (await expectContract(await owner.client.post(`${base}/accounts`, { data: { name: '现金', type: 'cash', currency: 'CNY', openingBalance: '100' } }), 'createAccount', 201)).data;
  await expectContract(await owner.client.post(`${base}/categories`, { data: { name: '餐饮', kind: 'expense' } }), 'createCategory', 201);
  const key = randomUUID();
  const created = await owner.client.post(`${base}/import-jobs`, { multipart: { file: file(), mapping }, headers: { 'Idempotency-Key': key } });
  const job = (await expectContract(created, 'createImportJob', 202)).data;
  expect(created.headers().location).toBe(`${base}/import-jobs/${job.id}`);
  const replay = await owner.client.post(`${base}/import-jobs`, { multipart: { file: file(), mapping }, headers: { 'Idempotency-Key': key } });
  expect((await expectContract(replay, 'createImportJob', 202)).data.id).toBe(job.id);
  expect(replay.headers()['idempotent-replayed']).toBe('true');
  await expectContract(await owner.client.post(`${base}/import-jobs`, { multipart: { file: file(), mapping } }), 'createImportJob', 400);
  await expectContract(await owner.client.post(`${base}/import-jobs`, { data: { mapping }, headers: { 'Idempotency-Key': randomUUID() } }), 'createImportJob', 415);
  await expectContract(await owner.client.post(`${base}/import-jobs`, { multipart: { file: file('a,b\n1,2'), mapping }, headers: { 'Idempotency-Key': randomUUID() } }), 'createImportJob', 422);

  const status = async () => (await expectContract(await owner.client.get(`${base}/import-jobs/${job.id}`), 'getImportJob', 200)).data;
  await expect.poll(async () => (await status()).status, { timeout: 30_000 }).toBe('validated');
  expect(await status()).toMatchObject({ rowCount: 4, validRows: 3, errorRows: 1, errors: [{ row: 4, column: '金额', code: 'AMOUNT_PRECISION' }] });
  const commit = await owner.client.post(`${base}/import-jobs/${job.id}/commits`, { headers: { 'Idempotency-Key': randomUUID() } });
  expect((await expectContract(commit, 'createImportCommit', 202)).data.status).toMatch(/committing|committed/);
  await expect.poll(async () => (await status()).status, { timeout: 30_000 }).toBe('committed');
  expect((await expectContract(await owner.client.get(`${base}/accounts/${cash.id}`), 'getAccount', 200)).data.balance).toBe('1059.50');
  const listed = await expectContract(await owner.client.get(`${base}/transactions?status=posted`), 'listTransactions', 200);
  expect(listed.data.map((t: { source: string }) => t.source)).toEqual(['import', 'import', 'import']);
  await expectContract(await owner.client.get(`${base}/import-jobs`), 'listImportJobs', 200);

  // Uploading the same statement again books nothing twice.
  const again = (await expectContract(await owner.client.post(`${base}/import-jobs`, { multipart: { file: file(), mapping }, headers: { 'Idempotency-Key': randomUUID() } }), 'createImportJob', 202)).data;
  await expect.poll(async () => (await expectContract(await owner.client.get(`${base}/import-jobs/${again.id}`), 'getImportJob', 200)).data.status, { timeout: 30_000 }).toBe('failed');
  const duplicate = (await expectContract(await owner.client.get(`${base}/import-jobs/${again.id}`), 'getImportJob', 200)).data;
  expect(duplicate).toMatchObject({ validRows: 0, duplicateRows: 3 });
  expect((await expectContract(await owner.client.post(`${base}/import-jobs/${again.id}/commits`, { headers: { 'Idempotency-Key': randomUUID() } }), 'createImportCommit', 409)).code).toBe('IMPORT_NOT_VALIDATED');

  // Editors may import but only owners may reverse a batch.
  const editor = await user('import-editor');
  await owner.client.post(`${base}/memberships`, { data: { email: editor.email, role: 'editor' } });
  await expectContract(await editor.client.post(`${base}/import-jobs/${job.id}/reversals`, { headers: { 'Idempotency-Key': randomUUID() } }), 'createImportReversal', 403);
  await expectContract(await owner.client.post(`${base}/import-jobs/${job.id}/reversals`, { headers: { 'Idempotency-Key': randomUUID() } }), 'createImportReversal', 202);
  await expect.poll(async () => (await status()).status, { timeout: 30_000 }).toBe('reverted');
  expect((await expectContract(await owner.client.get(`${base}/accounts/${cash.id}`), 'getAccount', 200)).data.balance).toBe('100.00');
  const viewer = await user('import-viewer');
  await owner.client.post(`${base}/memberships`, { data: { email: viewer.email, role: 'viewer' } });
  await expectContract(await viewer.client.get(`${base}/import-jobs`), 'listImportJobs', 403);
  await owner.client.dispose(); await editor.client.dispose(); await viewer.client.dispose();
});

test('CSV export is generated by the worker and downloadable once by its creator only', async () => {
  test.setTimeout(60_000);
  const owner = await user('export'), book = await ledger(owner.client), base = `/api/v1/ledgers/${book.id}`;
  const cash = (await expectContract(await owner.client.post(`${base}/accounts`, { data: { name: '现金', type: 'cash', currency: 'CNY', openingBalance: '100' } }), 'createAccount', 201)).data;
  const preview = (await owner.client.post(`${base}/transaction-previews`, { data: { kind: 'expense', accountId: cash.id, settlement: { amount: '18.80', currency: 'CNY' }, merchant: '@SUM(1+1)', occurredAt: '2026-09-20T04:00:00.000Z', timezone: 'Asia/Hong_Kong' } })).json();
  await owner.client.post(`${base}/transactions`, { data: { previewId: (await preview).data.previewId }, headers: { 'Idempotency-Key': randomUUID() } });
  const created = await owner.client.post(`${base}/export-jobs`, { data: { format: 'csv', dateFrom: '2026-09-01', dateTo: '2026-10-01' } });
  const job = (await expectContract(created, 'createExportJob', 202)).data;
  const get = async () => (await expectContract(await owner.client.get(`${base}/export-jobs/${job.id}`), 'getExportJob', 200)).data;
  await expect.poll(async () => (await get()).status, { timeout: 30_000 }).toBe('ready');
  const ready = await get();
  expect(ready).toMatchObject({ rowCount: 1, downloadUrl: `${base}/export-jobs/${job.id}/file` });
  const download = await owner.client.get(ready.downloadUrl);
  const text = await expectContract(download, 'downloadExportFile', 200) as string;
  expect(download.headers()['content-disposition']).toMatch(/^attachment; filename\*=UTF-8''ledger-export-/);
  expect(download.headers()['cache-control']).toBe('private, no-store');
  expect(text.split('\r\n')[1]).toMatch(/^2026-09-20,支出,现金,18\.80,CNY,18\.80,CNY,,'@SUM\(1\+1\),/);
  const member = await user('export-member');
  await owner.client.post(`${base}/memberships`, { data: { email: member.email, role: 'viewer' } });
  await expectContract(await member.client.get(ready.downloadUrl), 'downloadExportFile', 404);
  await expectContract(await member.client.get(`${base}/export-jobs/${job.id}`), 'getExportJob', 404);
  expect((await expectContract(await member.client.get(`${base}/export-jobs`), 'listExportJobs', 200)).data).toEqual([]);
  await expectContract(await owner.client.post(`${base}/export-jobs`, { data: { format: 'xlsx' } }), 'createExportJob', 422);
  await owner.client.dispose(); await member.client.dispose();
});
