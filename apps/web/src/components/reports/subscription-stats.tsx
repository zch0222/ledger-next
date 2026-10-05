import type { SubscriptionSpending } from '@ledger/domain/reports';
import { formatMoney } from '@ledger/ui/format';
import { Icon, type IconName } from '@/components/ui/icons';

type Tile = { label: string; icon: IconName; value: React.ReactNode; hint: string; paidShare?: number };

/**
 * Subscription KPI tiles, server-rendered so they read without chart JavaScript: four on P01 (summary), eight on P05
 * (full). Monthly / yearly are forecasts at the current reference rate; the month's bills split paid from still open.
 */
export function SubscriptionStats({
  data,
  monthLabel,
  variant = 'summary',
}: {
  data: SubscriptionSpending;
  /** "10 月": the month whose bills the progress tile shows. */
  monthLabel: string;
  variant?: 'summary' | 'full';
}) {
  const m = (amount: string) => formatMoney(amount, data.currency);
  const { bills, counts, inactive, top } = data;
  const billsTile: Tile = {
    label: `${monthLabel}订阅账单`,
    icon: 'calendar',
    value: m(bills.total),
    hint: bills.count ? `已付 ${m(bills.paid)} · 待付 ${m(bills.pending)}` : '这个月没有订阅账单',
    paidShare: Number(bills.total) > 0 ? Number(bills.paid) / Number(bills.total) : 0,
  };
  const savingTile: Tile = {
    label: '停用后每月省',
    icon: 'trendingDown',
    value: m(inactive.monthly),
    hint: inactive.count
      ? variant === 'full'
        ? `每年省 ${m(inactive.yearly)}`
        : `${inactive.count} 个已暂停或取消 · 每年 ${m(inactive.yearly)}`
      : '没有暂停或取消的订阅',
  };
  const tiles: Tile[] =
    variant === 'summary'
      ? [
          {
            label: '每月订阅',
            icon: 'subscriptions',
            value: m(data.monthly),
            hint: `${counts.active} 个使用中 · 按周期折算`,
          },
          {
            label: '每年订阅',
            icon: 'analytics',
            value: m(data.yearly),
            hint: `平均每个 ${m(data.averageMonthly)} / 月`,
          },
          billsTile,
          savingTile,
        ]
      : [
          {
            label: '使用中订阅',
            icon: 'subscriptions',
            value: (
              <>
                {counts.active}
                <small> 个</small>
              </>
            ),
            hint: `另有 ${inactive.count} 个已暂停或取消`,
          },
          { label: '每月订阅', icon: 'coins', value: m(data.monthly), hint: '按扣款周期折算的月均' },
          { label: '每年订阅', icon: 'analytics', value: m(data.yearly), hint: '未来一年预计' },
          billsTile,
          { label: '平均每个订阅', icon: 'coins', value: m(data.averageMonthly), hint: '每月' },
          {
            label: '最贵订阅',
            icon: 'crown',
            value: top ? m(top.monthly) : '—',
            hint: top ? `${top.name} · 每月` : '暂无',
          },
          {
            label: '已停用订阅',
            icon: 'pause',
            value: (
              <>
                {inactive.count}
                <small> 个</small>
              </>
            ),
            hint: `暂停 ${counts.paused} · 取消 ${counts.cancelled}`,
          },
          savingTile,
        ];
  return (
    <div className={`stat-grid${variant === 'full' ? ' full' : ''}`}>
      {tiles.map(t => (
        <div className="stat-tile" key={t.label}>
          <div className="stat-label">
            <span className="stat-icon" aria-hidden="true">
              <Icon name={t.icon} size={15} />
            </span>
            {t.label}
          </div>
          <div className="stat-value num">{t.value}</div>
          {t.paidShare !== undefined && (
            <div
              className="track"
              role="progressbar"
              aria-label={`${t.label}已支付`}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={Math.round(t.paidShare * 100)}
            >
              <span style={{ width: `${t.paidShare * 100}%` }} />
            </div>
          )}
          <div className="stat-hint">{t.hint}</div>
        </div>
      ))}
    </div>
  );
}
