import { ENABLED_CURRENCIES } from '../../../../../../../../packages/contracts/src/common';
import { fxStatus, getExchangeRates, listManualRateRecords } from '../../../../../../../../packages/domain/src/fx';
import { sum } from '../../../../../../../../packages/domain/src/money';
import { FRESHNESS_LABELS } from '../../../../../../../../packages/ui/src/format';
import { ManualRateForm } from '../../../../../components/settings/manual-rate';
import { Note, PageHeading, PanelError, SettingsTabs, attempt } from '../../../../../components/ui/page';
import { requireLedger, type LedgerPageProps } from '../../../../../lib/session';
import { today as todayIn } from '../../../../../lib/time';

export const dynamic = 'force-dynamic';
const time = (iso: string | null, tz: string) =>
  iso ? new Date(iso).toLocaleString('zh-CN', { hour12: false, timeZone: tz }) : '—';

/** P09 币种与汇率: reference rates with source time and freshness (never "real-time" without a source), manual rates. */
export default async function Currencies({ params }: LedgerPageProps) {
  const { ledgerId } = await params;
  const { ctx, ledger } = await requireLedger(ledgerId);
  const quotes = ENABLED_CURRENCIES.filter(c => c !== ledger.baseCurrency);
  const [rates, status, manual] = await Promise.all([
    attempt(async () => ({
      rates: await Promise.all(
        quotes.map(async q => ({
          ...(await getExchangeRates({ base: q, quotes: ledger.baseCurrency })).rates[0],
          quote: q,
        })),
      ),
    })),
    attempt(() => fxStatus()),
    listManualRateRecords(ctx, ledgerId, { limit: 50 }),
  ]);
  return (
    <>
      <PageHeading
        title="币种与汇率"
        description="参考汇率不是成交价；账户实际扣款优先，历史账目使用入账时锁定的汇率。"
      />
      <SettingsTabs ledgerId={ledgerId} current="currencies" />
      <section className="panel">
        <h2>基准币种</h2>
        <p>
          <strong>{ledger.baseCurrency}</strong> ·
          历史收支以此入账，首笔入账后固定。顶栏“展示”切换只改变估值显示，不改写账目。
        </p>
      </section>
      <div className="grid">
        <section className="panel">
          <div className="row paneltop">
            <h2>参考汇率</h2>
            {status.ok && (
              <span className={`pill${status.value.freshness === 'fresh' ? '' : ' warn'}`}>
                {status.value.configured
                  ? FRESHNESS_LABELS[status.value.freshness as keyof typeof FRESHNESS_LABELS]
                  : '未配置供应商'}
              </span>
            )}
          </div>
          {rates.ok ? (
            <table>
              <thead>
                <tr>
                  <th>币种</th>
                  <th>1 单位 = {ledger.baseCurrency}</th>
                  <th>状态</th>
                  <th className="hide-mobile">源时间</th>
                </tr>
              </thead>
              <tbody>
                {rates.value.rates.map(r => (
                  <tr key={r.quote}>
                    <td>{r.quote}</td>
                    <td className="num">{r.value ? sum([r.value]).toDecimalPlaces(6).toFixed() : '—'}</td>
                    <td>{FRESHNESS_LABELS[r.freshness as keyof typeof FRESHNESS_LABELS]}</td>
                    <td className="hide-mobile small muted">{time(r.sourceAt, ledger.timezone)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <PanelError error={rates.error} />
          )}
          {status.ok && (
            <p className="small muted">
              来源 {status.value.provider} · 最近成功 {time(status.value.fetchedAt, ledger.timezone)}
              {status.value.consecutiveFailures
                ? ` · 连续失败 ${status.value.consecutiveFailures} 次（${status.value.lastError ?? '原因未知'}）`
                : ''}
              {status.value.suspectBatches ? ` · ${status.value.suspectBatches} 批异常跳变待核验，继续使用旧率` : ''}
              。显示保留 6 位小数；入账以预览中锁定的精确汇率为准。
            </p>
          )}
          {status.ok && status.value.freshness !== 'fresh' && (
            <Note tone="warn">
              汇率{FRESHNESS_LABELS[status.value.freshness as keyof typeof FRESHNESS_LABELS]}
              ：外币记账时需要选择沿用旧率、手填汇率或稍后再记。
            </Note>
          )}
        </section>
        <section className="panel">
          <h2>人工汇率</h2>
          {manual.length ? (
            <ul className="plain-list">
              {manual.map(m => (
                <li key={m.id}>
                  <span>
                    1 {m.base} = {m.value} {m.quote} · {m.effectiveDate}
                  </span>
                  <span className="small muted">{m.reason}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="muted">还没有人工汇率。报表缺少某日汇率时，可在这里补录。</p>
          )}
          <ManualRateForm currencies={ENABLED_CURRENCIES} today={todayIn(ledger.timezone)} />
        </section>
      </div>
    </>
  );
}
