import Link from 'next/link';
import { formatDate, formatMoney, KIND_LABELS } from '../../../../../packages/ui/src/format';
import type { TransactionView } from '../../lib/types';

type Names = { accounts: Map<string, string>; categories: Map<string, string> };
const signOf = (t: TransactionView) => (t.kind === 'income' || t.kind === 'refund' ? 'always' : t.kind === 'expense' ? 'neg' : 'none');
/** Amount as booked in the base currency (historical); direction is spelled out, never colour only. */
function Amount({ t }: { t: TransactionView }) {
  const sign = signOf(t), value = formatMoney(t.base.amount, t.base.currency, { sign: sign === 'none' ? 'never' : 'always' });
  return <span className={`amount num${sign === 'always' ? ' income-amount' : ''}`}>{sign === 'neg' ? `−${formatMoney(t.base.amount, t.base.currency, { sign: 'never' })}` : value}</span>;
}
function title(t: TransactionView, names: Names) {
  if (t.kind === 'transfer' && t.transfer) return `${names.accounts.get(t.transfer.sourceAccountId) ?? '账户'} → ${names.accounts.get(t.transfer.targetAccountId) ?? '账户'}`;
  return t.merchant ?? (t.categoryId ? names.categories.get(t.categoryId) : null) ?? KIND_LABELS[t.kind];
}
/**
 * P02 table: desktop shows all columns; on phones the category / account column hides and rows read as cards under
 * date group headers. Each amount opens the detail drawer (?tx=), keeping the current filters.
 */
export function TransactionTable({ rows, names, hrefFor, grouped = false, today }: { rows: TransactionView[]; names: Names; hrefFor: (id: string) => string; grouped?: boolean; today: string }) {
  return <div className="table-scroll"><table className="transactions"><thead><tr><th>交易</th><th className="hide-mobile">分类 / 账户</th><th className="hide-mobile">日期</th><th>金额 · 历史入账</th></tr></thead><tbody>
    {rows.map((t, i) => {
      const header = grouped && t.localDate !== rows[i - 1]?.localDate ? <tr className="date-row" key={`d-${t.localDate}`}><th colSpan={4} scope="rowgroup">{formatDate(t.localDate, today)}</th></tr> : null;
      const label = title(t, names);
      return [header, <tr key={t.id} className={t.status === 'voided' ? 'voided' : undefined}>
        <td><div className="merchant"><span className="logo" aria-hidden="true">{label.slice(0, 1)}</span><div><strong>{label}</strong><div className="small muted">{KIND_LABELS[t.kind]} · {formatMoney(t.settlement.amount, t.settlement.currency, { style: 'code' })}{t.status === 'voided' ? ' · 已作废' : ''}{t.source === 'import' ? ' · 导入' : t.source === 'subscription' ? ' · 订阅' : ''}</div></div></div></td>
        <td className="hide-mobile">{t.categoryId ? names.categories.get(t.categoryId) ?? '已归档分类' : t.kind === 'transfer' ? '转账' : '未分类'}<div className="small muted">{t.accountId ? names.accounts.get(t.accountId) ?? '已归档账户' : t.transfer ? '两个账户' : ''}</div></td>
        <td className="hide-mobile small muted">{formatDate(t.localDate, today)}</td>
        <td><Link className="amount-link" href={hrefFor(t.id)} aria-label={`${label} ${KIND_LABELS[t.kind]} 详情`}><Amount t={t} /></Link><div className="small muted">{t.base.currency}</div></td>
      </tr>];
    })}
  </tbody></table></div>;
}
