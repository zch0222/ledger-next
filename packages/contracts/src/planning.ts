import { z } from 'zod';
import {
  Currency,
  Decimal,
  Freshness,
  LocalDate,
  Money,
  Rate,
  Timestamp,
  Timezone,
  input,
  output,
  pageQuery,
  resource,
  shared,
  uuid,
} from './common';
import { Transaction } from './finance';

const version = z.number().int().positive();

export const Cycle = shared(
  'Cycle',
  z.object({ unit: z.enum(['day', 'week', 'month', 'year']), count: z.number().int().min(1).max(366) }).strict(),
  '月末规则：锚点保留，短月取当月最后一天（1/31 → 2/28 → 3/31）',
);
export const SubscriptionStatus = shared('SubscriptionStatus', z.enum(['active', 'paused', 'cancelled']));
export const Subscription = resource(
  'Subscription',
  z.object({
    id: uuid,
    name: z.string(),
    amount: Money,
    accountId: uuid.nullable(),
    categoryId: uuid.nullable(),
    cycle: Cycle,
    anchorDate: LocalDate,
    timezone: z.string(),
    status: SubscriptionStatus,
    nextDueDate: LocalDate.nullable(),
    note: z.string().nullable(),
    scheduleVersion: version,
    version,
    createdAt: Timestamp,
    pausedUntil: LocalDate.nullable().meta({ description: '暂停到该日自动恢复；null 为无限期' }),
    endsOn: LocalDate.nullable().meta({ description: '取消后服务结束日' }),
    monthlyEquivalent: Money.meta({ description: '预测指标（月均），不计入实际支出' }),
    trialEndsOn: LocalDate.nullable().meta({ description: '试用结束日（trial_end 提醒）' }),
    cancelBy: LocalDate.nullable().meta({ description: '取消截止日（cancel_deadline 提醒）' }),
  }),
  '到期只生成账单，确认支付才产生交易；修改金额 / 周期 / 账户会增加 scheduleVersion 并取消未付的旧计划',
);
const subscriptionFields = {
  name: z.string().trim().min(1).max(80),
  amount: Money,
  accountId: uuid.optional(),
  categoryId: uuid.optional(),
  cycle: Cycle,
  anchorDate: LocalDate,
  timezone: Timezone,
  note: z.string().max(500).optional(),
  trialEndsOn: LocalDate.optional(),
  cancelBy: LocalDate.optional(),
};
export const SubscriptionPreviewCreate = input('SubscriptionPreviewCreate', z.object(subscriptionFields).strict());
export const SubscriptionPreview = resource(
  'SubscriptionPreview',
  z.object({
    previewId: uuid,
    expiresAt: Timestamp,
    nextOccurrences: z.array(LocalDate).length(3),
    monthlyEquivalent: Money.meta({ description: '预测指标，不计入当月实际支出' }),
    warnings: z.array(z.object({ code: z.string(), message: z.string() })),
  }),
);
export const SubscriptionUpdate = input(
  'SubscriptionUpdate',
  z
    .object({
      name: subscriptionFields.name.optional(),
      amount: Money.optional(),
      accountId: uuid.nullable().optional(),
      categoryId: uuid.nullable().optional(),
      cycle: Cycle.optional(),
      anchorDate: LocalDate.optional(),
      status: SubscriptionStatus.optional(),
      note: z.string().max(500).nullable().optional(),
      trialEndsOn: LocalDate.nullable().optional(),
      cancelBy: LocalDate.nullable().optional(),
      pausedUntil: LocalDate.nullable().optional().meta({ description: '与 status=paused 一起：到该日自动恢复' }),
      endsOn: LocalDate.optional().meta({
        description: '与 status=cancelled 一起：服务结束日，默认今天；之后的账单取消',
      }),
    })
    .strict(),
  '修改周期会增加 scheduleVersion 并取消未发送的旧提醒；取消只阻止未来 occurrence',
);
export const SubscriptionQuery = z.object({ status: SubscriptionStatus.optional(), ...pageQuery }).strict();

