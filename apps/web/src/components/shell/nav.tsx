'use client';
import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import { useLedgerUI } from '@/components/ledger-ui';
import { Icon, type IconName } from '@/components/ui/icons';

// Sidebar and mobile bottom bar from the v0.3 prototype. Links keep the display currency across pages.
export const NAVIGATION: readonly (readonly [string, IconName, string])[] = [
  ['dashboard', 'dashboard', '总览'],
  ['transactions', 'transactions', '账目'],
  ['subscriptions', 'subscriptions', '订阅'],
  ['analytics', 'analytics', '预算与分析'],
  ['accounts', 'accounts', '账户'],
  ['reminders', 'bell', '提醒中心'],
  ['agents', 'agents', 'Agent 接入'],
  ['settings', 'settings', '设置'],
];
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
          <Icon name={icon} />
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
  // "更多" is highlighted for the sections it lists, but only a real section link is the current page.
  const tab = (id: string, icon: IconName, name: string) => (
    <Link
      key={id}
      className={section === id || (id === 'more' && more) ? 'active' : ''}
      aria-current={section === id ? 'page' : undefined}
      href={href(id)}
    >
      <Icon name={icon} size={22} />
      {name}
    </Link>
  );
  return (
    <nav className="mobile-nav" aria-label="移动导航">
      {tab('dashboard', 'dashboard', '总览')}
      {tab('transactions', 'transactions', '账目')}
      <button
        className="mobile-add"
        aria-label="记一笔"
        disabled={!canWrite}
        title={canWrite ? undefined : '仅查看成员不能记账'}
        onClick={() => ui.openEntry()}
      >
        <span>
          <Icon name="plus" size={22} />
        </span>
      </button>
      {tab('subscriptions', 'subscriptions', '订阅')}
      {tab('more', 'more', '更多')}
    </nav>
  );
}
