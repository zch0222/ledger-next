import Link from 'next/link';
import { addDays } from '@ledger/domain/dates';
import { listBillOccurrences, listSubscriptions } from '@ledger/domain/subscriptions';
import { formatDate, formatMoney } from '@ledger/ui/format';
import { BillActions, ManageSubscription, NewSubscription } from '@/components/subscriptions/subscription-form';
import { MonthNav } from '@/components/reports/month-nav';
import { EmptyState, Note, PageHeading } from '@/components/ui/page';
import { monthRange, withParams } from '@/lib/period';
import { param, requireLedger, type LedgerPageProps } from '@/lib/session';
import { today as todayIn } from '@/lib/time';

export const dynamic = 'force-dynamic';
const UNITS = { day: '天', week: '周', month: '月', year: '年' } as const;
const STATUS = {
  scheduled: '待扣款',
  due: '今天到期',
  overdue: '已逾期',
  paid: '已支付',
  skipped: '已跳过',
  cancelled: '已取消',
} as const;
const SUB_STATUS = { active: '使用中', paused: '已暂停', cancelled: '已取消' } as const;
const daysUntil = (date: string, today: string) =>
  Math.round((Date.parse(`${date}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86400_000);

/** P04 订阅: cards / list / calendar; forecast (monthly equivalent) is kept apart from what was actually paid. */
export default async function Subscriptions({ params, searchParams }: LedgerPageProps) {
  const { ledgerId } = await params;
  const search = await searchParams;
  const { ctx, ledger } = await requireLedger(ledgerId);
  const today = todayIn(ledger.timezone);
  const view = param(search, 'view') ?? 'cards';
  const range = monthRange(param(search, 'month'), today);
  const [subs, upcoming, month] = await Promise.all([
    listSubscriptions(ctx, ledgerId, {}, { limit: 100 }),
    listBillOccurrences(ctx, ledgerId, { dateFrom: addDays(today, -60), dateTo: addDays(today, 60) }, { limit: 100 }),
    view === 'calendar'
      ? listBillOccurrences(ctx, ledgerId, { dateFrom: range.dateFrom, dateTo: range.dateTo }, { limit: 100 })
      : Promise.resolve([]),
  ]);
  const byId = new Map(subs.map(s => [s.id, s]));
  const open = upcoming.filter(b => ['scheduled', 'due', 'overdue'].includes(b.status));
  const attention = open.filter(b => b.status !== 'scheduled');
  const path = `/ledgers/${ledgerId}/subscriptions`;
  const tabs = [
    ['cards', '卡片'],
    ['list', '账单列表'],
    ['calendar', '日历'],
  ];
  return (
    <>
      <PageHeading
        kicker="订阅"
        title="订阅，有数也有序"
        description="原币金额、扣款日期和提醒方式放在一起；到期先确认支付，才计入实际支出。"
        action={<NewSubscription today={today} />}
      />
      <div className="segmented-links" role="tablist" aria-label="订阅视图">
        {tabs.map(([id, name]) => (
          <Link
            key={id}
            role="tab"
            aria-selected={view === id}
            aria-current={view === id ? 'page' : undefined}
            href={withParams(path, { view: id === 'cards' ? undefined : id, month: param(search, 'month') })}
          >
            {name}
          </Link>
        ))}
      </div>
      {attention.length > 0 && (
        <Note tone="warn">
          {attention.length} 笔账单待确认：
          {attention
            .slice(0, 3)
            .map(b => `${b.name}（${STATUS[b.status as keyof typeof STATUS]}）`)
            .join('、')}
        </Note>
      )}
      {view === 'cards' &&
        (subs.length ? (
          <div className="cards">
            {subs.map(s => {
              const next = open.find(b => b.subscriptionId === s.id);
              return (
                <section className="subcard" key={s.id} aria-labelledby={`sub-${s.id}`}>
                  <div className="row">
                    <div className="merchant">
                      <span className="logo" aria-hidden="true">
                        {s.name.slice(0, 1)}
                      </span>
                      <h2 id={`sub-${s.id}`}>{s.name}</h2>
                    </div>
                    <span className={`pill${s.status === 'active' ? '' : ' warn'}`}>{SUB_STATUS[s.status]}</span>
                  </div>
                  <div className="price num">
                    {formatMoney(s.amount.amount, s.amount.currency, { style: 'code' })}{' '}
                    <small>
                      / {s.cycle.count > 1 ? s.cycle.count : ''}
                      {UNITS[s.cycle.unit]}
                    </small>
                  </div>
                  <p className="sub">
                    月均约 {formatMoney(s.monthlyEquivalent.amount, s.monthlyEquivalent.currency, { style: 'code' })} ·
                    预测
                  </p>
                  <div className="meta">
                    {s.nextDueDate ? (
                      <>
                        下次账单：{s.nextDueDate} ·{' '}
                        {daysUntil(s.nextDueDate, today) === 0
                          ? '今天'
                          : daysUntil(s.nextDueDate, today) > 0
                            ? `${daysUntil(s.nextDueDate, today)} 天后`
                            : `已过 ${-daysUntil(s.nextDueDate, today)} 天`}
                      </>
                    ) : s.status === 'paused' ? (
                      `暂停中${s.pausedUntil ? `，${s.pausedUntil} 恢复` : ''}`
                    ) : s.status === 'cancelled' ? (
                      `服务至 ${s.endsOn}`
                    ) : (
                      '暂无账单'
                    )}
                    {next && (
                      <div className="gap bill-inline">
                        <span>
                          {STATUS[next.status as keyof typeof STATUS]} · {next.scheduledDate}
                        </span>
                        <BillActions bill={next} subscription={s} />
                      </div>
                    )}
                  </div>
                  <ManageSubscription subscription={s} today={today} />
                </section>
              );
            })}
          </div>
        ) : (
          <section className="panel">
            <EmptyState symbol="subscriptions">还没有订阅。添加会员、宽带、云服务等周期账单，到期前提醒你。</EmptyState>
          </section>
        ))}
      {view === 'list' && (
        <section className="panel">
          <h2>前后 60 天的账单</h2>
          {upcoming.length ? (
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>日期</th>
                    <th>订阅</th>
                    <th>金额</th>
                    <th>状态</th>
                    <th>操作</th>
                  </tr>
                </thead>
                <tbody>
                  {upcoming.map(b => (
                    <tr key={b.id}>
                      <td>{formatDate(b.scheduledDate, today)}</td>
                      <td>{b.name}</td>
                      <td className="num">{formatMoney(b.amount.amount, b.amount.currency, { style: 'code' })}</td>
                      <td>
                        {STATUS[b.status as keyof typeof STATUS]}
                        {b.transactionId && (
                          <>
                            {' '}
                            · <Link href={`/ledgers/${ledgerId}/transactions?tx=${b.transactionId}`}>支付记录</Link>
                          </>
                        )}
                      </td>
                      <td>
                        <BillActions bill={b} subscription={byId.get(b.subscriptionId)} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <EmptyState>这段时间没有账单。</EmptyState>
          )}
        </section>
      )}
      {view === 'calendar' && (
        <section className="panel">
          <div className="row paneltop">
            <h2>{range.label}</h2>
            <MonthNav path={path} range={range} params={{ view: 'calendar' }} />
          </div>
          <ul className="calendar" aria-label={`${range.label}账单日历`}>
            {['一', '二', '三', '四', '五', '六', '日'].map(d => (
              <li key={d} className="calendar-head" aria-hidden="true">
                周{d}
              </li>
            ))}
            {Array.from({ length: (new Date(`${range.dateFrom}T00:00:00Z`).getUTCDay() + 6) % 7 }, (_, i) => (
              <li key={`pad-${i}`} className="calendar-cell empty-cell" aria-hidden="true" />
            ))}
            {Array.from({ length: daysUntil(range.dateTo, range.dateFrom) }, (_, i) => {
              const date = addDays(range.dateFrom, i);
              const items = month.filter(b => b.scheduledDate === date);
              return (
                <li
                  key={date}
                  className={`calendar-cell${date === today ? ' today' : ''}`}
                  aria-current={date === today ? 'date' : undefined}
                >
                  <span className="calendar-day">
                    <span aria-hidden="true">{i + 1}</span>
                    <span className="visually-hidden">
                      {date}
                      {items.length ? `，${items.length} 笔账单` : ''}
                    </span>
                  </span>
                  {items.map(b => (
                    <span key={b.id} className={`calendar-bill status-${b.status}`}>
                      {b.name} {formatMoney(b.amount.amount, b.amount.currency, { style: 'code' })}
                      <span className="visually-hidden">，{STATUS[b.status as keyof typeof STATUS]}</span>
                    </span>
                  ))}
                </li>
              );
            })}
          </ul>
        </section>
      )}
    </>
  );
}
