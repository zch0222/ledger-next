'use client';
import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import { useLedgerUI } from '../ledger-ui';

// Sidebar and mobile bottom bar from the v0.3 prototype. Links keep the display currency across pages.
export const NAVIGATION = [
  ['dashboard', '▦', '总览'],
  ['transactions', '≡', '账目'],
  ['subscriptions', '▣', '订阅'],
  ['analytics', '◴', '预算与分析'],
  ['accounts', '▤', '账户'],
  ['reminders', '♧', '提醒中心'],
  ['agents', '⌘', 'Agent 接入'],
  ['settings', '⚙', '设置'],
] as const;
function useSection(ledgerId: string) {
  const pathname = usePathname();
  const search = useSearchParams();
  const section = pathname.replace(`/ledgers/${ledgerId}`, '').split('/')[1] || 'dashboard';
  const currency = search.get('currency');
  return { section, href: (id: string) => `/ledgers/${ledgerId}/${id}${currency ? `?currency=${currency}` : ''}` };
}
export function SideNav({ ledgerId }: { ledgerId: string }) {
  const { section, href } = useSection(ledgerId);
  return (
    <nav className="nav" aria-label="主要导航">
      {NAVIGATION.map(([id, icon, name]) => (
        <Link
          key={id}
          className={section === id ? 'active' : ''}
          aria-current={section === id ? 'page' : undefined}
          href={href(id)}
        >
          <span aria-hidden="true">{icon}</span>
          {name}
        </Link>
      ))}
    </nav>
  );
}
export function MobileNav({ ledgerId, canWrite }: { ledgerId: string; canWrite: boolean }) {
  const { section, href } = useSection(ledgerId);
  const ui = useLedgerUI();
  const more = !['dashboard', 'transactions', 'subscriptions'].includes(section);
  return (
    <nav className="mobile-nav" aria-label="移动导航">
      {[
        ['dashboard', '▦', '总览'],
        ['transactions', '≡', '账目'],
      ].map(([id, icon, name]) => (
        <Link
          key={id}
          className={section === id ? 'active' : ''}
          aria-current={section === id ? 'page' : undefined}
          href={href(id)}
        >
          <span aria-hidden="true">{icon}</span>
          {name}
        </Link>
      ))}
      <button
        className="mobile-add"
        aria-label="记一笔"
        disabled={!canWrite}
        title={canWrite ? undefined : '仅查看成员不能记账'}
        onClick={() => ui.openEntry()}
      >
        <span aria-hidden="true">＋</span>
      </button>
      <Link
        className={section === 'subscriptions' ? 'active' : ''}
        aria-current={section === 'subscriptions' ? 'page' : undefined}
        href={href('subscriptions')}
      >
        <span aria-hidden="true">▣</span>订阅
      </Link>
      <Link className={more ? 'active' : ''} href={href('more')}>
        <span aria-hidden="true">⋯</span>更多
      </Link>
    </nav>
  );
}
