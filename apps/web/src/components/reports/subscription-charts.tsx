'use client';
import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import type { SubscriptionSpending } from '@ledger/domain/reports';
import { formatMoney } from '@ledger/ui/format';
import { Chart } from '@/components/charts/chart';
import { Icon } from '@/components/ui/icons';

type Data = SubscriptionSpending;
const UNITS = { day: '天', week: '周', month: '月', year: '年' } as const;
const monthTitle = (month: string) => `${month.slice(0, 4)} 年 ${Number(month.slice(5))} 月`;
/** "USD 20.00 / 3月": the subscription's own price and cycle. */
const priceNote = (i: Data['items'][number]) =>
  `${formatMoney(i.amount.amount, i.amount.currency, { style: 'code' })} / ${i.cycle.count > 1 ? i.cycle.count : ''}${UNITS[i.cycle.unit]}`;

function NoSubscriptions({ ledgerId, children }: { ledgerId: string; children: React.ReactNode }) {
  return (
    <div className="empty chart-empty">
      <span className="empty-symbol" aria-hidden="true">
        <Icon name="subscriptions" size={40} strokeWidth={1.5} />
      </span>
      <p>{children}</p>
      <Link className="button" href={`/ledgers/${ledgerId}/subscriptions`}>
        添加订阅
      </Link>
    </div>
  );
}

/**
 * Subscription bills per month (paid / still to pay, stacked) against the monthly equivalent; the selected month is
 * emphasised. A bar or a table row opens that month in the subscription calendar.
 */
