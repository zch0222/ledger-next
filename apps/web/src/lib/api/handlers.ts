import { z } from 'zod';
import { SCOPES } from '../../../../../packages/contracts/src/common';
import type { StableOperationId } from '../../../../../packages/contracts/src/operations';
import { database, type Executor } from '../../../../../packages/db/src/index';
import { cursorCodec, pageOf, type Position } from '../../../../../packages/domain/src/cursor';
import { DomainError } from '../../../../../packages/domain/src/policy';
import { addMember, changeMember, createLedger, getLedger, listAuditEvents, listLedgers, listMembers, updateLedger, type AuthContext, type Keyset } from '../../../../../packages/domain/src/identity';
import { archiveAccount, createAccount, getAccount, listAccounts, presentAccount, updateAccount } from '../../../../../packages/domain/src/accounts';
import { archiveCategory, archiveTag, createCategory, createTag, listCategories, listTags, presentCategory, presentTag, updateCategory, updateTag } from '../../../../../packages/domain/src/catalog';
import { correctTransaction, createPreview, createRefund, createTransaction, getTransaction, listTransactions, voidTransaction } from '../../../../../packages/domain/src/transactions';
import { createImportJob, getImportJob, listImportJobs, requestImportCommit, requestImportReversal } from '../../../../../packages/domain/src/imports';
import { createExportJob, downloadExport, getExportJob, listExportJobs } from '../../../../../packages/domain/src/exports';
import { accountBalances, archiveBudget, budgetProgress, cashFlow, categoryBreakdown, createBudget, listBudgets, presentBudget, reportSummary, updateBudget } from '../../../../../packages/domain/src/reports';
import { appearanceCookie, getPreferences, present as presentPreferences, updatePreferences } from '../../../../../packages/domain/src/preferences';
import { createBillPayment, createSubscription, createSubscriptionPreview, getBillOccurrence, getSubscription, listBillOccurrences, listSubscriptions, updateBillOccurrence, updateSubscription } from '../../../../../packages/domain/src/subscriptions';
import { createManualRateRecord, createRefreshJob, getExchangeRates, getRefreshJob, listManualRateRecords } from '../../../../../packages/domain/src/fx';
import { createChannel, createTestDelivery, deleteChannel, getTestDelivery, listChannels, presentChannel, updateChannel, verifyChannel } from '../../../../../packages/domain/src/notify-channels';
import { createReminderPreview, createReminderRule, deleteReminderRule, listReminderRules, presentRule, updateReminderRule } from '../../../../../packages/domain/src/reminders';
import { deliveryStats, getDelivery, getNotification, listDeliveries, listNotifications, presentNotification, retryDelivery, updateNotification } from '../../../../../packages/domain/src/deliveries';
import { presentDelivery } from '../../../../../packages/domain/src/notify-store';
import { createApproval, createToken, decideApproval, getApproval, getOperation, listApprovals, listTokens, presentToken, revokeToken, type Auth } from '../../../../../packages/domain/src/agents';

export type ApiContext = AuthContext & { user: { name: string; email: string }; auth: Auth };
export type ApiResult = { status: 200 | 201 | 202 | 204; data?: unknown; headers?: Record<string, string>; page?: { nextCursor: string | null; hasMore: boolean }; file?: { content: string; name: string; type: string } };
type Input = { ctx: ApiContext; params: Record<string, string>; query: Record<string, unknown>; body: unknown; request: Request; operationId: string };
type Handler = (input: Input, db?: Executor) => Promise<ApiResult>;

const etag = (version: number) => ({ ETag: `"v${version}"` });
const ifMatch = (request: Request) => request.headers.get('if-match');
const location = (ledgerId: string, collection: string, id: string) => ({ Location: `/api/v1/ledgers/${ledgerId}/${collection}/${id}` });
const createdPosition = z.tuple([z.iso.datetime(), z.uuid()]);
const keysetOf = <T extends { id: string; createdAt: Date }>(row: T): Position => [row.createdAt.toISOString(), row.id];
const omitCreatedAt = <T extends { createdAt: Date }>({ createdAt, ...rest }: T) => { void createdAt; return rest; };

