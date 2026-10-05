import { listApprovals, listTokens, presentToken } from '@ledger/domain/agents';
import { listAuditEvents } from '@ledger/domain/identity';
import { clientConfigs, TOOL_TABLE } from '@ledger/mcp/clients';
import { Approvals, ClientPicker, TokenManager } from '@/components/agents';
import { Note, PageHeading } from '@/components/ui/page';
import { ledgersOf, param, requireLedger, type LedgerPageProps } from '@/lib/session';

export const dynamic = 'force-dynamic';
const AUDIT: Record<string, string> = {
  'api_token.created': '签发令牌',
  'api_token.revoked': '撤销令牌',
  'approval.approved': '批准 Agent 操作',
  'approval.rejected': '拒绝 Agent 操作',
};

/** P10 Agent 接入: client configuration, tools, personal access tokens (shown once), approvals and their audit trail. */
export default async function Agents({ params, searchParams }: LedgerPageProps) {
  const { ledgerId } = await params;
  const { ctx, user, ledger } = await requireLedger(ledgerId);
  const owner = ledger.role === 'owner';
  const [ledgers, tokens, approvals, audit] = await Promise.all([
    ledgersOf(),
    listTokens(ctx, { limit: 100 }),
    owner ? listApprovals(ctx, ledgerId, {}, { limit: 50 }) : Promise.resolve(null),
    owner ? listAuditEvents(ctx, ledgerId, { limit: 200 }) : Promise.resolve(null),
  ]);
  const origin = process.env.APP_URL ?? 'https://ledger.example';
  const names = Object.fromEntries(ledgers.map(l => [l.id, l.name]));
  const agentAudit = audit?.filter(e => e.action in AUDIT).slice(0, 20) ?? null;
  const when = (d: Date) => d.toLocaleString('zh-CN', { hour12: false, timeZone: ledger.timezone });
  return (
    <>
      <PageHeading title="Agent 接入" description="统一 MCP 工具与 REST 服务，用同一套权限管理。" />
      <Note>Agent 通过你签发的个人访问令牌访问账本：权限、账本范围、幂等与审批都由服务端执行，令牌只显示一次。</Note>
      <div className="grid">
        <ClientPicker clients={clientConfigs(origin)} endpoint={`${origin.replace(/\/$/, '')}/mcp`} />
        <section className="panel">
          <h2>权限从最小范围开始</h2>
          <div className="budget">
            <h3>默认只读</h3>
            <p className="small muted">账目、汇总、订阅、提醒与汇率查询。</p>
            <span className="pill">限定所选账本</span>
          </div>
          <div className="budget">
            <h3>按需写入</h3>
            <p className="small muted">先预览金额和账户，再提交同一意图；超时重试沿用同一幂等键，不会重复入账。</p>
          </div>
          <div className="budget">
            <h3>高影响操作需要你批准</h3>
            <p className="small muted">
              作废、撤销导入、成员变更，以及单笔达到 {process.env.AGENT_APPROVAL_AMOUNT || '10000'}{' '}
              {ledger.baseCurrency} 的写入，只能由所有者在本页批准；批准只对那一次请求有效。
            </p>
          </div>
          <div className="budget">
            <h3>随时撤销</h3>
            <p className="small muted">撤销在下一次请求立即生效。</p>
          </div>
        </section>
      </div>
      <TokenManager
        ledgerId={ledgerId}
        email={user.email}
        ledgers={ledgers.map(l => ({ id: l.id, name: l.name, role: l.role }))}
        names={names}
        initial={tokens.slice(0, 100).map(presentToken)}
      />
      {approvals ? (
        <Approvals
          ledgerId={ledgerId}
          timezone={ledger.timezone}
          highlight={param(await searchParams, 'approval') ?? null}
          initial={approvals.map(({ createdAtDate, ...a }) => {
            void createdAtDate;
            return a;
          })}
        />
      ) : (
        <section className="panel">
          <h2>待审批</h2>
          <p className="muted">审批由账本所有者处理。你发起的审批可以在 Agent 的结果中看到状态。</p>
        </section>
      )}
      <section className="panel">
        <h2>可用工具</h2>
        <p className="sub">MCP 工具都映射到公开 REST 接口；令牌缺少作用域时由服务端拒绝。</p>
        <div className="table-scroll" tabIndex={0} role="region" aria-label="可用工具列表">
          <table className="tool-table">
            <thead>
              <tr>
                <th>工具</th>
                <th>用途</th>
                <th>需要的作用域</th>
              </tr>
            </thead>
            <tbody>
              {TOOL_TABLE.map(t => (
                <tr key={t.name}>
                  <td>
                    <code>{t.name}</code>
                  </td>
                  <td>
                    {t.summary}
                    {t.writes && <span className="pill warn">写入</span>}
                  </td>
                  <td className="small">{t.scope}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="small muted">
          资源：ledger://{'{ledgerId}'}/context、ledger://{'{ledgerId}'}/categories。不提供任意 SQL、任意
          URL、密钥读取或支付类工具。
        </p>
      </section>
      {agentAudit && (
        <section className="panel">
          <h2>Agent 相关审计</h2>
          {agentAudit.length ? (
            <ul className="plain-list audit">
              {agentAudit.map(e => (
                <li key={e.id}>
                  <span>
                    {AUDIT[e.action]} · {e.actor.name}
                  </span>
                  <span className="small muted">{when(e.createdAt)}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="muted">还没有令牌或审批记录。</p>
          )}
        </section>
      )}
    </>
  );
}
