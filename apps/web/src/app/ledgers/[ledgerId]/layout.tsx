import { Suspense } from 'react';
import { ENABLED_CURRENCIES } from '../../../../../../packages/contracts/src/common';
import { listAccounts } from '../../../../../../packages/domain/src/accounts';
import { listCategories } from '../../../../../../packages/domain/src/catalog';
import { formatAmount } from '../../../../../../packages/domain/src/money';
import { AccountMenu } from '../../../components/account-menu';
import { Appearance } from '../../../components/appearance';
import { LedgerSelect } from '../../../components/ledger-select';
import { LedgerProvider } from '../../../components/ledger-ui';
import { AddButton } from '../../../components/shell/add-button';
import { CurrencySelect } from '../../../components/shell/currency-select';
import { MobileNav, SideNav } from '../../../components/shell/nav';
import { currentAppearance } from '../../../lib/appearance';
import { unreadCount } from '../../../../../../packages/domain/src/deliveries';
import Link from 'next/link';
import { ledgersOf, requireLedger } from '../../../lib/session';

export const dynamic = 'force-dynamic';

/** Shell of every ledger page (prototype v0.3): 224px sidebar, 82px top bar, mobile bottom bar; SSR data only. */
export default async function LedgerLayout({ children, params }: { children: React.ReactNode; params: Promise<{ ledgerId: string }> }) {
  const { ledgerId } = await params;
  const { ctx, user, ledger } = await requireLedger(ledgerId);
  const [books, accounts, categories, appearance, unread] = await Promise.all([
    ledgersOf(), listAccounts(ctx, ledgerId, { includeArchived: false, limit: 500 }), listCategories(ctx, ledgerId, { includeArchived: false, limit: 500 }), currentAppearance(), unreadCount(ctx, ledgerId).catch(() => 0),
  ]);
  const info = { id: ledger.id, name: ledger.name, baseCurrency: ledger.baseCurrency, timezone: ledger.timezone, role: ledger.role };
  return <LedgerProvider ledger={info}
    accounts={accounts.map(a => ({ id: a.id, name: a.name, currency: a.currency, type: a.type, balance: formatAmount(a.balance, a.currency) }))}
    categories={categories.map(c => ({ id: c.id, name: c.name, kind: c.kind, parentId: c.parentId }))}>
    <div className="shell">
      <aside className="sidebar"><div className="brand"><span className="mark" aria-hidden="true">↗</span><div>Ledger<small>YOUR MONEY, CLEARLY.</small></div></div>
        <Suspense><SideNav ledgerId={ledgerId} /></Suspense>
        <div className="sidefoot"><strong>每一笔，都有去处。</strong>个人与家庭账本<br />让生活的收支清楚一点。</div></aside>
      <div className="main">
        <header className="topbar"><div className="book"><LedgerSelect ledgers={books} current={ledger.id} /><small>{({ owner: '所有者', editor: '可编辑', viewer: '仅查看' })[ledger.role]} · {ledger.timezone}</small></div>
          <div className="topactions"><Suspense><CurrencySelect base={ledger.baseCurrency} currencies={ENABLED_CURRENCIES} /></Suspense><Link className="inbox-link" href={`/ledgers/${ledgerId}/reminders?tab=inbox`} aria-label={unread ? `站内通知，${unread} 条未读` : '站内通知'} title="站内通知"><span aria-hidden="true">♧</span>{unread > 0 && <span className="badge" aria-hidden="true">{unread > 99 ? '99+' : unread}</span>}</Link><Appearance initial={appearance.value} version={appearance.version} pending={appearance.pending} userId={user.id} /><AddButton /><AccountMenu name={user.name} /></div></header>
        <main id="content">{children}</main>
      </div>
    </div>
    <Suspense><MobileNav ledgerId={ledgerId} canWrite={ledger.role !== 'viewer'} /></Suspense>
  </LedgerProvider>;
}
