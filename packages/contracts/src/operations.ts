import { z } from 'zod';
import { pageQuery, type Scope } from './common';
import { AuditEvent, Ledger, Me, Membership, ledgerInput, ledgerPatch, memberInput, memberPatch } from './identity';
import * as F from './finance';
import * as P from './planning';
import * as X from './platform';

export type Method = 'get' | 'post' | 'patch' | 'delete';
export interface OperationDef {
  id: string; method: Method; path: string; tag: string; summary: string; description?: string;
  /** stable: implemented and protected by the breaking-change gate; planned: contract only, answers 501. */
  stability: 'stable' | 'planned'; milestone: string;
  /** Minimum ledger membership role for ledger-scoped resources. */
  role?: 'viewer' | 'editor' | 'owner';
  /** PAT scopes; null means Web session only, [] means any valid token. */
  scopes: readonly Scope[] | null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  query?: z.ZodObject<any, any>; body?: z.ZodType; bodyType?: 'application/json' | 'multipart/form-data';
  idempotency?: 'required' | 'optional';
  /** PATCH / DELETE require If-Match unless the resource has no version. */
  ifMatch?: boolean;
  status: 200 | 201 | 202 | 204; response?: z.ZodType; headers?: readonly ('ETag' | 'Location')[];
  /** Non-JSON success body (file downloads). */
  responseType?: 'text/csv';
  /** Documents business 409 conflicts in addition to idempotency conflicts. */
  conflict?: string;
}
const op = <const D extends OperationDef>(def: D) => def;
const L = '/ledgers/{ledgerId}';
const page = z.object(pageQuery).strict();
const S = 'stable' as const, PL = 'planned' as const;

