import { PageHeading, Note } from '../../../../components/ui/page';
import { requireLedger, type LedgerPageProps } from '../../../../lib/session';

export const dynamic = 'force-dynamic';
export default async function Agents({ params }: LedgerPageProps) {
  const { ledgerId } = await params;
  await requireLedger(ledgerId);
  return <><PageHeading title="把账本，交给熟悉的 Agent" description="统一 MCP 工具与 REST 服务，用同一套权限管理。" /><Note>访问令牌与 MCP 接入随 M6 提供。</Note></>;
}