export const BillStatus = output(
  'BillStatus',
  z.enum(['scheduled', 'due', 'paid', 'skipped', 'overdue', 'cancelled']),
  'due = 当天到期；overdue = 已过到期日未付；cancelled = 订阅暂停 / 取消 / 改期后作废的旧计划',
);
export const BillOccurrence = resource(
  'BillOccurrence',
  z.object({
    id: uuid,
    subscriptionId: uuid,
    name: z.string().meta({ description: '订阅名称' }),
    scheduledDate: LocalDate,
    scheduleVersion: version,
    status: BillStatus,
    amount: Money,
    transactionId: uuid.nullable(),
    paidAt: Timestamp.nullable(),
    version,
  }),
);
export const BillOccurrenceQuery = z
  .object({
    dateFrom: LocalDate,
    dateTo: LocalDate,
    subscriptionId: uuid.optional(),
    status: BillStatus.optional(),
    ...pageQuery,
  })
  .strict();
export const BillOccurrenceUpdate = input(
  'BillOccurrenceUpdate',
  z.object({ status: z.enum(['skipped', 'scheduled']) }).strict(),
  '跳过或恢复；已支付不能改回',
);
export const BillPaymentCreate = input(
  'BillPaymentCreate',
  z.union([z.object({ previewId: uuid }).strict(), z.object({ transactionId: uuid }).strict()]),
  '提交新交易预览，或关联已存在的支出；每个 occurrence 只能关联一笔',
);
export const BillPayment = resource(
  'BillPayment',
  z.object({ occurrence: BillOccurrence.schema, transaction: Transaction.schema }),
);

export const Budget = resource(
  'Budget',
  z.object({
    id: uuid,
    name: z.string().nullable(),
    categoryId: uuid.nullable().meta({ description: 'null 表示总预算' }),
    period: z.enum(['week', 'month', 'year']),
    amount: Money,
    startDate: LocalDate,
    alertThresholds: z.array(z.number().int().min(1).max(200)),
    archivedAt: Timestamp.nullable(),
    version,
  }),
  '自然周（周一起）/ 自然月 / 自然年，周期边界按账本时区；金额须为账本基准币，按历史入账金额统计，退款冲减，转账不占预算',
);
export const BudgetCreate = input(
  'BudgetCreate',
  z
    .object({
      name: z.string().max(80).optional(),
      categoryId: uuid.optional(),
      period: z.enum(['week', 'month', 'year']),
      amount: Money,
      startDate: LocalDate,
      alertThresholds: z.array(z.number().int().min(1).max(200)).max(5).default([80, 100]),
    })
    .strict(),
);
export const BudgetUpdate = input(
  'BudgetUpdate',
  z
    .object({
      name: z.string().max(80).nullable().optional(),
      amount: Money.optional(),
      alertThresholds: z.array(z.number().int().min(1).max(200)).max(5).optional(),
    })
    .strict(),
);

export const BudgetProgressQuery = z
  .object({ date: LocalDate.optional().meta({ description: '统计包含该日的周期，默认账本时区今天' }) })
  .strict();
const valuationMode = z
  .enum(['historical', 'current'])
  .meta({ description: 'historical 使用入账时 base_amount；current 按 asOf 参考汇率估值' });
export const ReportQuery = z
  .object({
    dateFrom: LocalDate,
    dateTo: LocalDate,
    currency: Currency.optional(),
    valuationMode: valuationMode.default('historical'),
    accountId: uuid.optional(),
    categoryId: uuid.optional(),
  })
  .strict();
const reportBasis = {
  currency: Currency,
  valuationMode,
  partial: z.boolean(),
  excludedCount: z.number().int().min(0).meta({ description: '因缺汇率被排除的交易数' }),
  dataVersion: z.number().int().min(0),
  sourceAt: Timestamp.nullable(),
};
export const ReportSummary = resource(
  'ReportSummary',
  z.object({
    period: z.object({ dateFrom: LocalDate, dateTo: LocalDate, timezone: z.string() }),
    income: Decimal,
    expense: Decimal,
    refunds: Decimal,
    net: Decimal,
    upcomingBills: z.object({ count: z.number().int().min(0), amount: Decimal }),
    ...reportBasis,
  }),
  '转账本金不计收支；退款冲减支出，不记为收入',
);
export const CashFlow = resource(
  'CashFlow',
  z.object({
    interval: z.enum(['day', 'week', 'month']),
    points: z.array(z.object({ date: LocalDate, income: Decimal, expense: Decimal, net: Decimal })).max(366),
    ...reportBasis,
  }),
);
export const CashFlowQuery = ReportQuery.extend({
  interval: z.enum(['day', 'week', 'month']).default('week'),
}).strict();
export const SubscriptionSpendingQuery = z
  .object({
    month: z
      .string()
      .regex(/^\d{4}-(0[1-9]|1[0-2])$/)
      .optional()
      .meta({ description: '统计本月账单的月份 YYYY-MM，默认账本时区本月' }),
    currency: Currency.optional(),
    before: z.number().int().min(0).max(23).default(5).meta({ description: '时间线包含该月之前的月数' }),
    after: z.number().int().min(0).max(23).default(6).meta({ description: '时间线包含该月之后的月数' }),
  })
  .strict();
