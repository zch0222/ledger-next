import { listExportJobs } from '../../../../../../../../packages/domain/src/exports';
import { listImportJobs } from '../../../../../../../../packages/domain/src/imports';
import { ExportPanel, ImportWizard } from '../../../../../components/settings/data';
import { PageHeading, SettingsTabs } from '../../../../../components/ui/page';
import { param, requireLedger, type LedgerPageProps } from '../../../../../lib/session';

export const dynamic = 'force-dynamic';
const strip = <T extends { position: unknown }>({ position, ...rest }: T) => {
  void position;
  return rest;
};

/** P11 数据: CSV import wizard with row-level errors and reversible batches; short-lived personal exports. */
export default async function DataPage({ params, searchParams }: LedgerPageProps) {
  const { ledgerId } = await params;
  const search = await searchParams;
  const { ctx, ledger } = await requireLedger(ledgerId);
  const [imports, exports] = await Promise.all([
    ledger.role === 'viewer' ? Promise.resolve([]) : listImportJobs(ctx, ledgerId, { limit: 10 }),
    listExportJobs(ctx, ledgerId, { limit: 10 }),
  ]);
  const defaults = Object.fromEntries(
    ['dateFrom', 'dateTo', 'accountId'].map(k => [k, param(search, k)]).filter(([, v]) => v),
  ) as Record<string, string>;
  return (
    <>
      <PageHeading title="导入与导出" description="CSV 先预览校验再入账；导出文件 1 小时内有效，仅你本人可下载。" />
      <SettingsTabs ledgerId={ledgerId} current="data" />
      <ImportWizard jobs={imports.map(strip)} />
      <ExportPanel jobs={exports.map(strip)} defaults={defaults} />
    </>
  );
}