export const operations = [
  // M1: identity, ledgers and memberships (implemented)
  op({ id: 'getMe', method: 'get', path: '/me', tag: 'Identity', summary: '当前身份、账本列表与有效作用域', stability: S, milestone: 'M1-API', scopes: [], status: 200, response: Me.single }),
  op({ id: 'listLedgers', method: 'get', path: '/ledgers', tag: 'Ledgers', summary: '我可访问的账本', stability: S, milestone: 'M1-API', scopes: ['ledgers:read'], query: page, status: 200, response: Ledger.list }),
  op({ id: 'createLedger', method: 'post', path: '/ledgers', tag: 'Ledgers', summary: '新建账本，创建者成为 owner', stability: S, milestone: 'M1-AUTH', scopes: null, body: ledgerInput, idempotency: 'optional', status: 201, response: Ledger.single, headers: ['Location', 'ETag'] }),
  op({ id: 'getLedger', method: 'get', path: L, tag: 'Ledgers', summary: '账本详情', stability: S, milestone: 'M1-AUTH', role: 'viewer', scopes: ['ledgers:read'], status: 200, response: Ledger.single, headers: ['ETag'] }),
  op({ id: 'updateLedger', method: 'patch', path: L, tag: 'Ledgers', summary: '修改账本名称', stability: S, milestone: 'M1-AUTH', role: 'owner', scopes: null, body: ledgerPatch, status: 200, response: Ledger.single, headers: ['ETag'] }),
  op({ id: 'listMemberships', method: 'get', path: `${L}/memberships`, tag: 'Memberships', summary: '账本成员', stability: S, milestone: 'M1-AUTH', role: 'owner', scopes: null, query: page, status: 200, response: Membership.list }),
  op({ id: 'createMembership', method: 'post', path: `${L}/memberships`, tag: 'Memberships', summary: '添加已注册成员', stability: S, milestone: 'M1-AUTH', role: 'owner', scopes: null, body: memberInput, idempotency: 'optional', status: 201, response: Membership.single, headers: ['ETag'], conflict: 'MEMBERSHIP_EXISTS' }),
  op({ id: 'updateMembership', method: 'patch', path: `${L}/memberships/{membershipId}`, tag: 'Memberships', summary: '修改成员角色，保护最后 owner', stability: S, milestone: 'M1-AUTH', role: 'owner', scopes: null, body: memberPatch, status: 200, response: Membership.single, headers: ['ETag'], conflict: 'LAST_OWNER' }),
  op({ id: 'deleteMembership', method: 'delete', path: `${L}/memberships/{membershipId}`, tag: 'Memberships', summary: '移除成员，保护最后 owner', stability: S, milestone: 'M1-AUTH', role: 'owner', scopes: null, status: 204, conflict: 'LAST_OWNER' }),
  op({ id: 'listAuditEvents', method: 'get', path: `${L}/audit-events`, tag: 'Audit', summary: '审计事件（新到旧）', stability: S, milestone: 'M1-API', role: 'owner', scopes: null, query: z.object({ action: z.string().max(80).optional(), ...pageQuery }).strict(), status: 200, response: AuditEvent.list }),

  // M4-THEME
  op({ id: 'getPreferences', method: 'get', path: '/me/preferences', tag: 'Preferences', summary: '外观偏好', stability: S, milestone: 'M4-THEME', scopes: null, status: 200, response: X.Preferences.single, headers: ['ETag'] }),
  op({ id: 'updatePreferences', method: 'patch', path: '/me/preferences', tag: 'Preferences', summary: '修改外观偏好', stability: S, milestone: 'M4-THEME', scopes: null, body: X.PreferencesUpdate, status: 200, response: X.Preferences.single, headers: ['ETag'] }),

  // M2: accounts, catalog, transactions, import / export
  op({ id: 'listAccounts', method: 'get', path: `${L}/accounts`, tag: 'Accounts', summary: '账户列表', stability: S, milestone: 'M2-LEDGER', role: 'viewer', scopes: ['accounts:read'], query: F.AccountQuery, status: 200, response: F.Account.list }),
  op({ id: 'createAccount', method: 'post', path: `${L}/accounts`, tag: 'Accounts', summary: '新建账户', stability: S, milestone: 'M2-LEDGER', role: 'editor', scopes: ['accounts:write'], body: F.AccountCreate, idempotency: 'optional', status: 201, response: F.Account.single, headers: ['Location', 'ETag'] }),
  op({ id: 'getAccount', method: 'get', path: `${L}/accounts/{accountId}`, tag: 'Accounts', summary: '账户详情与余额', stability: S, milestone: 'M2-LEDGER', role: 'viewer', scopes: ['accounts:read'], status: 200, response: F.Account.single, headers: ['ETag'] }),
  op({ id: 'updateAccount', method: 'patch', path: `${L}/accounts/{accountId}`, tag: 'Accounts', summary: '修改账户名称 / 备注', stability: S, milestone: 'M2-LEDGER', role: 'editor', scopes: ['accounts:write'], body: F.AccountUpdate, status: 200, response: F.Account.single, headers: ['ETag'] }),
  op({ id: 'archiveAccount', method: 'delete', path: `${L}/accounts/{accountId}`, tag: 'Accounts', summary: '归档账户（保留历史）', stability: S, milestone: 'M2-LEDGER', role: 'editor', scopes: ['accounts:write'], status: 200, response: F.Account.single, headers: ['ETag'] }),
  op({ id: 'listCategories', method: 'get', path: `${L}/categories`, tag: 'Catalog', summary: '分类', stability: S, milestone: 'M2-LEDGER', role: 'viewer', scopes: ['categories:read'], query: F.CatalogQuery, status: 200, response: F.Category.list }),
  op({ id: 'createCategory', method: 'post', path: `${L}/categories`, tag: 'Catalog', summary: '新建分类', stability: S, milestone: 'M2-LEDGER', role: 'editor', scopes: ['categories:write'], body: F.CategoryCreate, idempotency: 'optional', status: 201, response: F.Category.single, headers: ['Location', 'ETag'] }),
  op({ id: 'updateCategory', method: 'patch', path: `${L}/categories/{categoryId}`, tag: 'Catalog', summary: '修改分类', stability: S, milestone: 'M2-LEDGER', role: 'editor', scopes: ['categories:write'], body: F.CategoryUpdate, status: 200, response: F.Category.single, headers: ['ETag'] }),
  op({ id: 'archiveCategory', method: 'delete', path: `${L}/categories/{categoryId}`, tag: 'Catalog', summary: '归档分类（已引用的只归档）', stability: S, milestone: 'M2-LEDGER', role: 'editor', scopes: ['categories:write'], status: 200, response: F.Category.single, headers: ['ETag'] }),
  op({ id: 'listTags', method: 'get', path: `${L}/tags`, tag: 'Catalog', summary: '标签', stability: S, milestone: 'M2-LEDGER', role: 'viewer', scopes: ['categories:read'], query: F.CatalogQuery, status: 200, response: F.Tag.list }),
  op({ id: 'createTag', method: 'post', path: `${L}/tags`, tag: 'Catalog', summary: '新建标签', stability: S, milestone: 'M2-LEDGER', role: 'editor', scopes: ['categories:write'], body: F.TagCreate, idempotency: 'optional', status: 201, response: F.Tag.single, headers: ['Location', 'ETag'], conflict: 'TAG_EXISTS' }),
  op({ id: 'updateTag', method: 'patch', path: `${L}/tags/{tagId}`, tag: 'Catalog', summary: '修改标签', stability: S, milestone: 'M2-LEDGER', role: 'editor', scopes: ['categories:write'], body: F.TagUpdate, status: 200, response: F.Tag.single, headers: ['ETag'], conflict: 'TAG_EXISTS' }),
  op({ id: 'archiveTag', method: 'delete', path: `${L}/tags/{tagId}`, tag: 'Catalog', summary: '归档标签', stability: S, milestone: 'M2-LEDGER', role: 'editor', scopes: ['categories:write'], status: 200, response: F.Tag.single, headers: ['ETag'] }),
  op({ id: 'listTransactions', method: 'get', path: `${L}/transactions`, tag: 'Transactions', summary: '明细、筛选与分页', stability: S, milestone: 'M2-LEDGER', role: 'viewer', scopes: ['transactions:read'], query: F.TransactionQuery, status: 200, response: F.Transaction.list }),
  op({ id: 'createTransactionPreview', method: 'post', path: `${L}/transaction-previews`, tag: 'Transactions', summary: '预览：规范化金额、余额影响、锁定汇率', stability: S, milestone: 'M2-LEDGER', role: 'editor', scopes: ['transactions:write'], body: F.TransactionPreviewCreate, status: 201, response: F.TransactionPreview.single, conflict: 'REFUND_EXCEEDS_PAID' }),
  op({ id: 'createTransaction', method: 'post', path: `${L}/transactions`, tag: 'Transactions', summary: '提交预览，新建收支或转账', stability: S, milestone: 'M2-LEDGER', role: 'editor', scopes: ['transactions:write'], body: F.PreviewSubmit, idempotency: 'required', status: 201, response: F.Transaction.single, headers: ['Location', 'ETag'], conflict: 'PREVIEW_CONSUMED / PREVIEW_STALE' }),
  op({ id: 'getTransaction', method: 'get', path: `${L}/transactions/{transactionId}`, tag: 'Transactions', summary: '交易详情', stability: S, milestone: 'M2-LEDGER', role: 'viewer', scopes: ['transactions:read'], status: 200, response: F.Transaction.single, headers: ['ETag'] }),
  op({ id: 'updateTransaction', method: 'patch', path: `${L}/transactions/{transactionId}`, tag: 'Transactions', summary: '更正：同事务冲正并生成新版本', stability: S, milestone: 'M2-LEDGER', role: 'editor', scopes: ['transactions:write'], body: F.PreviewSubmit, idempotency: 'optional', status: 200, response: F.Transaction.single, headers: ['ETag'], conflict: 'PREVIEW_CONSUMED / PREVIEW_STALE / HAS_REFUNDS / TRANSACTION_VOIDED' }),
  op({ id: 'voidTransaction', method: 'delete', path: `${L}/transactions/{transactionId}`, tag: 'Transactions', summary: '作废：创建反向 posting，重复作废无影响', stability: S, milestone: 'M2-LEDGER', role: 'editor', scopes: ['transactions:write'], status: 200, response: F.Transaction.single, headers: ['ETag'], conflict: 'HAS_REFUNDS' }),
  op({ id: 'createRefund', method: 'post', path: `${L}/transactions/{transactionId}/refunds`, tag: 'Transactions', summary: '关联退款，累计不超过原支付', stability: S, milestone: 'M2-LEDGER', role: 'editor', scopes: ['transactions:write'], body: F.PreviewSubmit, idempotency: 'required', status: 201, response: F.Transaction.single, headers: ['Location', 'ETag'], conflict: 'REFUND_EXCEEDS_PAID / PREVIEW_CONSUMED / PREVIEW_STALE' }),
  op({ id: 'createImportJob', method: 'post', path: `${L}/import-jobs`, tag: 'Imports', summary: '上传 CSV，异步校验并生成预览', stability: S, milestone: 'M2-IMPORT', role: 'editor', scopes: null, body: X.ImportJobCreate, bodyType: 'multipart/form-data', idempotency: 'required', status: 202, response: X.ImportJob.single, headers: ['Location'] }),
  op({ id: 'listImportJobs', method: 'get', path: `${L}/import-jobs`, tag: 'Imports', summary: '导入任务（新到旧）', stability: S, milestone: 'M2-IMPORT', role: 'editor', scopes: null, query: page, status: 200, response: X.ImportJob.list }),
  op({ id: 'getImportJob', method: 'get', path: `${L}/import-jobs/{importJobId}`, tag: 'Imports', summary: '导入任务状态与行级错误', stability: S, milestone: 'M2-IMPORT', role: 'editor', scopes: null, status: 200, response: X.ImportJob.single }),
  op({ id: 'createImportCommit', method: 'post', path: `${L}/import-jobs/{importJobId}/commits`, tag: 'Imports', summary: '提交已校验批次（异步入账）', stability: S, milestone: 'M2-IMPORT', role: 'editor', scopes: null, idempotency: 'required', status: 202, response: X.ImportJob.single, headers: ['Location'], conflict: 'IMPORT_NOT_VALIDATED' }),
  op({ id: 'createImportReversal', method: 'post', path: `${L}/import-jobs/{importJobId}/reversals`, tag: 'Imports', summary: '撤销该批次生成的账务（异步作废）', stability: S, milestone: 'M2-IMPORT', role: 'owner', scopes: null, idempotency: 'required', status: 202, response: X.ImportJob.single, headers: ['Location'], conflict: 'IMPORT_NOT_COMMITTED' }),
  op({ id: 'createExportJob', method: 'post', path: `${L}/export-jobs`, tag: 'Exports', summary: '创建导出任务', stability: S, milestone: 'M2-IMPORT', role: 'viewer', scopes: ['exports:read'], body: X.ExportJobCreate, idempotency: 'optional', status: 202, response: X.ExportJob.single, headers: ['Location'] }),
  op({ id: 'listExportJobs', method: 'get', path: `${L}/export-jobs`, tag: 'Exports', summary: '我创建的导出任务', stability: S, milestone: 'M2-IMPORT', role: 'viewer', scopes: ['exports:read'], query: page, status: 200, response: X.ExportJob.list }),
  op({ id: 'getExportJob', method: 'get', path: `${L}/export-jobs/{exportJobId}`, tag: 'Exports', summary: '导出状态与短期下载地址', stability: S, milestone: 'M2-IMPORT', role: 'viewer', scopes: ['exports:read'], status: 200, response: X.ExportJob.single }),
  op({ id: 'downloadExportFile', method: 'get', path: `${L}/export-jobs/{exportJobId}/file`, tag: 'Exports', summary: '下载导出文件（仅创建者，1 小时内）', stability: S, milestone: 'M2-IMPORT', role: 'viewer', scopes: ['exports:read'], status: 200, responseType: 'text/csv', conflict: 'EXPORT_NOT_READY' }),

  // M3: FX, reports and budgets
  op({ id: 'getExchangeRates', method: 'get', path: '/exchange-rates', tag: 'ExchangeRates', summary: '参考汇率与新鲜度', stability: S, milestone: 'M3-FX', scopes: ['fx:read'], query: P.ExchangeRateQuery, status: 200, response: P.ExchangeRates.single }),
  op({ id: 'listManualRateRecords', method: 'get', path: `${L}/manual-rate-records`, tag: 'ExchangeRates', summary: '账本的人工汇率记录（新到旧）', stability: S, milestone: 'M3-FX', role: 'viewer', scopes: ['fx:read'], query: page, status: 200, response: P.ManualRateRecord.list }),
  op({ id: 'createManualRateRecord', method: 'post', path: `${L}/manual-rate-records`, tag: 'ExchangeRates', summary: '有理由的人工汇率', stability: S, milestone: 'M3-FX', role: 'editor', scopes: ['fx:write'], body: P.ManualRateRecordCreate, idempotency: 'optional', status: 201, response: P.ManualRateRecord.single, headers: ['Location'] }),
  op({ id: 'createExchangeRateRefreshJob', method: 'post', path: '/exchange-rate-refresh-jobs', tag: 'ExchangeRates', summary: '去重刷新任务（系统管理员）', stability: S, milestone: 'M3-FX', scopes: null, body: P.RefreshJobCreate, status: 202, response: P.RefreshJob.single, headers: ['Location'] }),
  op({ id: 'getExchangeRateRefreshJob', method: 'get', path: '/exchange-rate-refresh-jobs/{jobId}', tag: 'ExchangeRates', summary: '刷新任务状态（系统管理员）', stability: S, milestone: 'M3-FX', scopes: null, status: 200, response: P.RefreshJob.single }),
  op({ id: 'getReportSummary', method: 'get', path: `${L}/reports/summary`, tag: 'Reports', summary: 'KPI 汇总', stability: S, milestone: 'M3-REPORTS', role: 'viewer', scopes: ['reports:read'], query: P.ReportQuery, status: 200, response: P.ReportSummary.single }),
  op({ id: 'getCashFlow', method: 'get', path: `${L}/reports/cash-flow`, tag: 'Reports', summary: '收支趋势', stability: S, milestone: 'M3-REPORTS', role: 'viewer', scopes: ['reports:read'], query: P.CashFlowQuery, status: 200, response: P.CashFlow.single }),
  op({ id: 'getCategoryBreakdown', method: 'get', path: `${L}/reports/category-breakdown`, tag: 'Reports', summary: '分类排行', stability: S, milestone: 'M3-REPORTS', role: 'viewer', scopes: ['reports:read'], query: P.CategoryBreakdownQuery, status: 200, response: P.CategoryBreakdown.single }),
  op({ id: 'getAccountBalances', method: 'get', path: `${L}/reports/account-balances`, tag: 'Reports', summary: '账户余额与净资产估值', stability: S, milestone: 'M3-REPORTS', role: 'viewer', scopes: ['reports:read'], query: P.AccountBalancesQuery, status: 200, response: P.AccountBalances.single }),
  op({ id: 'getBudgetProgress', method: 'get', path: `${L}/reports/budget-progress`, tag: 'Reports', summary: '预算进度与阈值', stability: S, milestone: 'M3-REPORTS', role: 'viewer', scopes: ['budgets:read'], query: P.BudgetProgressQuery, status: 200, response: P.BudgetProgress.single }),
  op({ id: 'listBudgets', method: 'get', path: `${L}/budgets`, tag: 'Budgets', summary: '预算', stability: S, milestone: 'M3-REPORTS', role: 'viewer', scopes: ['budgets:read'], query: page, status: 200, response: P.Budget.list }),
  op({ id: 'createBudget', method: 'post', path: `${L}/budgets`, tag: 'Budgets', summary: '新建预算', stability: S, milestone: 'M3-REPORTS', role: 'editor', scopes: ['budgets:write'], body: P.BudgetCreate, idempotency: 'optional', status: 201, response: P.Budget.single, headers: ['Location', 'ETag'] }),
  op({ id: 'updateBudget', method: 'patch', path: `${L}/budgets/{budgetId}`, tag: 'Budgets', summary: '修改预算', stability: S, milestone: 'M3-REPORTS', role: 'editor', scopes: ['budgets:write'], body: P.BudgetUpdate, status: 200, response: P.Budget.single, headers: ['ETag'] }),
  op({ id: 'archiveBudget', method: 'delete', path: `${L}/budgets/{budgetId}`, tag: 'Budgets', summary: '归档预算', stability: S, milestone: 'M3-REPORTS', role: 'editor', scopes: ['budgets:write'], status: 200, response: P.Budget.single, headers: ['ETag'] }),

  // M4-SUBS: subscriptions and bills
  op({ id: 'listSubscriptions', method: 'get', path: `${L}/subscriptions`, tag: 'Subscriptions', summary: '周期订阅', stability: S, milestone: 'M4-SUBS', role: 'viewer', scopes: ['subscriptions:read'], query: P.SubscriptionQuery, status: 200, response: P.Subscription.list }),
  op({ id: 'createSubscriptionPreview', method: 'post', path: `${L}/subscription-previews`, tag: 'Subscriptions', summary: '校验周期并展示未来三次', stability: S, milestone: 'M4-SUBS', role: 'editor', scopes: ['subscriptions:write'], body: P.SubscriptionPreviewCreate, status: 201, response: P.SubscriptionPreview.single }),
  op({ id: 'createSubscription', method: 'post', path: `${L}/subscriptions`, tag: 'Subscriptions', summary: '提交预览创建订阅', stability: S, milestone: 'M4-SUBS', role: 'editor', scopes: ['subscriptions:write'], body: F.PreviewSubmit, idempotency: 'required', status: 201, response: P.Subscription.single, headers: ['Location', 'ETag'], conflict: 'PREVIEW_STALE / PREVIEW_CONSUMED' }),
  op({ id: 'getSubscription', method: 'get', path: `${L}/subscriptions/{subscriptionId}`, tag: 'Subscriptions', summary: '订阅详情', stability: S, milestone: 'M4-SUBS', role: 'viewer', scopes: ['subscriptions:read'], status: 200, response: P.Subscription.single, headers: ['ETag'] }),
  op({ id: 'updateSubscription', method: 'patch', path: `${L}/subscriptions/{subscriptionId}`, tag: 'Subscriptions', summary: '修改、暂停、取消（状态字段）', stability: S, milestone: 'M4-SUBS', role: 'editor', scopes: ['subscriptions:write'], body: P.SubscriptionUpdate, status: 200, response: P.Subscription.single, headers: ['ETag'], conflict: 'SUBSCRIPTION_CANCELLED' }),
  op({ id: 'listBillOccurrences', method: 'get', path: `${L}/bill-occurrences`, tag: 'Subscriptions', summary: '账单列表 / 日历', stability: S, milestone: 'M4-SUBS', role: 'viewer', scopes: ['subscriptions:read'], query: P.BillOccurrenceQuery, status: 200, response: P.BillOccurrence.list }),
  op({ id: 'getBillOccurrence', method: 'get', path: `${L}/bill-occurrences/{occurrenceId}`, tag: 'Subscriptions', summary: '账单详情', stability: S, milestone: 'M4-SUBS', role: 'viewer', scopes: ['subscriptions:read'], status: 200, response: P.BillOccurrence.single, headers: ['ETag'] }),
  op({ id: 'updateBillOccurrence', method: 'patch', path: `${L}/bill-occurrences/{occurrenceId}`, tag: 'Subscriptions', summary: '跳过 / 恢复账单', stability: S, milestone: 'M4-SUBS', role: 'editor', scopes: ['subscriptions:write'], body: P.BillOccurrenceUpdate, status: 200, response: P.BillOccurrence.single, headers: ['ETag'], conflict: 'ALREADY_PAID / BILL_CANCELLED / BILL_NOT_SKIPPED' }),
  op({ id: 'createBillPayment', method: 'post', path: `${L}/bill-occurrences/{occurrenceId}/payments`, tag: 'Subscriptions', summary: '记录实际支付，唯一关联交易（不是银行扣款）', stability: S, milestone: 'M4-SUBS', role: 'editor', scopes: ['transactions:write'], body: P.BillPaymentCreate, idempotency: 'required', status: 201, response: P.BillPayment.single, conflict: 'ALREADY_PAID / BILL_NOT_PAYABLE / ALREADY_LINKED / PREVIEW_CONSUMED / PREVIEW_STALE' }),

  // M5: reminders, channels, deliveries, in-app notifications
  op({ id: 'listReminderRules', method: 'get', path: `${L}/reminder-rules`, tag: 'Reminders', summary: '提醒规则', stability: PL, milestone: 'M5-ENGINE', role: 'viewer', scopes: ['reminders:read'], query: page, status: 200, response: X.ReminderRule.list }),
  op({ id: 'createReminderPreview', method: 'post', path: `${L}/reminder-previews`, tag: 'Reminders', summary: '未来三次提醒时间与免打扰影响', stability: PL, milestone: 'M5-ENGINE', role: 'editor', scopes: ['reminders:write'], body: X.ReminderPreviewCreate, status: 201, response: X.ReminderPreview.single }),
  op({ id: 'createReminderRule', method: 'post', path: `${L}/reminder-rules`, tag: 'Reminders', summary: '提交预览创建规则', stability: PL, milestone: 'M5-ENGINE', role: 'editor', scopes: ['reminders:write'], body: F.PreviewSubmit, idempotency: 'required', status: 201, response: X.ReminderRule.single, headers: ['Location', 'ETag'], conflict: 'PREVIEW_STALE' }),
  op({ id: 'updateReminderRule', method: 'patch', path: `${L}/reminder-rules/{ruleId}`, tag: 'Reminders', summary: '修改规则', stability: PL, milestone: 'M5-ENGINE', role: 'editor', scopes: ['reminders:write'], body: X.ReminderRuleUpdate, status: 200, response: X.ReminderRule.single, headers: ['ETag'] }),
  op({ id: 'deleteReminderRule', method: 'delete', path: `${L}/reminder-rules/{ruleId}`, tag: 'Reminders', summary: '停用规则并取消未发送任务', stability: PL, milestone: 'M5-ENGINE', role: 'editor', scopes: ['reminders:write'], status: 204 }),
  op({ id: 'listNotificationChannels', method: 'get', path: '/notification-channels', tag: 'Channels', summary: '我的通知渠道', stability: PL, milestone: 'M5-ENGINE', scopes: null, query: page, status: 200, response: X.NotificationChannel.list }),
  op({ id: 'createNotificationChannel', method: 'post', path: '/notification-channels', tag: 'Channels', summary: '配置渠道（凭据加密保存）', stability: PL, milestone: 'M5-ENGINE', scopes: null, body: X.NotificationChannelCreate, idempotency: 'optional', status: 201, response: X.NotificationChannel.single, headers: ['Location', 'ETag'] }),
  op({ id: 'updateNotificationChannel', method: 'patch', path: '/notification-channels/{channelId}', tag: 'Channels', summary: '修改 / 停用渠道', stability: PL, milestone: 'M5-ENGINE', scopes: null, body: X.NotificationChannelUpdate, status: 200, response: X.NotificationChannel.single, headers: ['ETag'] }),
  op({ id: 'deleteNotificationChannel', method: 'delete', path: '/notification-channels/{channelId}', tag: 'Channels', summary: '删除渠道配置', stability: PL, milestone: 'M5-ENGINE', scopes: null, status: 204 }),
  op({ id: 'createTestDelivery', method: 'post', path: '/notification-channels/{channelId}/test-deliveries', tag: 'Channels', summary: '创建测试投递', stability: PL, milestone: 'M5-ENGINE', scopes: null, body: X.TestDeliveryCreate, idempotency: 'required', status: 202, response: X.NotificationDelivery.single, headers: ['Location'] }),
  op({ id: 'listNotificationDeliveries', method: 'get', path: `${L}/notification-deliveries`, tag: 'Notifications', summary: '投递记录与平台状态', stability: PL, milestone: 'M5-ENGINE', role: 'viewer', scopes: ['reminders:read'], query: X.DeliveryQuery, status: 200, response: X.NotificationDelivery.list }),
  op({ id: 'getNotificationDelivery', method: 'get', path: `${L}/notification-deliveries/{deliveryId}`, tag: 'Notifications', summary: '投递详情', stability: PL, milestone: 'M5-ENGINE', role: 'viewer', scopes: ['reminders:read'], status: 200, response: X.NotificationDelivery.single }),
  op({ id: 'listNotifications', method: 'get', path: `${L}/notifications`, tag: 'Notifications', summary: '站内通知', stability: PL, milestone: 'M5-OTHER', role: 'viewer', scopes: ['notifications:read'], query: X.NotificationQuery, status: 200, response: X.Notification.list }),
  op({ id: 'getNotification', method: 'get', path: `${L}/notifications/{notificationId}`, tag: 'Notifications', summary: '站内通知详情', stability: PL, milestone: 'M5-OTHER', role: 'viewer', scopes: ['notifications:read'], status: 200, response: X.Notification.single, headers: ['ETag'] }),
  op({ id: 'updateNotification', method: 'patch', path: `${L}/notifications/{notificationId}`, tag: 'Notifications', summary: '标记已读 / 未读', stability: PL, milestone: 'M5-OTHER', role: 'viewer', scopes: ['notifications:write'], body: X.NotificationUpdate, status: 200, response: X.Notification.single, headers: ['ETag'] }),

  // M6: tokens, approvals, operations
  op({ id: 'listApiTokens', method: 'get', path: '/api-tokens', tag: 'Tokens', summary: '令牌元信息', stability: PL, milestone: 'M6-SERVER', scopes: null, query: page, status: 200, response: X.ApiToken.list }),
  op({ id: 'createApiToken', method: 'post', path: '/api-tokens', tag: 'Tokens', summary: '签发 PAT（只显示一次）', stability: PL, milestone: 'M6-SERVER', scopes: null, body: X.ApiTokenCreate, idempotency: 'optional', status: 201, response: X.ApiTokenCreated, headers: ['Location'] }),
  op({ id: 'revokeApiToken', method: 'delete', path: '/api-tokens/{tokenId}', tag: 'Tokens', summary: '撤销令牌，立即生效', stability: PL, milestone: 'M6-SERVER', scopes: null, ifMatch: false, status: 204 }),
  op({ id: 'listApprovalRequests', method: 'get', path: `${L}/approval-requests`, tag: 'Approvals', summary: '待审批的高影响操作', stability: PL, milestone: 'M6-SERVER', role: 'owner', scopes: null, query: X.ApprovalQuery, status: 200, response: X.ApprovalRequest.list }),
  op({ id: 'createApprovalRequest', method: 'post', path: `${L}/approval-requests`, tag: 'Approvals', summary: 'Agent 发起审批', stability: PL, milestone: 'M6-SERVER', role: 'editor', scopes: ['approvals:write'], body: X.ApprovalRequestCreate, idempotency: 'optional', status: 201, response: X.ApprovalRequest.single, headers: ['Location', 'ETag'] }),
  op({ id: 'getApprovalRequest', method: 'get', path: `${L}/approval-requests/{approvalId}`, tag: 'Approvals', summary: '审批状态', stability: PL, milestone: 'M6-SERVER', role: 'viewer', scopes: ['approvals:write'], status: 200, response: X.ApprovalRequest.single, headers: ['ETag'] }),
  op({ id: 'updateApprovalRequest', method: 'patch', path: `${L}/approval-requests/{approvalId}`, tag: 'Approvals', summary: '批准 / 拒绝（仅 Web 用户）', stability: PL, milestone: 'M6-SERVER', role: 'owner', scopes: null, body: X.ApprovalRequestUpdate, status: 200, response: X.ApprovalRequest.single, headers: ['ETag'] }),
  op({ id: 'getOperation', method: 'get', path: `${L}/operations/{operationId}`, tag: 'Operations', summary: '写入结果 / 异步操作状态（原 actor）', stability: PL, milestone: 'M6-SERVER', role: 'viewer', scopes: [], status: 200, response: X.Operation.single }),
] as const satisfies readonly OperationDef[];

