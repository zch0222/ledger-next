'use client';
import { useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { formatMoney } from '@ledger/ui/format';
import { Chart } from '@/components/charts/chart';
import { useLedgerUI } from '@/components/ledger-ui';
import { Icon } from '@/components/ui/icons';

export type CategoryRow = { categoryId: string | null; name: string; amount: string; share: string; count: number };
/** Top six categories, the rest merged into 其他 (UI_SPEC §2); colours stay fixed per position, never per theme. */
export function topCategories(items: CategoryRow[]) {
  const positive = items.filter(i => Number(i.amount) > 0);
  if (positive.length <= 6) return positive.map((i, n) => ({ ...i, colorIndex: n, key: i.categoryId ?? 'none' }));
  const rest = positive.slice(5);
  const other = rest.reduce((sum, i) => sum + Number(i.amount), 0);
  return [
    ...positive.slice(0, 5).map((i, n) => ({ ...i, colorIndex: n, key: i.categoryId ?? 'none' })),
    {
      categoryId: null,
      name: '其他',
      amount: other.toFixed(2),
      share: '',
      count: rest.reduce((n, i) => n + i.count, 0),
      colorIndex: 5,
      key: 'other',
    },
  ];
}
export function CategoryPanel({
  items,
  currency,
  ledgerId,
  range,
  variant = 'categories',
  total,
  caption,
}: {
  items: CategoryRow[];
  currency: string;
  ledgerId: string;
  range: { dateFrom: string; dateTo: string };
  variant?: 'categories' | 'composition';
  total?: string;
  caption?: string;
}) {
  const router = useRouter();
  const top = useMemo(() => topCategories(items), [items]);
  const base = useLedgerUI().ledger.baseCurrency;
  // A category drills into its expenses and their refunds (refunds keep the category), so the list adds up to the
  // net amount shown here; uncategorized falls back to all expenses of the period.
  const href = (categoryId: string | null) =>
    `/ledgers/${ledgerId}/transactions?dateFrom=${range.dateFrom}&dateTo=${range.dateTo}${categoryId ? `&categoryId=${categoryId}` : '&kind=expense'}${currency !== base ? `&currency=${currency}` : ''}`;
  const model = useMemo(
    () =>
      variant === 'composition'
        ? {
            type: 'composition' as const,
            items: top.map(t => ({ name: t.name, amount: t.amount, colorIndex: t.colorIndex })),
            currency,
            total: total ?? '0',
            caption: caption ?? '',
            description: `按历史入账口径的支出占比，单位 ${currency}；各分类金额见下方列表。`,
          }
        : {
            type: 'categories' as const,
            items: top.map(t => ({ name: t.name, amount: t.amount, colorIndex: t.colorIndex })),
            currency,
            description: `支出分类排行，单位 ${currency}。点击分类查看明细，下方有键盘可访问的列表。`,
          },
    [top, currency, variant, total, caption],
  );
  const select = ({ name }: { name: string }) => {
    const hit = top.find(t => t.name === name);
    if (hit && hit.key !== 'other') router.push(href(hit.categoryId));
  };
  if (!top.length) {
    return (
      <div className="empty chart-empty">
        <span className="empty-symbol" aria-hidden="true">
          <Icon name="analytics" size={40} strokeWidth={1.5} />
        </span>
        <p>这段时间还没有支出。</p>
      </div>
    );
  }
  return (
    <>
      {/* A ranking is as tall as its rows, so two categories do not float in a 252px box. */}
      <Chart
        model={model}
        onSelect={select}
        className={variant === 'composition' ? 'echart composition-chart' : 'echart category-chart'}
        height={variant === 'composition' ? undefined : Math.max(120, top.length * 42 + 16)}
      />
      {variant === 'composition' ? (
        <div className="composition-legend" aria-label="支出分类数据与明细">
          {items
            .filter(i => Number(i.amount) !== 0)
            .map(i => (
              <a key={i.categoryId ?? 'none'} className="legend-row" href={href(i.categoryId)}>
                <span>
                  <i className="key" data-color={top.find(t => t.categoryId === i.categoryId)?.colorIndex ?? 5} />
                  {i.name}
                </span>
                <span className="num">
                  {formatMoney(i.amount, currency)}
                  <span className="share">{(Number(i.share) * 100).toFixed(1)}%</span>
                </span>
              </a>
            ))}
        </div>
      ) : (
        <details className="chart-data">
          <summary>查看分类数据与明细</summary>
          {items.map(i => (
            <div className="category" key={i.categoryId ?? 'none'}>
              <a className="row" href={href(i.categoryId)}>
                <span>{i.name}</span>
                <span className="num">{formatMoney(i.amount, currency)} →</span>
              </a>
            </div>
          ))}
        </details>
      )}
    </>
  );
}
