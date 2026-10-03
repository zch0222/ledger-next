import Link from 'next/link';
import { listCategories } from '../../../../../../../packages/domain/src/catalog';
import { addDays } from '../../../../../../../packages/domain/src/dates';
import { formatAmount, sum } from '../../../../../../../packages/domain/src/money';
import {
  budgetProgress,
  cashFlow,
  categoryBreakdown,
  listBudgets,
  presentBudget,
  reportSummary,
} from '../../../../../../../packages/domain/src/reports';
import { formatMoney, formatPercent } from '../../../../../../../packages/ui/src/format';
import { BudgetForm } from '../../../../components/budgets/budget-form';
import { CategoryPanel } from '../../../../components/reports/category-panel';
import { MonthNav } from '../../../../components/reports/month-nav';
import { TrendPanel } from '../../../../components/reports/trend-panel';
import { EmptyState, Note, PageHeading, PanelError, attempt } from '../../../../components/ui/page';
import { monthRange, withParams } from '../../../../lib/period';
import { param, requireLedger, type LedgerPageProps } from '../../../../lib/session';
import { today as todayIn } from '../../../../lib/time';

export const dynamic = 'force-dynamic';

/** P05 预算与分析: budget progress for the month, spending composition, six-month trend; historical by default. */
export default async function Analytics({ params, searchParams }: LedgerPageProps) {
  const { ledgerId } = await params;
  const search = await searchParams;
  const { ctx, ledger } = await requireLedger(ledgerId);
  const today = todayIn(ledger.timezone);
  const range = monthRange(param(search, 'month'), today);
  const currency = param(search, 'currency') ?? ledger.baseCurrency;
  const valuationMode = param(search, 'valuation') === 'current' ? ('current' as const) : ('historical' as const);
  const sixMonthsFrom = `${monthRange(undefined, addDays(range.dateFrom, -150)).month}-01`;
  const [categories, budgets, progress, composition, trend, summary] = await Promise.all([
    listCategories(ctx, ledgerId, { includeArchived: true, limit: 500 }),
    listBudgets(ctx, ledgerId, { limit: 100 }),
    attempt(() => budgetProgress(ctx, ledgerId, { date: range.isCurrent ? today : range.dateFrom })),
    attempt(() =>
      categoryBreakdown(ctx, ledgerId, { dateFrom: range.dateFrom, dateTo: range.dateTo, currency, valuationMode }),
    ),
    attempt(() =>
      cashFlow(ctx, ledgerId, {
        dateFrom: sixMonthsFrom,
        dateTo: range.dateTo,
        currency,
        valuationMode,
        interval: 'month',
      }),
    ),
    attempt(() =>
      reportSummary(ctx, ledgerId, { dateFrom: range.dateFrom, dateTo: range.dateTo, currency, valuationMode }),
    ),
  ]);
  const path = `/ledgers/${ledgerId}/analytics`;
  const keep = { month: param(search, 'month'), currency: param(search, 'currency') };
  const byId = new Map(budgets.map(b => [b.id, presentBudget(b)]));
  const categoryNames = new Map(categories.map(c => [c.id, c.name]));
  return (
    <div className="page-enter">
      <PageHeading
        title="让预算，变成日常"
        description="预算按历史入账统计；转账本金不占用预算，退款抵减支出。"
        action={
          <div className="gap">
            <MonthNav path={path} range={range} params={{ ...keep, valuation: param(search, 'valuation') }} />
            <BudgetForm today={today} />
          </div>
        }
      />
      <div className="segmented-links" role="group" aria-label="统计口径">
        <Link aria-current={valuationMode === 'historical' ? 'true' : undefined} href={withParams(path, { ...keep })}>
          历史入账
        </Link>
        <Link
          aria-current={valuationMode === 'current' ? 'true' : undefined}
          href={withParams(path, { ...keep, valuation: 'current' })}
        >
          当前估值
        </Link>
      </div>
      {summary.ok && (
        <Note>
          {range.label} · 支出{' '}
          {formatMoney(formatAmount(sum([summary.value.expense]).minus(summary.value.refunds), currency), currency)} ·
          收入 {formatMoney(summary.value.income, currency)} ·{' '}
          {valuationMode === 'historical' ? '历史入账口径' : '按当前参考汇率估值'}
          {summary.value.partial ? ` · ${summary.value.excludedCount} 笔缺汇率未计入` : ''}
        </Note>
      )}
      <div className="grid">
        <section className="panel">
          <div className="row">
            <h2>{range.short}预算</h2>
            <span className="pill">历史入账</span>
          </div>
          {progress.ok ? (
            progress.value.items.length ? (
              progress.value.items.map(item => {
                const ratio = Number(item.ratio);
                const warn = ratio >= 0.8;
                const over = ratio >= 1;
                const budget = byId.get(item.budgetId);
                return (
                  <div className="budget" key={item.budgetId}>
                    <div className="row">
                      <h3>
                        {item.name ?? (item.categoryId ? (categoryNames.get(item.categoryId) ?? '分类预算') : '总预算')}
                      </h3>
                      <span className="num">
                        {formatMoney(item.spent, item.amount.currency)}{' '}
                        <span className="muted">/ {formatMoney(item.amount.amount, item.amount.currency)}</span>
                      </span>
                    </div>
                    <div
                      className="track"
                      role="progressbar"
                      aria-label={`${item.name ?? '预算'} 已用`}
                      aria-valuemin={0}
                      aria-valuemax={100}
                      aria-valuenow={Math.round(Math.max(0, Math.min(ratio, 1)) * 100)}
                    >
                      <span
                        style={{
                          width: `${Math.max(0, Math.min(ratio, 1)) * 100}%`,
                          ...(warn ? { background: 'var(--warn)' } : {}),
                        }}
                      />
                    </div>
                    <div className="row small muted budget-foot">
                      <span>
                        已用 {formatPercent(item.ratio)}
                        {over ? (
                          <>
                            {' '}
                            · <span className="warn-text">⚠ 已超出</span>
                          </>
                        ) : warn ? (
                          <>
                            {' '}
                            · <span className="warn-text">⚠ 接近上限</span>
                          </>
                        ) : null}{' '}
                        · 剩余 {formatMoney(item.remaining, item.amount.currency)}
                      </span>
                      <span className="gap">
                        <Link
                          className="small"
                          href={withParams(`/ledgers/${ledgerId}/transactions`, {
                            dateFrom: item.periodStart,
                            dateTo: item.periodEnd,
                            ...(item.categoryId ? { categoryId: item.categoryId } : { kind: 'expense' }),
                          })}
                        >
                          查看明细 →
                        </Link>
                        {budget && <BudgetForm budget={budget} today={today} />}
                      </span>
                    </div>
                  </div>
                );
              })
            ) : (
              <EmptyState symbol="◔">还没有预算。为总支出或某个分类设一个月度上限。</EmptyState>
            )
          ) : (
            <PanelError error={progress.error} />
          )}
        </section>
        <section className="panel">
          <h2>支出构成</h2>
          {composition.ok ? (
            <CategoryPanel
              variant="composition"
              items={composition.value.items}
              currency={currency}
              ledgerId={ledgerId}
              range={range}
              total={composition.value.total}
              caption={`${range.short}总支出 · ${currency}`}
            />
          ) : (
            <PanelError error={composition.error} />
          )}
          <Note>历史金额固定；切换展示币种不会重写账目。</Note>
        </section>
      </div>
      {trend.ok ? (
        <TrendPanel
          ledgerId={ledgerId}
          currency={currency}
          interval="每月"
          buckets={trend.value.points.map(p => {
            const next = monthRange(p.date.slice(0, 7), today).dateTo;
            return {
              start: p.date,
              end: next,
              label: `${Number(p.date.slice(5, 7))} 月`,
              income: p.income,
              expense: p.expense,
            };
          })}
        />
      ) : (
        <section className="panel">
          <PanelError error={trend.error} />
        </section>
      )}
    </div>
  );
}
