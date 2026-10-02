import { listChannels, presentChannel } from '../../../../../../../../packages/domain/src/notify-channels';
import { ChannelsPanel } from '../../../../../components/notify/channels';
import { Note, PageHeading, SettingsTabs } from '../../../../../components/ui/page';
import type { ChannelView } from '../../../../../lib/notify-labels';
import { requireLedger, type LedgerPageProps } from '../../../../../lib/session';

export const dynamic = 'force-dynamic';
/** P08 提醒渠道: personal channels (shared by all of my ledgers). Status follows real test deliveries. */
export default async function Channels({ params }: LedgerPageProps) {
  const { ledgerId } = await params;
  const { ctx } = await requireLedger(ledgerId);
  const channels = (await listChannels(ctx, { limit: 100 })).map(presentChannel) as ChannelView[];
  return <><PageHeading title="提醒渠道" description="Telegram、飞书、企业微信（群机器人 / 应用消息）、个人微信、邮件与 Webhook 分别配置；渠道属于你本人，所有账本共用。" /><SettingsTabs ledgerId={ledgerId} current="channels" />
    <Note>步骤：添加渠道 → 发送测试消息 → 在对应应用里确认确实收到（邮件填写验证码）→ 在提醒中心选择该渠道。平台受理只代表对方服务器接收了请求。</Note>
    <ChannelsPanel channels={channels} /></>;
}