export type Operation = (typeof operations)[number];
export type OperationId = Operation['id'];
export type StableOperationId = Extract<Operation, { stability: 'stable' }>['id'];
export const operationById = new Map<string, OperationDef>(operations.map(o => [o.id, o]));
export const requiresIfMatch = (o: OperationDef) => o.ifMatch ?? (o.method === 'patch' || o.method === 'delete');
export const pathParams = (path: string) => [...path.matchAll(/\{(\w+)\}/g)].map(m => m[1]);

// Malformed percent-encoding becomes an empty value, which never matches a template parameter.
const safeDecode = (value: string) => { try { return decodeURIComponent(value); } catch { return ''; } };

/** Match a concrete path (relative to /api/v1) against the registry. */
export function matchOperation(method: string, pathname: string):
  | { kind: 'match'; operation: OperationDef; params: Record<string, string> }
  | { kind: 'method'; allow: string[] }
  | { kind: 'none' } {
  const parts = pathname.split('/').filter(Boolean);
  const allow: string[] = [];
  for (const operation of operations as readonly OperationDef[]) {
    const template = operation.path.split('/').filter(Boolean);
    if (template.length !== parts.length) continue;
    const params: Record<string, string> = {};
    if (!template.every((t, i) => (t.startsWith('{') ? (params[t.slice(1, -1)] = safeDecode(parts[i])) !== '' : t === parts[i]))) continue;
    if (operation.method === method.toLowerCase()) return { kind: 'match', operation, params };
    allow.push(operation.method.toUpperCase());
  }
  return allow.length ? { kind: 'method', allow } : { kind: 'none' };
}
