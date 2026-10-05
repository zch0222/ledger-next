import Link from 'next/link';
import { listAccounts } from '@ledger/domain/accounts';
import { listCategories } from '@ledger/domain/catalog';
import { cashFlow, categoryBreakdown, reportSummary, subscriptionSpending } from '@ledger/domain/reports';
import { listBillOccurrences } from '@ledger/domain/subscriptions';
import { listTransactions } from '@ledger/domain/transactions';
import { addDays } from '@ledger/domain/dates';
import { formatAmount, sum } from '@ledger/domain/money';
import { formatDate, formatMoney } from '@ledger/ui/format';
import { CategoryPanel } from '@/components/reports/category-panel';
import { MonthNav } from '@/components/reports/month-nav';
import { SubscriptionBills } from '@/components/reports/subscription-charts';
import { SubscriptionStats } from '@/components/reports/subscription-stats';
import { TrendPanel } from '@/components/reports/trend-panel';
import { AddButton } from '@/components/shell/add-button';
import { TransactionTable } from '@/components/transactions/table';
import { EmptyState, Note, PageHeading, PanelError, attempt } from '@/components/ui/page';
import { monthRange, weekLabel } from '@/lib/period';
import { param, requireLedger, type LedgerPageProps } from '@/lib/session';
import { today as todayIn } from '@/lib/time';
import type { TransactionView } from '@/lib/types';

