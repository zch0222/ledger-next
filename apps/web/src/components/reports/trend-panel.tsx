'use client';
import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { formatMoney } from '@ledger/ui/format';
import { Chart } from '@/components/charts/chart';
import { useLedgerUI } from '@/components/ledger-ui';

export type TrendBucket = { start: string; end: string; label: string; income: string; expense: string };
/** P01 收支趋势: 支出走势 (area line) ↔ 收支对比 (grouped bars) on one chart instance; a bucket drills into its transactions. */
export function TrendPanel({
  buckets,
  currency,
  ledgerId,
  interval,
}: {
  buckets: TrendBucket[];
  currency: string;
  ledgerId: string;
  interval: string;
}) {
  const [mode, setMode] = useState<'expense' | 'compare'>('expense');
  const router = useRouter();
  const model = useMemo(
    () => ({
      type: 'trend' as const,
      mode,
      currency,
      points: buckets.map(b => ({ label: b.label, income: b.income, expense: b.expense })),
      description: `${interval}${mode === 'compare' ? '收入与支出' : '支出'}，单位 ${currency}。下方有可访问数据表。`,
    }),
    [buckets, mode, currency, interval],
  );
  const base = useLedgerUI().ledger.baseCurrency;
  const drill = (b: TrendBucket) =>
    `/ledgers/${ledgerId}/transactions?dateFrom=${b.start}&dateTo=${b.end}${currency !== base ? `&currency=${currency}` : ''}`;
  return (
    <section className="panel">
      <div className="row paneltop chart-head">
        <h2>收支趋势</h2>
        <div className="chart-toggle" role="group" aria-label="趋势显示方式">
          <button aria-pressed={mode === 'expense'} onClick={() => setMode('expense')}>
            支出走势
          </button>
          <button aria-pressed={mode === 'compare'} onClick={() => setMode('compare')}>
            收支对比
          </button>
        </div>
      </div>
      <div className="chart-legend">
        <span>
          <i />
          支出
        </span>
        {mode === 'compare' && (
          <span>
            <i className="inc" />
            收入
          </span>
        )}
        <span>
          {interval} · {currency}
        </span>
      </div>
      <Chart
        model={model}
        onSelect={({ index }) => {
          if (buckets[index]) router.push(drill(buckets[index]));
        }}
      />
      <details className="chart-data">
        <summary>查看数据表与明细</summary>
        <table>
          <thead>
            <tr>
              <th>期间</th>
              <th>收入</th>
              <th>支出</th>
            </tr>
          </thead>
          <tbody>
            {buckets.map(b => (
              <tr key={b.start}>
                <td>
                  <a href={drill(b)}>{b.label}</a>
                </td>
                <td className="num">{formatMoney(b.income, currency)}</td>
                <td className="num">{formatMoney(b.expense, currency)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </section>
  );
}
