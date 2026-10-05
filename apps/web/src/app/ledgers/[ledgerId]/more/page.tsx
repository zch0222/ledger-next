import Link from 'next/link';
import { SignOutButton } from '@/components/account-menu';
import { Icon, type IconName } from '@/components/ui/icons';
import { PageHeading } from '@/components/ui/page';
import { requireLedger, type LedgerPageProps } from '@/lib/session';

export const dynamic = 'force-dynamic';
/** Mobile "更多": everything the bottom bar has no room for (UI_SPEC §1), plus the account the top bar hides. */
export default async function More({ params }: LedgerPageProps) {
  const { ledgerId } = await params;
  const { user } = await requireLedger(ledgerId);
  const items: [string, IconName, string][] = [
    ['analytics', 'analytics', '预算与分析'],
    ['accounts', 'accounts', '账户'],
    ['reminders', 'bell', '提醒中心'],
    ['settings', 'settings', '账本设置'],
    ['settings/currencies', 'coins', '币种与汇率'],
    ['settings/data', 'importExport', '导入导出'],
    ['settings/channels', 'send', '提醒渠道'],
    ['settings/appearance', 'contrast', '外观'],
    ['agents', 'agents', 'Agent 接入'],
  ];
  return (
    <>
      <PageHeading title="更多" />
      <nav className="panel more-list" aria-label="更多页面">
        {items.map(([href, icon, name]) => (
          <Link key={href} href={`/ledgers/${ledgerId}/${href}`}>
            <Icon name={icon} />
            {name}
            <Icon name="chevronRight" size={18} />
          </Link>
        ))}
      </nav>
      <section className="panel account-settings">
        <div>
          <h2>{user.name}</h2>
          <p className="muted">{user.email}</p>
        </div>
        <SignOutButton />
      </section>
    </>
  );
}
