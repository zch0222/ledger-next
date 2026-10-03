import Link from 'next/link';
import { PageHeading } from '@/components/ui/page';
import { requireLedger, type LedgerPageProps } from '@/lib/session';

export const dynamic = 'force-dynamic';
/** Mobile "更多": everything the bottom bar has no room for (UI_SPEC §1). */
export default async function More({ params }: LedgerPageProps) {
  const { ledgerId } = await params;
  await requireLedger(ledgerId);
  const items = [
    ['analytics', '◴', '预算与分析'],
    ['accounts', '▤', '账户'],
    ['reminders', '♧', '提醒中心'],
    ['settings', '⚙', '账本设置'],
    ['settings/currencies', '¤', '币种与汇率'],
    ['settings/data', '⇅', '导入导出'],
    ['settings/channels', '✉', '提醒渠道'],
    ['settings/appearance', '◐', '外观'],
    ['agents', '⌘', 'Agent 接入'],
  ];
  return (
    <>
      <PageHeading title="更多" />
      <nav className="panel more-list" aria-label="更多页面">
        {items.map(([href, icon, name]) => (
          <Link key={href} href={`/ledgers/${ledgerId}/${href}`}>
            <span aria-hidden="true">{icon}</span>
            {name}
            <span aria-hidden="true">›</span>
          </Link>
        ))}
      </nav>
    </>
  );
}
