import Link from 'next/link';
import { Suspense } from 'react';
import { TransactionQuery } from '../../../../../../../packages/contracts/src/finance';
import { listAccounts } from '../../../../../../../packages/domain/src/accounts';
import { listCategories } from '../../../../../../../packages/domain/src/catalog';
import { cursorCodec } from '../../../../../../../packages/domain/src/cursor';
import { getTransaction, listTransactions, refundsOf } from '../../../../../../../packages/domain/src/transactions';
import { AddButton } from '../../../../components/shell/add-button';
import { TransactionDrawer } from '../../../../components/transactions/detail-drawer';
import { TransactionFilters } from '../../../../components/transactions/filters';
import { TransactionTable } from '../../../../components/transactions/table';
import { EmptyState, Note, PageHeading, PanelError, attempt } from '../../../../components/ui/page';
import { withParams } from '../../../../lib/period';
import { param, requireLedger, type LedgerPageProps } from '../../../../lib/session';
import { today as todayIn } from '../../../../lib/time';
import type { TransactionView } from '../../../../lib/types';

export const dynamic = 'force-dynamic';
const FILTERS = ['q', 'kind', 'categoryId', 'accountId', 'dateFrom', 'dateTo', 'status', 'sort'] as const;

/** P02 账目: URL filters, 50 per page with signed keyset cursors, date-grouped rows, detail drawer via ?tx=. */
export default async function Transactions({ params, searchParams }: LedgerPageProps) {
  const { ledgerId } = await params, search = await searchParams;
  const { ctx, ledger } = await requireLedger(ledgerId);
  const today = todayIn(ledger.timezone);
  const raw = Object.fromEntries(FILTERS.map(k => [k, param(search, k)]).filter(([, v]) => v));
  const parsed = TransactionQuery.safeParse({ ...raw, limit: 50 });
  const filters = parsed.success ? parsed.data : TransactionQuery.parse({ limit: 50 });
  const codec = cursorCodec(process.env.BETTER_AUTH_SECRET!), scope = JSON.stringify([ctx.userId, 'web:transactions', ledgerId, raw]);
  let after: [string, string] | undefined;
  const cursor = param(search, 'cursor');
  if (cursor) { try { after = codec.decode(scope, cursor) as [string, string]; } catch { after = undefined; } }
  const [accounts, categories, page, detail] = await Promise.all([
    listAccounts(ctx, ledgerId, { includeArchived: true, limit: 500 }), listCategories(ctx, ledgerId, { includeArchived: true, limit: 500 }),
    attempt(async () => {
      const result = await listTransactions(ctx, ledgerId, { ...filters, after });
      const rows = result.rows.slice(0, 50);
      return { rows: (await result.present(rows.map(r => r.id))) as TransactionView[], next: result.rows.length > 50 ? codec.encode(scope, result.position(rows[rows.length - 1])) : null };
    }),
    // A bad or foreign ?tx= is shown as a local message, never as a page-level 404.
    param(search, 'tx') ? (async () => { try { return { ok: true as const, value: { transaction: await getTransaction(ctx, ledgerId, param(search, 'tx')!) as TransactionView, ...(await refundsOf(ctx, ledgerId, param(search, 'tx')!)) } }; } catch (error) { return { ok: false as const, error }; } })() : null,
  ]);
  const names = { accounts: new Map(accounts.map(a => [a.id, a.name])), categories: new Map(categories.map(c => [c.id, c.name])) };
  const path = `/ledgers/${ledgerId}/transactions`, keep = { ...raw, currency: param(search, 'currency') };
  const hasFilters = Object.keys(raw).length > 0;
  return <>
    <PageHeading title="每一笔，都清清楚楚" description="点击金额查看入账详情、更正、退款或作废；作废与更正都会保留历史。" action={<AddButton className="primary" />} />
    <section className="panel">
      <Suspense><TransactionFilters categories={categories.filter(c => !c.archivedAt).map(c => ({ id: c.id, name: c.parentId ? `${names.categories.get(c.parentId) ?? ''} / ${c.name}` : c.name }))} accounts={accounts.map(a => ({ id: a.id, name: a.name }))} /></Suspense>
      {!parsed.success && <Note tone="warn">部分筛选条件无效，已忽略。</Note>}
      {page.ok ? page.value.rows.length ? <TransactionTable rows={page.value.rows} names={names} today={today} grouped hrefFor={id => withParams(path, { ...keep, cursor, tx: id })} />
        : hasFilters ? <EmptyState action={<Link href={path}>清空筛选</Link>}>当前条件下没有账目。</EmptyState>
          : <EmptyState symbol="≡" action={accounts.length ? <AddButton label="记第一笔" className="primary" /> : <Link className="button primary" href={`/ledgers/${ledgerId}/accounts?new=first`}>新建账户</Link>}>还没有账目。记下第一笔，之后都会出现在这里。</EmptyState>
        : <PanelError error={page.error} />}
      <div className="row small muted list-foot"><span>本页 {page.ok ? page.value.rows.length : 0} 笔 · 金额为历史入账的 {ledger.baseCurrency}</span>
        <span className="gap">{cursor && <Link href={withParams(path, keep)}>回到第一页</Link>}{page.ok && page.value.next && <Link href={withParams(path, { ...keep, cursor: page.value.next })}>下一页 →</Link>}<Link href={withParams(`/ledgers/${ledgerId}/settings/data`, { export: '1', dateFrom: raw.dateFrom, dateTo: raw.dateTo, accountId: raw.accountId, categoryId: raw.categoryId })}>导出 CSV</Link></span></div>
    </section>
    {detail && (detail.ok ? <Suspense><TransactionDrawer key={detail.value.transaction.id + detail.value.transaction.version} transaction={detail.value.transaction} refunds={detail.value.refunds as TransactionView[]} remaining={detail.value.remaining} names={{ accounts: Object.fromEntries(names.accounts), categories: Object.fromEntries(names.categories) }} /></Suspense> : <PanelError error={detail.error} title="这笔账目不存在或你没有访问权限" />)}
  </>;
}