// Cursors bind user, operation, ledger and every filter except paging itself.
async function pagedBy<T>(input: Input, options: { fetch: (keyset: Keyset) => Promise<T[]>; position: (row: T) => Position; schema: z.ZodType<[string, string]>; present: (rows: T[]) => unknown[] | Promise<unknown[]> }): Promise<ApiResult> {
  const { limit, cursor, ...filters } = input.query as { limit: number; cursor?: string };
  const codec = cursorCodec(process.env.BETTER_AUTH_SECRET!);
  const scope = JSON.stringify([input.ctx.userId, input.operationId, input.params.ledgerId ?? null, filters]);
  let after: Keyset['after'];
  if (cursor) {
    const decoded = options.schema.safeParse(codec.decode(scope, cursor));
    if (!decoded.success) throw new DomainError(400, 'INVALID_CURSOR', '分页游标无效或与当前筛选条件不符，请从第一页重新读取');
    after = decoded.data;
  }
  const { data, page } = pageOf(await options.fetch({ limit, after }), limit, options.position, p => codec.encode(scope, p));
  return { status: 200, data: await options.present(data), page };
}
const paged = <T extends { id: string; createdAt: Date }, R>(input: Input, fetch: (keyset: Keyset) => Promise<T[]>, present: (row: T) => R) =>
  pagedBy(input, { fetch, position: keysetOf, schema: createdPosition, present: rows => rows.map(present) });
const includeArchived = (input: Input) => ({ includeArchived: input.query.includeArchived as boolean });
/** A token sees only the ledgers it was issued for. */
const visibleTo = (ctx: ApiContext) => (ledger: { id: string }) => ctx.auth.type !== 'token' || ctx.auth.ledgerIds.includes(ledger.id);

