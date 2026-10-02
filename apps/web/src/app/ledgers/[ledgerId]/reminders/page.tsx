import { PageHeading, Note } from '../../../../components/ui/page';
import { requireLedger, type LedgerPageProps } from '../../../../lib/session';

export const dynamic = 'force-dynamic';
export default async function Reminders({ params }: LedgerPageProps) {
  const { ledgerId } = await params;
  await requireLedger(ledgerId);
  return <><PageHeading title="重要的事，提前知道" description="每个渠道独立配置，投递结果清楚可查。" /><Note>提醒规则与投递记录随 M5 提供。</Note></>;
}
