import { Appearance } from '../../../../../components/appearance';
import { PageHeading, SettingsTabs } from '../../../../../components/ui/page';
import { currentAppearance } from '../../../../../lib/appearance';
import { requireLedger, type LedgerPageProps } from '../../../../../lib/session';

export const dynamic = 'force-dynamic';

/** P13 外观: personal display preference (viewers may change it too); same component as the top-bar popover. */
export default async function AppearancePage({ params }: LedgerPageProps) {
  const { ledgerId } = await params;
  await requireLedger(ledgerId);
  const appearance = await currentAppearance();
  return <><PageHeading title="外观" description="浅色 / 深色 / 跟随系统与主题色；只改变显示方式，不影响任何账目数据。" /><SettingsTabs ledgerId={ledgerId} current="appearance" />
    <Appearance initial={appearance.value} version={appearance.version} signedIn inline /></>;
}
