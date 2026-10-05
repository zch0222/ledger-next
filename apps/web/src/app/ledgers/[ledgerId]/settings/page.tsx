import { listCategories, listTags } from '@ledger/domain/catalog';
import { listAuditEvents, listMembers } from '@ledger/domain/identity';
import { SignOutButton } from '@/components/account-menu';
import { Members } from '@/components/members';
import { CatalogManager, LedgerName } from '@/components/settings/catalog';
import { PageHeading, SettingsTabs } from '@/components/ui/page';
import { auditLabel } from '@/lib/audit-labels';
import { requireLedger, type LedgerPageProps } from '@/lib/session';

export const dynamic = 'force-dynamic';

/** P12 账本设置: name, base currency / timezone (fixed), members, categories, tags and the owner's audit trail. */
export default async function Settings({ params }: LedgerPageProps) {
  const { ledgerId } = await params;
  const { ctx, user, ledger } = await requireLedger(ledgerId);
  const owner = ledger.role === 'owner';
  const [categories, tags, members, audit] = await Promise.all([
    listCategories(ctx, ledgerId, { includeArchived: true, limit: 500 }),
    listTags(ctx, ledgerId, { includeArchived: true, limit: 500 }),
    owner ? listMembers(ctx, ledgerId) : Promise.resolve(null),
    owner ? listAuditEvents(ctx, ledgerId, { limit: 20 }) : Promise.resolve(null),
  ]);
  const iso = (d: Date | null) => d?.toISOString() ?? null;
  return (
    <>
      <PageHeading
        kicker="设置"
        title="账本设置"
        description={`当前账本：${ledger.name}`}
        action={<span className="pill">{{ owner: '所有者', editor: '可编辑', viewer: '仅查看' }[ledger.role]}</span>}
      />
      <SettingsTabs ledgerId={ledgerId} current="" />
      <section className="panel">
        <h2>账本信息</h2>
        <dl className="detail-list">
          <div>
            <dt>名称</dt>
            <dd>{owner ? <LedgerName name={ledger.name} version={ledger.version} /> : ledger.name}</dd>
          </div>
          <div>
            <dt>基准币种</dt>
            <dd>{ledger.baseCurrency} · 历史收支以此入账，首笔入账后固定；展示币种可在顶栏切换</dd>
          </div>
          <div>
            <dt>时区</dt>
            <dd>{ledger.timezone} · 日期与月度统计按此计算</dd>
          </div>
        </dl>
        {!owner && <p className="muted small">成员与审计仅对所有者开放。</p>}
      </section>
      {members && (
        <Members
          key={ledgerId}
          ledgerId={ledgerId}
          initial={members.map(m => ({ id: m.id, name: m.name, email: m.email, role: m.role, version: m.version }))}
        />
      )}
      <CatalogManager
        categories={categories.map(c => ({
          id: c.id,
          name: c.name,
          kind: c.kind,
          parentId: c.parentId,
          archivedAt: iso(c.archivedAt),
          version: c.version,
        }))}
        tags={tags.map(t => ({ id: t.id, name: t.name, archivedAt: iso(t.archivedAt), version: t.version }))}
      />
      {audit && (
        <section className="panel">
          <h2>最近操作</h2>
          <ul className="plain-list audit">
            {audit.slice(0, 20).map(e => (
              <li key={e.id}>
                <span>
                  {auditLabel(e.action)} · {e.actor.name}
                </span>
                <span className="small muted">
                  {e.createdAt.toLocaleString('zh-CN', { hour12: false, timeZone: ledger.timezone })}
                </span>
              </li>
            ))}
          </ul>
          <p className="small muted">审计只记录操作者与动作，不含金额备注与凭据。</p>
        </section>
      )}
      <section className="panel account-settings">
        <div>
          <h2>我的账号</h2>
          <p className="muted">{user.email}</p>
        </div>
        <SignOutButton />
      </section>
    </>
  );
}
