import { listAccounts } from '@ledger/domain/accounts';
import { accountBalances } from '@ledger/domain/reports';
import { formatAmount } from '@ledger/domain/money';
import { ACCOUNT_TYPE_LABELS, FRESHNESS_LABELS, formatMoney } from '@ledger/ui/format';
import { AccountActions, NewAccount } from '@/components/accounts/account-form';
import { EmptyState, Note, PageHeading, PanelError, attempt } from '@/components/ui/page';
import { param, requireLedger, type LedgerPageProps } from '@/lib/session';

export const dynamic = 'force-dynamic';

/** P06 账户: original-currency balances with a reference valuation in the display currency; archive keeps history. */
export default async function Accounts({ params, searchParams }: LedgerPageProps) {
  const { ledgerId } = await params;
  const search = await searchParams;
  const { ctx, ledger } = await requireLedger(ledgerId);
  const currency = param(search, 'currency') ?? ledger.baseCurrency;
  const [all, valued] = await Promise.all([
    listAccounts(ctx, ledgerId, { includeArchived: true, limit: 500 }),
    attempt(() => accountBalances(ctx, ledgerId, { currency })),
  ]);
  const active = all.filter(a => !a.archivedAt);
  const archived = all.filter(a => a.archivedAt);
  const valuation = new Map(valued.ok ? valued.value.items.map(i => [i.accountId, i]) : []);
  return (
    <>
      <PageHeading
        title="账户"
        description="账户按原币保留余额；汇总时按参考汇率估值，不改变任何记录。"
        action={<NewAccount open={Boolean(param(search, 'new'))} first={param(search, 'new') === 'first'} />}
      />
      {valued.ok ? (
        <Note>
          净资产估值 <strong className="num">{formatMoney(valued.value.total, currency)}</strong>
          {valued.value.partial ? ` · ${valued.value.excludedCount} 个账户缺少汇率未计入` : ''}
          {valued.value.sourceAt
            ? ` · 汇率源时间 ${new Date(valued.value.sourceAt).toLocaleString('zh-CN', { hour12: false, timeZone: ledger.timezone })}`
            : ''}
          。信用卡负余额表示负债，还款请用转账。
        </Note>
      ) : (
        <PanelError error={valued.error} title="估值暂时无法读取" />
      )}
      {active.length ? (
        <div className="cards">
          {active.map(a => {
            const v = valuation.get(a.id);
            const balance = formatAmount(a.balance, a.currency);
            const negative = balance.startsWith('-');
            return (
              <section className="accountcard" key={a.id} aria-labelledby={`account-${a.id}`}>
                <div className="row">
                  <h2 id={`account-${a.id}`}>{a.name}</h2>
                  <span className="pill">{a.currency}</span>
                </div>
                <div className="balance num">
                  {formatMoney(balance, a.currency, { style: 'code' })}
                  {a.type === 'credit_card' && negative && <span className="pill warn">负债</span>}
                </div>
                <p>
                  {a.currency === currency
                    ? '结算币即展示币'
                    : v?.valuation
                      ? `参考估值 ${formatMoney(v.valuation, currency)} · ${FRESHNESS_LABELS[v.freshness as keyof typeof FRESHNESS_LABELS]}`
                      : '暂无可用汇率，未计入估值'}
                </p>
                <div className="meta small muted">
                  {ACCOUNT_TYPE_LABELS[a.type]} · 期初{' '}
                  {formatMoney(formatAmount(a.openingBalance, a.currency), a.currency, { style: 'code' })}
                  {a.note ? ` · ${a.note}` : ''}
                </div>
                <AccountActions
                  account={{ id: a.id, name: a.name, currency: a.currency, balance, version: a.version, note: a.note }}
                />
              </section>
            );
          })}
        </div>
      ) : (
        <section className="panel">
          <EmptyState symbol="accounts">还没有账户。新建一个现金、银行卡或信用卡账户开始记账。</EmptyState>
        </section>
      )}
      {archived.length > 0 && (
        <details className="panel archived">
          <summary>已归档账户（{archived.length}）</summary>
          <ul className="plain-list">
            {archived.map(a => (
              <li key={a.id}>
                <span>{a.name}</span>
                <span className="num muted">
                  {formatMoney(formatAmount(a.balance, a.currency), a.currency, { style: 'code' })}
                </span>
              </li>
            ))}
          </ul>
        </details>
      )}
    </>
  );
}