export const dynamic = 'force-dynamic';
const daysUntil = (date: string, today: string) =>
  Math.round((Date.parse(`${date}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86400_000);

/**
 * P01 总览: KPIs, subscription spending (stat tiles, bills by month, upcoming charges), trend, categories and recent
 * entries — all readable without chart JavaScript.
 */
export default async function Dashboard({ params, searchParams }: LedgerPageProps) {
  const { ledgerId } = await params;
  const search = await searchParams;
  const { ctx, ledger } = await requireLedger(ledgerId);
  const today = todayIn(ledger.timezone);
  const range = monthRange(param(search, 'month'), today);
  const currency = param(search, 'currency') ?? ledger.baseCurrency;
  const query = { dateFrom: range.dateFrom, dateTo: range.dateTo, currency };
  const [summary, flow, categories, recent, bills, subs, accounts, catalog] = await Promise.all([
    attempt(() => reportSummary(ctx, ledgerId, query)),
    attempt(() => cashFlow(ctx, ledgerId, { ...query, interval: 'week' })),
    attempt(() => categoryBreakdown(ctx, ledgerId, query)),
    attempt(async () => {
      const r = await listTransactions(ctx, ledgerId, { status: 'posted', sort: '-localDate', limit: 5 });
      return (await r.present(r.rows.map(x => x.id))) as TransactionView[];
    }),
    attempt(() => listBillOccurrences(ctx, ledgerId, { dateFrom: today, dateTo: addDays(today, 31) }, { limit: 6 })),
    attempt(() => subscriptionSpending(ctx, ledgerId, { month: range.month, currency, before: 2, after: 3 })),
    listAccounts(ctx, ledgerId, { includeArchived: true, limit: 500 }),
    listCategories(ctx, ledgerId, { includeArchived: true, limit: 500 }),
  ]);
  const names = {
    accounts: new Map(accounts.map(a => [a.id, a.name])),
    categories: new Map(catalog.map(c => [c.id, c.name])),
  };
  const s = summary.ok ? summary.value : null;
  // Five rows keep the list level with the bills chart beside it; the full list is one link away.
  const open = bills.ok ? bills.value.filter(b => b.status !== 'paid' && b.status !== 'skipped').slice(0, 5) : [];
  const netExpense = s ? formatMoney(formatAmount(sum([s.expense]).minus(s.refunds), currency), currency) : '—';
  const kpis: [string, string, string][] = [
    ['本月支出', netExpense, '有效支出 − 退款 · 按历史入账'],
    ['本月收入', s ? formatMoney(s.income, currency) : '—', '转账本金不计入'],
    ['本月结余', s ? formatMoney(s.net, currency) : '—', '收入 − 净支出'],
    [
      '未来 7 天到期',
      s ? `${s.upcomingBills.count}` : '—',
      s && s.upcomingBills.count ? `约 ${formatMoney(s.upcomingBills.amount, currency)} · 待确认支付` : '暂无到期账单',
    ],
  ];
  return (
    <div className="page-enter">
      <PageHeading
        title="总览"
        action={
          <MonthNav
            path={`/ledgers/${ledgerId}/dashboard`}
            range={range}
            params={{ currency: param(search, 'currency') }}
          />
        }
      />
      {!accounts.length && (
        <section className="panel onboarding-panel">
          <EmptyState
            symbol="arrowUpRight"
            action={
              <div className="gap">
                <Link className="button primary" href={`/ledgers/${ledgerId}/accounts?new=first`}>
                  新建账户
                </Link>
                <Link className="button" href={`/ledgers/${ledgerId}/settings/data`}>
                  导入 CSV
                </Link>
              </div>
            }
          >
            先添加一个账户（现金、银行卡或信用卡），再记第一笔。
          </EmptyState>
        </section>
      )}
      <div className="metrics">
        {kpis.map(([label, value, hint], i) => (
          <div className="metric" key={label}>
            <div className="label">{label}</div>
            <div className="value num">
              {value}
              {i === 3 && s ? <small> 笔</small> : null}
            </div>
            <div className="hint">{hint}</div>
          </div>
        ))}
      </div>
      {s ? (
        <Note>
          {s.currency} · {s.valuationMode === 'historical' ? '历史入账口径' : '当前估值'}
          {s.partial ? ` · 已汇总，另有 ${s.excludedCount} 笔待补汇率（见设置 · 币种与汇率）` : ''}
          {s.sourceAt
            ? ` · 汇率源时间 ${new Date(s.sourceAt).toLocaleString('zh-CN', { hour12: false, timeZone: ledger.timezone })}`
            : ''}
        </Note>
      ) : (
        <PanelError error={(summary as { error: unknown }).error} title="汇总暂时无法读取" />
      )}
      <section className="panel spotlight" aria-labelledby="subscription-spending">
        <div className="row paneltop chart-head">
          <div>
            <h2 id="subscription-spending">订阅支出</h2>
            <p className="chart-hint">
              预测 · 按当前参考汇率折算为 {currency}
              {subs.ok && subs.value.partial ? ` · ${subs.value.excludedCount} 个订阅缺汇率未计入` : ''}
            </p>
          </div>
          <Link href={`/ledgers/${ledgerId}/subscriptions`}>管理订阅 →</Link>
        </div>
        {!subs.ok ? (
          <PanelError error={subs.error} />
        ) : !subs.value.items.length ? (
          <EmptyState
            symbol="subscriptions"
            action={
              <Link className="button" href={`/ledgers/${ledgerId}/subscriptions`}>
                添加订阅
              </Link>
            }
          >
            还没有订阅。添加会员、云服务等周期账单后，这里会显示每月订阅支出和即将扣款。
          </EmptyState>
        ) : (
          <>
            <SubscriptionStats data={subs.value} monthLabel={range.short} />
            <div className="spotlight-grid">
              <div className="spotlight-part">
                <h3>每月订阅账单</h3>
                <SubscriptionBills data={subs.value} ledgerId={ledgerId} />
              </div>
              <div className="spotlight-part">
                <div className="row paneltop">
                  <h3>即将扣款</h3>
                  <Link href={`/ledgers/${ledgerId}/subscriptions?view=list`}>账单列表 →</Link>
                </div>
                {bills.ok ? (
                  open.length ? (
                    open.map(b => (
                      <div className="due" key={b.id}>
                        <div className="date">
                          {Number(b.scheduledDate.slice(5, 7))} 月<b>{b.scheduledDate.slice(8)}</b>
                        </div>
                        <div className="detail">
                          <strong>{b.name}</strong>
                          <div className="small muted">
                            {b.status === 'due'
                              ? '今天到期'
                              : b.status === 'overdue'
                                ? '已逾期 · 待确认支付'
                                : `${formatDate(b.scheduledDate, today)} · ${daysUntil(b.scheduledDate, today)} 天后`}
                          </div>
                        </div>
                        <div className="num">{formatMoney(b.amount.amount, b.amount.currency, { style: 'code' })}</div>
                      </div>
                    ))
                  ) : (
                    <p className="muted">暂无未来账单。</p>
                  )
                ) : (
                  <PanelError error={bills.error} />
                )}
                <p className="small muted">到期后先确认支付，再计入实际支出。</p>
              </div>
            </div>
          </>
        )}
      </section>
      <div className="grid">
        {flow.ok ? (
          <TrendPanel
            ledgerId={ledgerId}
            currency={currency}
            interval="每周"
            buckets={flow.value.points.map(p => ({
              start: p.date < range.dateFrom ? range.dateFrom : p.date,
              end: addDays(p.date, 7) > range.dateTo ? range.dateTo : addDays(p.date, 7),
              label: weekLabel(p.date),
              income: p.income,
              expense: p.expense,
            }))}
          />
        ) : (
          <section className="panel">
            <h2>收支趋势</h2>
            <PanelError error={flow.error} />
          </section>
        )}
        <section className="panel">
          <div className="row paneltop chart-head">
            <h2>钱花在哪里</h2>
            <span className="small muted">点击分类查看</span>
          </div>
          <p className="chart-hint">分类排行 · {currency}</p>
          {categories.ok ? (
            <CategoryPanel items={categories.value.items} currency={currency} ledgerId={ledgerId} range={range} />
          ) : (
            <PanelError error={categories.error} />
          )}
        </section>
      </div>
      <section className="panel">
        <div className="row paneltop">
          <h2>最近账目</h2>
          <Link href={`/ledgers/${ledgerId}/transactions`}>全部账目 →</Link>
        </div>
        {recent.ok ? (
          recent.value.length ? (
            <TransactionTable
              rows={recent.value}
              names={names}
              today={today}
              hrefFor={id => `/ledgers/${ledgerId}/transactions?tx=${id}`}
            />
          ) : (
            <EmptyState action={accounts.length ? <AddButton label="记第一笔" className="primary" /> : null}>
              还没有账目。
            </EmptyState>
          )
        ) : (
          <PanelError error={recent.error} />
        )}
      </section>
    </div>
  );
}