export function SubscriptionBills({ data, ledgerId }: { data: Data; ledgerId: string }) {
  const router = useRouter();
  const { timeline, currency } = data;
  const model = useMemo(
    () => ({
      type: 'bills' as const,
      currency,
      average: data.monthly,
      points: timeline.map(t => ({
        label: `${Number(t.month.slice(5))}月`,
        title: monthTitle(t.month),
        paid: t.paid,
        pending: t.pending,
        total: t.total,
        count: t.count,
        current: t.month === data.month,
      })),
      description: `每月订阅账单，已支付与待支付分开堆叠，虚线为月均 ${data.monthly}，单位 ${currency}。下方有数据表。`,
    }),
    [timeline, currency, data.monthly, data.month],
  );
  const calendar = (month: string) => `/ledgers/${ledgerId}/subscriptions?view=calendar&month=${month}`;
  if (!timeline.some(t => t.count > 0)) {
    return <NoSubscriptions ledgerId={ledgerId}>这段时间没有订阅账单。</NoSubscriptions>;
  }
  return (
    <>
      <div className="chart-legend">
        <span>
          <i />
          已支付
        </span>
        <span>
          <i className="pending" />
          待支付 / 预计
        </span>
        <span>
          <i className="avg" />
          月均 {formatMoney(data.monthly, currency)}
        </span>
      </div>
      <Chart
        model={model}
        className="echart bills-chart"
        onSelect={({ index }) => {
          if (timeline[index]) router.push(calendar(timeline[index].month));
        }}
      />
      <details className="chart-data">
        <summary>查看每月账单数据</summary>
        <table>
          <thead>
            <tr>
              <th>月份</th>
              <th>已支付</th>
              <th>待支付</th>
              <th>合计</th>
            </tr>
          </thead>
          <tbody>
            {timeline.map(t => (
              <tr key={t.month}>
                <td>
                  <a href={calendar(t.month)}>{monthTitle(t.month)}</a>
                </td>
                <td className="num">{formatMoney(t.paid, currency)}</td>
                <td className="num">{formatMoney(t.pending, currency)}</td>
                <td className="num">
                  {formatMoney(t.total, currency)} <span className="muted">· {t.count} 笔</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </>
  );
}

type Group = Data['byCategory'][number];
/** Five largest groups keep their colour by rank; the rest merge into 其他 (UI_SPEC §2), like the expense donut. */
function topGroups(groups: Group[]) {
  if (groups.length <= 6) return groups.map((g, n) => ({ ...g, colorIndex: n }));
  const rest = groups.slice(5);
  return [
    ...groups.slice(0, 5).map((g, n) => ({ ...g, colorIndex: n })),
    {
      id: 'other',
      name: '其他',
      monthly: rest.reduce((total, g) => total + Number(g.monthly), 0).toFixed(2),
      share: rest.reduce((total, g) => total + Number(g.share), 0).toFixed(4),
      count: rest.reduce((n, g) => n + g.count, 0),
      colorIndex: 5,
    },
  ];
}

/** Where the subscription money goes: monthly equivalent by category or by paying account, on one donut instance. */
export function SubscriptionMix({ data, ledgerId }: { data: Data; ledgerId: string }) {
  const [by, setBy] = useState<'category' | 'account'>('category');
  const groups = by === 'category' ? data.byCategory : data.byAccount;
  const top = useMemo(() => topGroups(groups), [groups]);
  const model = useMemo(
    () => ({
      type: 'mix' as const,
      currency: data.currency,
      total: data.monthly,
      caption: `每月 · ${by === 'category' ? '按分类' : '按支付账户'}`,
      items: top.map(g => ({ name: g.name, amount: g.monthly, colorIndex: g.colorIndex })),
      description: `使用中订阅的月均费用${by === 'category' ? '按分类' : '按支付账户'}的占比，单位 ${data.currency}；各项金额见下方列表。`,
    }),
    [top, by, data.currency, data.monthly],
  );
  return (
    <section className="panel">
      <div className="row paneltop chart-head">
        <h2>订阅构成</h2>
        <div className="chart-toggle" role="group" aria-label="订阅构成维度">
          <button aria-pressed={by === 'category'} onClick={() => setBy('category')}>
            按分类
          </button>
          <button aria-pressed={by === 'account'} onClick={() => setBy('account')}>
            按支付账户
          </button>
        </div>
      </div>
      {top.length ? (
        <>
          <Chart model={model} className="echart composition-chart" />
          <div
            className="mix-legend"
            role="group"
            aria-label={`订阅月均费用${by === 'category' ? '按分类' : '按支付账户'}`}
          >
            {groups.map(g => (
              <div className="mix-row" key={g.id ?? 'none'}>
                <span>
                  <i className="key" data-color={top.find(t => t.id === g.id)?.colorIndex ?? 5} />
                  {g.name}
                  <span className="muted"> · {g.count} 个</span>
                </span>
                <span className="num">
                  {formatMoney(g.monthly, data.currency)}
                  <span className="share">{(Number(g.share) * 100).toFixed(1)}%</span>
                </span>
              </div>
            ))}
          </div>
        </>
      ) : (
        <NoSubscriptions ledgerId={ledgerId}>还没有使用中的订阅。</NoSubscriptions>
      )}
    </section>
  );
}

/** The most expensive running subscriptions by monthly equivalent, coloured by their category (as in 订阅构成). */
export function SubscriptionRanking({ data, ledgerId, limit = 8 }: { data: Data; ledgerId: string; limit?: number }) {
  const ranked = useMemo(() => data.items.filter(i => i.status === 'active' && i.monthly !== null), [data.items]);
  const colors = useMemo(() => {
    const top = topGroups(data.byCategory);
    return (categoryId: string | null) => top.find(g => g.id === categoryId)?.colorIndex ?? 5;
  }, [data.byCategory]);
  const model = useMemo(
    () => ({
      type: 'ranking' as const,
      currency: data.currency,
      items: ranked.slice(0, limit).map(i => ({
        name: i.name,
        amount: i.monthly!,
        colorIndex: colors(i.categoryId),
        note: priceNote(i),
      })),
      description: `使用中订阅按月均费用排行，单位 ${data.currency}；完整列表见下方数据表。`,
    }),
    [ranked, limit, colors, data.currency],
  );
  return (
    <section className="panel">
      <div className="row paneltop chart-head">
        <h2>订阅排行</h2>
      </div>
      <p className="chart-hint">
        每月费用 · {data.currency}
        {ranked.length > limit ? ` · 前 ${limit} 个，共 ${ranked.length} 个` : ''}
      </p>
      {ranked.length ? (
        <>
          <Chart
            model={model}
            className="echart ranking-chart"
            height={Math.max(120, Math.min(ranked.length, limit) * 40 + 16)}
          />
          <details className="chart-data">
            <summary>查看全部订阅费用</summary>
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>订阅</th>
                    <th>扣款</th>
                    <th>每月</th>
                    <th>每年</th>
                  </tr>
                </thead>
                <tbody>
                  {ranked.map(i => (
                    <tr key={i.subscriptionId}>
                      <td>{i.name}</td>
                      <td className="num">{priceNote(i)}</td>
                      <td className="num">{formatMoney(i.monthly!, data.currency)}</td>
                      <td className="num">{formatMoney(i.yearly!, data.currency)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
        </>
      ) : (
        <NoSubscriptions ledgerId={ledgerId}>还没有使用中的订阅。</NoSubscriptions>
      )}
    </section>
  );
}