// Typed as a complete record: a stable operation without a handler (or a handler for a planned one) fails to compile.
export const handlers: Record<StableOperationId, Handler> = {
  async getMe({ ctx }) {
    const ledgers = (await listLedgers(ctx)).filter(visibleTo(ctx)).map(omitCreatedAt);
    return { status: 200, data: { id: ctx.userId, ...ctx.user, defaultLedgerId: ledgers[0]?.id ?? null, ledgers, auth: ctx.auth.type === 'token' ? { type: 'token', scopes: ctx.auth.scopes } : { type: 'session', scopes: [...SCOPES] } } };
  },
  listLedgers: input => paged(input, async keyset => (await listLedgers(input.ctx, keyset)).filter(visibleTo(input.ctx)), omitCreatedAt),
  async createLedger({ ctx, body }, db) {
    const ledger = await createLedger(ctx, body, db);
    return { status: 201, data: ledger, headers: { Location: `/api/v1/ledgers/${ledger.id}`, ...etag(ledger.version) } };
  },
  async getLedger({ ctx, params }) {
    const ledger = await getLedger(ctx, params.ledgerId);
    return { status: 200, data: ledger, headers: etag(ledger.version) };
  },
  async updateLedger({ ctx, params, body, request }) {
    const ledger = await updateLedger(ctx, params.ledgerId, body, request.headers.get('if-match'));
    return { status: 200, data: ledger, headers: etag(ledger.version) };
  },
  listMemberships: input => paged(input, keyset => listMembers(input.ctx, input.params.ledgerId, keyset), omitCreatedAt),
  async createMembership({ ctx, params, body }, db) {
    const member = await addMember(ctx, params.ledgerId, body, db);
    return { status: 201, data: member, headers: etag(member.version) };
  },
  async updateMembership({ ctx, params, body, request }) {
    const member = (await changeMember(ctx, params.ledgerId, params.membershipId, body, request.headers.get('if-match')))!;
    return { status: 200, data: member, headers: etag(member.version) };
  },
  async deleteMembership({ ctx, params, request }) {
    await changeMember(ctx, params.ledgerId, params.membershipId, null, request.headers.get('if-match'));
    return { status: 204 };
  },
  listAccounts: input => paged(input, keyset => listAccounts(input.ctx, input.params.ledgerId, { ...includeArchived(input), ...keyset }), presentAccount),
  async createAccount({ ctx, params, body }, db) {
    const account = await createAccount(ctx, params.ledgerId, body, db);
    return { status: 201, data: account, headers: { ...location(params.ledgerId, 'accounts', account.id), ...etag(account.version) } };
  },
  async getAccount({ ctx, params }) { const account = await getAccount(ctx, params.ledgerId, params.accountId); return { status: 200, data: account, headers: etag(account.version) }; },
  async updateAccount({ ctx, params, body, request }) { const account = await updateAccount(ctx, params.ledgerId, params.accountId, body, ifMatch(request)); return { status: 200, data: account, headers: etag(account.version) }; },
  async archiveAccount({ ctx, params, request }) { const account = await archiveAccount(ctx, params.ledgerId, params.accountId, ifMatch(request)); return { status: 200, data: account, headers: etag(account.version) }; },
  listCategories: input => paged(input, keyset => listCategories(input.ctx, input.params.ledgerId, { ...includeArchived(input), ...keyset }), presentCategory),
  async createCategory({ ctx, params, body }, db) {
    const category = await createCategory(ctx, params.ledgerId, body, db);
    return { status: 201, data: category, headers: { ...location(params.ledgerId, 'categories', category.id), ...etag(category.version) } };
  },
  async updateCategory({ ctx, params, body, request }) { const category = await updateCategory(ctx, params.ledgerId, params.categoryId, body, ifMatch(request)); return { status: 200, data: category, headers: etag(category.version) }; },
  async archiveCategory({ ctx, params, request }) { const category = await archiveCategory(ctx, params.ledgerId, params.categoryId, ifMatch(request)); return { status: 200, data: category, headers: etag(category.version) }; },
  listTags: input => paged(input, keyset => listTags(input.ctx, input.params.ledgerId, { ...includeArchived(input), ...keyset }), presentTag),
  async createTag({ ctx, params, body }, db) {
    const tag = await createTag(ctx, params.ledgerId, body, db);
    return { status: 201, data: tag, headers: { ...location(params.ledgerId, 'tags', tag.id), ...etag(tag.version) } };
  },
  async updateTag({ ctx, params, body, request }) { const tag = await updateTag(ctx, params.ledgerId, params.tagId, body, ifMatch(request)); return { status: 200, data: tag, headers: etag(tag.version) }; },
  async archiveTag({ ctx, params, request }) { const tag = await archiveTag(ctx, params.ledgerId, params.tagId, ifMatch(request)); return { status: 200, data: tag, headers: etag(tag.version) }; },
  async listTransactions(input) {
    const { limit: _limit, cursor: _cursor, ...filters } = input.query as Parameters<typeof listTransactions>[2] & { cursor?: string };
    void _limit; void _cursor;
    let present: (ids: string[]) => Promise<unknown[]> = async () => [];
    return pagedBy(input, {
      fetch: async keyset => {
        const result = await listTransactions(input.ctx, input.params.ledgerId, { ...filters, ...keyset });
        present = result.present;
        return result.rows.map(row => ({ id: row.id, position: result.position(row) }));
      },
      position: row => row.position, schema: z.tuple([z.string().max(40), z.uuid()]), present: rows => present(rows.map(row => row.id)),
    });
  },
  async createTransactionPreview({ ctx, params, body }) { return { status: 201, data: await createPreview(ctx, params.ledgerId, body) }; },
  async createTransaction({ ctx, params, body }, db) {
    const transaction = await createTransaction(ctx, params.ledgerId, body, db);
    return { status: 201, data: transaction, headers: { ...location(params.ledgerId, 'transactions', transaction.id), ...etag(transaction.version) } };
  },
  async getTransaction({ ctx, params }) { const transaction = await getTransaction(ctx, params.ledgerId, params.transactionId); return { status: 200, data: transaction, headers: etag(transaction.version) }; },
  async updateTransaction({ ctx, params, body, request }, db) { const transaction = await correctTransaction(ctx, params.ledgerId, params.transactionId, body, ifMatch(request), db); return { status: 200, data: transaction, headers: etag(transaction.version) }; },
  async voidTransaction({ ctx, params, request }) { const transaction = await voidTransaction(ctx, params.ledgerId, params.transactionId, ifMatch(request)); return { status: 200, data: transaction, headers: etag(transaction.version) }; },
  async createRefund({ ctx, params, body }, db) {
    const refund = await createRefund(ctx, params.ledgerId, params.transactionId, body, db);
    return { status: 201, data: refund, headers: { ...location(params.ledgerId, 'transactions', refund.id), ...etag(refund.version) } };
  },
  async createImportJob({ ctx, params, body }, db) {
    const job = await createImportJob(ctx, params.ledgerId, body as { fileName: string; content: string; mapping: string }, db);
    return { status: 202, data: job, headers: location(params.ledgerId, 'import-jobs', job.id) };
  },
  listImportJobs: input => pagedBy(input, { fetch: keyset => listImportJobs(input.ctx, input.params.ledgerId, keyset), position: row => row.position, schema: createdPosition, present: rows => rows.map(({ position, ...rest }) => { void position; return rest; }) }),
  async getImportJob({ ctx, params }) { return { status: 200, data: await getImportJob(ctx, params.ledgerId, params.importJobId) }; },
  async createImportCommit({ ctx, params }, db) {
    const job = await requestImportCommit(ctx, params.ledgerId, params.importJobId, db);
    return { status: 202, data: job, headers: location(params.ledgerId, 'import-jobs', job.id) };
  },
  async createImportReversal({ ctx, params }, db) {
    const job = await requestImportReversal(ctx, params.ledgerId, params.importJobId, db);
    return { status: 202, data: job, headers: location(params.ledgerId, 'import-jobs', job.id) };
  },
  async createExportJob({ ctx, params, body }, db) {
    const job = await createExportJob(ctx, params.ledgerId, body, db);
    return { status: 202, data: job, headers: location(params.ledgerId, 'export-jobs', job.id) };
  },
  listExportJobs: input => pagedBy(input, { fetch: keyset => listExportJobs(input.ctx, input.params.ledgerId, keyset), position: row => row.position, schema: createdPosition, present: rows => rows.map(({ position, ...rest }) => { void position; return rest; }) }),
  async getExportJob({ ctx, params }) { return { status: 200, data: await getExportJob(ctx, params.ledgerId, params.exportJobId) }; },
  async downloadExportFile({ ctx, params }) {
    const file = await downloadExport(ctx, params.ledgerId, params.exportJobId);
    return { status: 200, file: { content: file.content, name: file.fileName, type: 'text/csv' } };
  },
  async getReportSummary({ ctx, params, query }) { return { status: 200, data: await reportSummary(ctx, params.ledgerId, query) }; },
  async getCashFlow({ ctx, params, query }) { return { status: 200, data: await cashFlow(ctx, params.ledgerId, query) }; },
  async getCategoryBreakdown({ ctx, params, query }) { return { status: 200, data: await categoryBreakdown(ctx, params.ledgerId, query) }; },
  async getAccountBalances({ ctx, params, query }) { return { status: 200, data: await accountBalances(ctx, params.ledgerId, query) }; },
  async getBudgetProgress({ ctx, params, query }) { return { status: 200, data: await budgetProgress(ctx, params.ledgerId, query) }; },
  listBudgets: input => paged(input, keyset => listBudgets(input.ctx, input.params.ledgerId, keyset), presentBudget),
  async createBudget({ ctx, params, body }, db) {
    const budget = await createBudget(ctx, params.ledgerId, body, db);
    return { status: 201, data: budget, headers: { ...location(params.ledgerId, 'budgets', budget.id), ...etag(budget.version) } };
  },
  async updateBudget({ ctx, params, body, request }) { const budget = await updateBudget(ctx, params.ledgerId, params.budgetId, body, ifMatch(request)); return { status: 200, data: budget, headers: etag(budget.version) }; },
  async archiveBudget({ ctx, params, request }) { const budget = await archiveBudget(ctx, params.ledgerId, params.budgetId, ifMatch(request)); return { status: 200, data: budget, headers: etag(budget.version) }; },
  async getExchangeRates({ query }) { return { status: 200, data: await getExchangeRates(query) }; },
  listManualRateRecords: input => pagedBy(input, {
    fetch: keyset => listManualRateRecords(input.ctx, input.params.ledgerId, keyset), position: row => [row.createdAtDate.toISOString(), row.id], schema: createdPosition,
    present: rows => rows.map(({ createdAtDate, ...rest }) => { void createdAtDate; return rest; }),
  }),
  async createManualRateRecord({ ctx, params, body }, db) {
    const record = await createManualRateRecord(ctx, params.ledgerId, body, db);
    return { status: 201, data: record, headers: location(params.ledgerId, 'manual-rate-records', record.id) };
  },
  async createExchangeRateRefreshJob({ ctx, body }) {
    const { job } = await createRefreshJob({ ...ctx, email: ctx.user.email }, body);
    return { status: 202, data: job, headers: { Location: `/api/v1/exchange-rate-refresh-jobs/${job.id}` } };
  },
  async getExchangeRateRefreshJob({ ctx, params }) { return { status: 200, data: await getRefreshJob({ ...ctx, email: ctx.user.email }, params.jobId) }; },
  listSubscriptions: input => pagedBy(input, { fetch: keyset => listSubscriptions(input.ctx, input.params.ledgerId, input.query, keyset), position: row => row.position, schema: createdPosition, present: rows => rows.map(({ position, ...rest }) => { void position; return rest; }) }),
  async createSubscriptionPreview({ ctx, params, body }) { return { status: 201, data: await createSubscriptionPreview(ctx, params.ledgerId, body) }; },
  async createSubscription({ ctx, params, body }, db) {
    const subscription = await createSubscription(ctx, params.ledgerId, body, db);
    return { status: 201, data: subscription, headers: { ...location(params.ledgerId, 'subscriptions', subscription.id), ...etag(subscription.version) } };
  },
  async getSubscription({ ctx, params }) { const subscription = await getSubscription(ctx, params.ledgerId, params.subscriptionId); return { status: 200, data: subscription, headers: etag(subscription.version) }; },
  async updateSubscription({ ctx, params, body, request }) { const subscription = await updateSubscription(ctx, params.ledgerId, params.subscriptionId, body, ifMatch(request)); return { status: 200, data: subscription, headers: etag(subscription.version) }; },
  listBillOccurrences: input => pagedBy(input, { fetch: keyset => listBillOccurrences(input.ctx, input.params.ledgerId, input.query, keyset), position: row => row.position, schema: z.tuple([z.iso.date(), z.uuid()]), present: rows => rows.map(({ position, ...rest }) => { void position; return rest; }) }),
  async getBillOccurrence({ ctx, params }) { const bill = await getBillOccurrence(ctx, params.ledgerId, params.occurrenceId); return { status: 200, data: bill, headers: etag(bill.version) }; },
  async updateBillOccurrence({ ctx, params, body, request }) { const bill = await updateBillOccurrence(ctx, params.ledgerId, params.occurrenceId, body, ifMatch(request)); return { status: 200, data: bill, headers: etag(bill.version) }; },
  async createBillPayment({ ctx, params, body }, db) { return { status: 201, data: await createBillPayment(ctx, params.ledgerId, params.occurrenceId, body, db) }; },
  async getPreferences({ ctx }) {
    const prefs = await getPreferences(ctx.userId);
    return { status: 200, data: presentPreferences(prefs.appearance, prefs.version), headers: etag(prefs.version) };
  },
  async updatePreferences({ ctx, body, request }) {
    const prefs = await updatePreferences(ctx.userId, body, ifMatch(request));
    const secure = new URL(process.env.APP_URL!).protocol === 'https:';
    return { status: 200, data: presentPreferences(prefs.appearance, prefs.version), headers: { ...etag(prefs.version), 'Set-Cookie': appearanceCookie(prefs.appearance, secure) } };
  },
  listAuditEvents: input => paged(input, keyset => listAuditEvents(input.ctx, input.params.ledgerId, { action: input.query.action as string | undefined, ...keyset }), event => ({ ...event, createdAt: event.createdAt.toISOString() })),
  // M5: reminders, channels, deliveries and the in-app inbox.
  listReminderRules: input => pagedBy(input, { fetch: keyset => listReminderRules(input.ctx, input.params.ledgerId, keyset), position: keysetOf, schema: createdPosition, present: rows => Promise.all(rows.map(rule => presentRule(database(), rule))) }),
  async createReminderPreview({ ctx, params, body }) { return { status: 201, data: await createReminderPreview(ctx, params.ledgerId, body) }; },
  async createReminderRule({ ctx, params, body }, db) {
    const rule = await createReminderRule(ctx, params.ledgerId, body, db);
    return { status: 201, data: rule, headers: { ...location(params.ledgerId, 'reminder-rules', rule.id), ...etag(rule.version) } };
  },
  async updateReminderRule({ ctx, params, body, request }) { const rule = await updateReminderRule(ctx, params.ledgerId, params.ruleId, body, ifMatch(request)); return { status: 200, data: rule, headers: etag(rule.version) }; },
  async deleteReminderRule({ ctx, params, request }) { await deleteReminderRule(ctx, params.ledgerId, params.ruleId, ifMatch(request)); return { status: 204 }; },
  listNotificationChannels: input => paged(input, keyset => listChannels(input.ctx, keyset), presentChannel),
  async createNotificationChannel({ ctx, body }, db) {
    const row = await createChannel(ctx, body, db);
    return { status: 201, data: presentChannel(row), headers: { Location: `/api/v1/notification-channels/${row.id}`, ...etag(row.version) } };
  },
  async updateNotificationChannel({ ctx, params, body, request }) { const row = await updateChannel(ctx, params.channelId, body, ifMatch(request)); return { status: 200, data: presentChannel(row), headers: etag(row.version) }; },
  async deleteNotificationChannel({ ctx, params, request }) { await deleteChannel(ctx, params.channelId, ifMatch(request)); return { status: 204 }; },
  async createTestDelivery({ ctx, params, body }, db) {
    const delivery = await createTestDelivery(ctx, params.channelId, body, db);
    return { status: 202, data: delivery, headers: { Location: `/api/v1/notification-channels/${params.channelId}/test-deliveries/${delivery.id}` } };
  },
  async getTestDelivery({ ctx, params }) { return { status: 200, data: await getTestDelivery(ctx, params.channelId, params.deliveryId) }; },
  async createChannelVerification({ ctx, params, body }) { const row = await verifyChannel(ctx, params.channelId, body); return { status: 200, data: presentChannel(row), headers: etag(row.version) }; },
  listNotificationDeliveries: input => paged(input, keyset => listDeliveries(input.ctx, input.params.ledgerId, input.query, keyset), presentDelivery),
  async getNotificationDelivery({ ctx, params }) { return { status: 200, data: await getDelivery(ctx, params.ledgerId, params.deliveryId) }; },
  async createDeliveryRetry({ ctx, params }) { return { status: 202, data: await retryDelivery(ctx, params.ledgerId, params.deliveryId) }; },
  async getNotificationStats({ ctx, params }) { return { status: 200, data: await deliveryStats(ctx, params.ledgerId) }; },
  listNotifications: input => paged(input, keyset => listNotifications(input.ctx, input.params.ledgerId, input.query, keyset), presentNotification),
  async getNotification({ ctx, params }) { const row = await getNotification(ctx, params.ledgerId, params.notificationId); return { status: 200, data: presentNotification(row), headers: etag(row.version) }; },
  async updateNotification({ ctx, params, body, request }) { const row = await updateNotification(ctx, params.ledgerId, params.notificationId, body, ifMatch(request)); return { status: 200, data: presentNotification(row), headers: etag(row.version) }; },
  // M6: personal access tokens, approvals, operations.
  listApiTokens: input => pagedBy(input, { fetch: keyset => listTokens(input.ctx, keyset), position: keysetOf, schema: createdPosition, present: rows => rows.map(presentToken) }),
  async createApiToken({ ctx, body }) { const token = await createToken(ctx, body); return { status: 201, data: token, headers: { Location: `/api/v1/api-tokens/${token.id}` } }; },
  async revokeApiToken({ ctx, params }) { await revokeToken(ctx, params.tokenId); return { status: 204 }; },
  listApprovalRequests: input => pagedBy(input, { fetch: keyset => listApprovals(input.ctx, input.params.ledgerId, input.query, keyset), position: row => [row.createdAtDate.toISOString(), row.id], schema: createdPosition, present: rows => rows.map(({ createdAtDate, ...rest }) => { void createdAtDate; return rest; }) }),
  async createApprovalRequest({ ctx, params, body }) {
    const approval = await createApproval(ctx, params.ledgerId, body);
    return { status: 201, data: approval, headers: { ...location(params.ledgerId, 'approval-requests', approval.id), ...etag(approval.version) } };
  },
  async getApprovalRequest({ ctx, params }) { const approval = await getApproval(ctx, params.ledgerId, params.approvalId); return { status: 200, data: approval, headers: etag(approval.version) }; },
  async updateApprovalRequest({ ctx, params, body, request }) { const approval = await decideApproval(ctx, params.ledgerId, params.approvalId, body, ifMatch(request)); return { status: 200, data: approval, headers: etag(approval.version) }; },
  async getOperation({ ctx, params }) { return { status: 200, data: await getOperation(ctx, params.ledgerId, params.operationId) }; },
};