export const CategoryBreakdown = resource(
  'CategoryBreakdown',
  z.object({
    kind: z.enum(['expense', 'income']),
    total: Decimal,
    items: z.array(
      z.object({
        categoryId: uuid.nullable(),
        name: z.string(),
        amount: Decimal,
        share: Decimal,
        count: z.number().int().min(0),
      }),
    ),
    ...reportBasis,
  }),
);
export const CategoryBreakdownQuery = ReportQuery.extend({
  kind: z.enum(['expense', 'income']).default('expense'),
}).strict();
export const AccountBalances = resource(
  'AccountBalances',
  z.object({
    asOf: Timestamp,
    total: Decimal,
    items: z.array(
      z.object({
        accountId: uuid,
        name: z.string(),
        currency: Currency,
        balance: Decimal,
        valuation: Decimal.nullable(),
        freshness: Freshness,
      }),
    ),
    ...reportBasis,
  }),
  '净资产估值：各账户原币余额按 asOf 参考汇率折算，缺率部分计入 excludedCount',
);
export const BudgetProgress = resource(
  'BudgetProgress',
  z.object({
    date: LocalDate,
    items: z.array(
      z.object({
        budgetId: uuid,
        name: z.string().nullable(),
        categoryId: uuid.nullable(),
        period: z.enum(['week', 'month', 'year']),
        periodStart: LocalDate,
        periodEnd: LocalDate.meta({ description: '不含当日' }),
        amount: Money,
        spent: Decimal,
        remaining: Decimal,
        ratio: z.string().meta({ description: '已用比例（小数，4 位）' }),
        reachedThresholds: z.array(z.number().int()),
      }),
    ),
    ...reportBasis,
  }),
  '预算进度：分类预算含其子分类；超过 80% 时 UI 除变色外显示文字提示',
);
export const AccountBalancesQuery = z.object({ asOf: Timestamp.optional(), currency: Currency.optional() }).strict();

export const ExchangeRates = resource(
  'ExchangeRates',
  z.object({
    base: Currency,
    asOf: Timestamp,
    rates: z.array(
      z.object({
        quote: Currency,
        value: Rate.nullable(),
        sourceAt: Timestamp.nullable(),
        fetchedAt: Timestamp.nullable(),
        freshness: Freshness,
        source: z.string().nullable(),
      }),
    ),
  }),
  '参考汇率，不是成交价格；sourceAt 是供应商报价时间，不能以抓取时间冒充',
);
export const ExchangeRateQuery = z
  .object({
    base: Currency,
    quotes: z
      .string()
      .regex(/^[A-Z]{3}(,[A-Z]{3}){0,19}$/)
      .meta({ description: '逗号分隔币种' }),
    asOf: Timestamp.optional(),
  })
  .strict();
export const ManualRateRecordCreate = input(
  'ManualRateRecordCreate',
  z
    .object({
      base: Currency,
      quote: Currency,
      value: Rate,
      effectiveDate: LocalDate,
      reason: z.string().trim().min(1).max(200),
    })
    .strict(),
);
export const ManualRateRecord = resource(
  'ManualRateRecord',
  z.object({
    id: uuid,
    base: Currency,
    quote: Currency,
    value: Rate,
    effectiveDate: LocalDate,
    reason: z.string(),
    createdBy: uuid,
    createdAt: Timestamp,
  }),
);
export const RefreshJobCreate = input(
  'ExchangeRateRefreshJobCreate',
  z.object({ reason: z.string().max(200).optional() }).strict(),
);
export const RefreshJob = resource(
  'ExchangeRateRefreshJob',
  z.object({
    id: uuid,
    status: z.enum(['queued', 'running', 'succeeded', 'failed']),
    createdAt: Timestamp,
    completedAt: Timestamp.nullable(),
  }),
  '同一时间窗口去重；严格限流',
);
