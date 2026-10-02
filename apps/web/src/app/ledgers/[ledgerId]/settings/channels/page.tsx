import { PageHeading, Note, SettingsTabs } from '../../../../../components/ui/page';
import { requireLedger, type LedgerPageProps } from '../../../../../lib/session';

export const dynamic = 'force-dynamic';
export default async function Channels({ params }: LedgerPageProps) {
  const { ledgerId } = await params;
  await requireLedger(ledgerId);
  return <><PageHeading title="提醒渠道" description="Telegram、飞书、企业微信、个人微信、邮件与 Webhook 分别配置。" /><SettingsTabs ledgerId={ledgerId} current="channels" /><Note>渠道配置随 M5 提供。</Note></>;
}
