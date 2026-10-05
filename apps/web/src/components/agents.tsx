'use client';
import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ApiError, api, intent } from '@/lib/client';
import { Checkbox } from '@/components/ui/checkbox';
import { Modal, ModalHeader } from '@/components/ui/modal';
import { Select } from '@/components/ui/select';
import type { ClientConfig } from '@ledger/mcp/clients';

const SCOPE_GROUPS: { title: string; scopes: [string, string][] }[] = [
  {
    title: '读取',
    scopes: [
      ['ledgers:read', '账本'],
      ['accounts:read', '账户'],
      ['categories:read', '分类与标签'],
      ['transactions:read', '交易'],
      ['reports:read', '报表'],
      ['fx:read', '汇率'],
      ['subscriptions:read', '订阅'],
      ['budgets:read', '预算'],
      ['reminders:read', '提醒与渠道'],
      ['notifications:read', '站内通知'],
      ['exports:read', '导出'],
    ],
  },
  {
    title: '写入',
    scopes: [
      ['transactions:write', '记账 / 更正 / 退款'],
      ['subscriptions:write', '订阅'],
      ['reminders:write', '提醒'],
      ['approvals:write', '发起审批'],
      ['accounts:write', '账户'],
      ['categories:write', '分类与标签'],
      ['budgets:write', '预算'],
      ['fx:write', '人工汇率'],
      ['notifications:write', '通知已读'],
    ],
  },
];
const READ_ONLY = [
  'ledgers:read',
  'accounts:read',
  'categories:read',
  'transactions:read',
  'reports:read',
  'fx:read',
  'subscriptions:read',
  'reminders:read',
];
const BOOKKEEPING = [...READ_ONLY, 'transactions:write', 'subscriptions:write', 'reminders:write', 'approvals:write'];
const LABEL = Object.fromEntries(SCOPE_GROUPS.flatMap(g => g.scopes));

/** Client picker: one configuration per Agent client, generated from the same source as the Skill packages. */
export function ClientPicker({ clients, endpoint }: { clients: ClientConfig[]; endpoint: string }) {
  const [current, setCurrent] = useState(clients[0].id);
  const client = clients.find(c => c.id === current)!;
  return (
    <section className="panel">
      <h2>选择客户端</h2>
      <p className="sub">
        MCP 地址 <code>{endpoint}</code> · Streamable HTTP，Bearer 令牌；本地也可用 stdio。
      </p>
      <div className="agentbuttons" role="group" aria-label="客户端">
        {clients.map(c => (
          <button
            key={c.id}
            aria-pressed={c.id === current}
            className={c.id === current ? 'selected' : ''}
            onClick={() => setCurrent(c.id)}
          >
            {c.name}
          </button>
        ))}
      </div>
      <p className="small muted">
        {client.transport === 'stdio' ? 'stdio 本地进程' : 'Streamable HTTP'} · 写入 {client.file}
      </p>
      <CopyBlock label={`${client.name} 配置`} text={client.content} />
      <ol className="small steps">
        {client.steps.map(s => (
          <li key={s}>{s}</li>
        ))}
      </ol>
      <p className="small muted">
        Skill：{client.skillDirs.join(' 或 ')}。配置只引用环境变量 LEDGER_API_TOKEN，不含真实令牌。
      </p>
    </section>
  );
}

function CopyBlock({ label, text }: { label: string; text: string }) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  }
  return (
    <div className="copy-block">
      <pre className="code" aria-label={label}>
        {text}
      </pre>
      <button type="button" onClick={() => void copy()}>
        {copied ? '已复制' : '复制'}
      </button>
    </div>
  );
}

type Token = {
  id: string;
  name: string;
  prefix: string;
  scopes: string[];
  ledgerIds: string[];
  expiresAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
  createdAt: string;
};
const day = (iso: string) => iso.slice(0, 10);
const tokenState = (t: Token) => (t.revokedAt ? '已撤销' : new Date(t.expiresAt) < new Date() ? '已过期' : '有效');

/** Personal access tokens: read-only by default, limited to chosen ledgers, shown exactly once, revoked immediately. */
export function TokenManager({
  ledgerId,
  email,
  ledgers,
  names,
  initial,
}: {
  ledgerId: string;
  email: string;
  ledgers: { id: string; name: string; role: string }[];
  names: Record<string, string>;
  initial: Token[];
}) {
  const router = useRouter();
  const [tokens, setTokens] = useState(initial);
  const [creating, setCreating] = useState(false);
  const [created, setCreated] = useState<(Token & { token: string }) | null>(null);
  const [revoking, setRevoking] = useState<Token | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  async function refresh() {
    setTokens(await api<Token[]>('/api/v1/api-tokens?limit=100'));
    router.refresh();
  }
  async function revoke(token: Token) {
    setBusy(true);
    setError('');
    try {
      await api(`/api/v1/api-tokens/${token.id}`, { method: 'DELETE' });
      setRevoking(null);
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : '撤销失败');
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="panel" aria-labelledby="tokens-title">
      <div className="row paneltop">
        <div>
          <h2 id="tokens-title">访问令牌</h2>
          <p className="sub">令牌代表你本人，权限不超过你在账本中的角色。</p>
        </div>
        <button
          className="primary"
          onClick={() => {
            setCreating(true);
            setCreated(null);
          }}
        >
          ＋ 签发令牌
        </button>
      </div>
      {created && (
        <div className="note note-warn token-once" role="status">
          <span className="dot" />
          <div>
            <strong>令牌只显示这一次</strong>：请立即复制到客户端的环境变量 LEDGER_API_TOKEN 中，关闭后无法再查看。
            <CopyBlock label="新令牌" text={created.token} />
            <button onClick={() => setCreated(null)}>我已保存，关闭</button>
          </div>
        </div>
      )}
      {creating && (
        <TokenForm
          ledgerId={ledgerId}
          email={email}
          ledgers={ledgers}
          onClose={() => setCreating(false)}
          onCreated={async token => {
            setCreating(false);
            setCreated(token);
            await refresh();
          }}
        />
      )}
      {tokens.length ? (
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>名称</th>
                <th>作用域</th>
                <th className="hide-mobile">账本</th>
                <th className="hide-mobile">期限 / 最近使用</th>
                <th>状态</th>
              </tr>
            </thead>
            <tbody>
              {tokens.map(t => (
                <tr key={t.id} aria-label={`令牌 ${t.name}`}>
                  <td>
                    <strong>{t.name}</strong>
                    <div className="small muted">
                      <code>{t.prefix}…</code>
                    </div>
                  </td>
                  <td className="small">
                    {t.scopes.some(s => s.endsWith(':write')) ? (
                      <span className="pill warn">可写</span>
                    ) : (
                      <span className="pill">只读</span>
                    )}{' '}
                    {t.scopes.map(s => LABEL[s] ?? s).join('、')}
                  </td>
                  <td className="small hide-mobile">
                    {t.ledgerIds.map(id => names[id] ?? '（无权访问的账本）').join('、')}
                  </td>
                  <td className="small hide-mobile">
                    {day(t.expiresAt)} 到期
                    <div className="muted">{t.lastUsedAt ? `最近使用 ${day(t.lastUsedAt)}` : '从未使用'}</div>
                  </td>
                  <td>
                    {tokenState(t)}
                    {tokenState(t) === '有效' && (
                      <div>
                        <button className="linkbtn" disabled={busy} onClick={() => setRevoking(t)}>
                          撤销
                        </button>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="muted">还没有令牌。签发后把它配置到 Agent 客户端。</p>
      )}
      {revoking && (
        <div className="note confirm-box" role="alertdialog" aria-label="确认撤销">
          <p>撤销「{revoking.name}」后，使用它的 Agent 下一次请求就会被拒绝。</p>
          <button onClick={() => setRevoking(null)}>取消</button>
          <button className="primary" disabled={busy} onClick={() => void revoke(revoking)}>
            确认撤销
          </button>
        </div>
      )}
      <p role="alert" className="error">
        {error}
      </p>
    </section>
  );
}

function TokenForm({
  ledgerId,
  email,
  ledgers,
  onClose,
  onCreated,
}: {
  ledgerId: string;
  email: string;
  ledgers: { id: string; name: string; role: string }[];
  onClose: () => void;
  onCreated: (token: Token & { token: string }) => Promise<void>;
}) {
  const [scopes, setScopes] = useState<string[]>(READ_ONLY);
  const [chosen, setChosen] = useState<string[]>([ledgerId]);
  const [reauth, setReauth] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [submission] = useState(intent);
  const toggle = (list: string[], value: string, on: boolean) =>
    on ? [...new Set([...list, value])] : list.filter(v => v !== value);
  async function submit(event: React.SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    const form = new FormData(event.currentTarget);
    if (!scopes.length) return setError('至少选择一个作用域');
    if (!chosen.length) return setError('至少选择一个账本');
    setBusy(true);
    try {
      if (reauth) {
        await api('/api/auth/sign-in/email', {
          method: 'POST',
          body: JSON.stringify({ email, password: form.get('password') }),
        });
      }
      const payload = JSON.stringify({
        name: String(form.get('name')).trim(),
        scopes,
        ledgerIds: chosen,
        expiresInDays: Number(form.get('expiresInDays')),
      });
      const token = await api<Token & { token: string }>('/api/v1/api-tokens', {
        method: 'POST',
        headers: { 'Idempotency-Key': submission.key(payload) },
        body: payload,
      });
      submission.done();
      await onCreated(token);
    } catch (e) {
      if (e instanceof ApiError && e.code === 'REAUTH_REQUIRED') {
        setReauth(true);
        setError('为安全起见，请输入登录密码确认后再签发。');
      } else setError(e instanceof Error ? e.message : '签发失败');
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal open onOpenChange={next => !next && onClose()} className="entry-dialog">
      <form onSubmit={submit}>
        <ModalHeader title="签发访问令牌" />
        <div className="dialogbody">
          <div className="formgrid">
            <div className="field">
              <label htmlFor="token-name">名称</label>
              <input id="token-name" name="name" required maxLength={60} placeholder="例如：Claude Code（笔记本）" />
            </div>
            <div className="field">
              <label htmlFor="token-expiry">有效期</label>
              <Select
                id="token-expiry"
                name="expiresInDays"
                defaultValue="30"
                options={[7, 30, 90, 365].map(d => ({ value: String(d), label: `${d} 天` }))}
              />
            </div>
          </div>
          <fieldset className="scope-set">
            <legend>可访问的账本</legend>
            {ledgers.map(l => (
              <Checkbox
                key={l.id}
                checked={chosen.includes(l.id)}
                onCheckedChange={on => setChosen(toggle(chosen, l.id, on))}
              >
                {l.name}
                <span className="small muted">
                  （{({ owner: '所有者', editor: '可编辑', viewer: '仅查看' } as Record<string, string>)[l.role]}）
                </span>
              </Checkbox>
            ))}
          </fieldset>
          <div className="gap">
            <span className="small muted">预设：</span>
            <button type="button" onClick={() => setScopes(READ_ONLY)}>
              只读（推荐）
            </button>
            <button type="button" onClick={() => setScopes(BOOKKEEPING)}>
              记账
            </button>
          </div>
          {SCOPE_GROUPS.map(g => (
            <fieldset key={g.title} className="scope-set">
              <legend>{g.title}</legend>
              {g.scopes.map(([id, name]) => (
                <Checkbox
                  key={id}
                  checked={scopes.includes(id)}
                  onCheckedChange={on => setScopes(toggle(scopes, id, on))}
                >
                  {name} <code className="small muted">{id}</code>
                </Checkbox>
              ))}
            </fieldset>
          ))}
          {scopes.some(s => s.endsWith(':write')) && (
            <p className="small warn-text">
              包含写入权限：Agent 可以在所选账本记账。单笔大额与作废等高影响操作仍需你在网页批准。
            </p>
          )}
          {reauth && (
            <div className="field">
              <label htmlFor="token-password">登录密码</label>
              <input id="token-password" name="password" type="password" autoComplete="current-password" required />
            </div>
          )}
          <p role="alert" className="error">
            {error}
          </p>
        </div>
        <div className="dialogfoot">
          <button type="button" onClick={onClose}>
            取消
          </button>
          <button className="primary" disabled={busy}>
            {busy ? '正在签发…' : '签发令牌'}
          </button>
        </div>
      </form>
    </Modal>
  );
}

type Approval = {
  id: string;
  status: string;
  operation: { method: string; path: string };
  summary: string;
  reason: string | null;
  requestedBy: { name: string; via: string };
  decidedAt: string | null;
  expiresAt: string;
  version: number;
  createdAt: string;
};
const APPROVAL_STATUS: Record<string, string> = {
  pending: '待批准',
  approved: '已批准，等待 Agent 使用',
  rejected: '已拒绝',
  expired: '已过期',
  consumed: '已执行',
};
const METHOD: Record<string, string> = { POST: '新建', PATCH: '修改', DELETE: '作废 / 删除' };

/** Approvals: only a signed-in owner decides, here; each approval covers one exact request and is used once. */
export function Approvals({
  ledgerId,
  timezone,
  highlight,
  initial,
}: {
  ledgerId: string;
  timezone: string;
  highlight: string | null;
  initial: Approval[];
}) {
  const router = useRouter();
  const [items, setItems] = useState(initial);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const focused = useRef<HTMLLIElement>(null);
  useEffect(() => {
    focused.current?.scrollIntoView({ block: 'center' });
    focused.current?.focus();
  }, []);
  const when = (iso: string) => new Date(iso).toLocaleString('zh-CN', { hour12: false, timeZone: timezone });
  async function decide(item: Approval, decision: 'approved' | 'rejected') {
    setBusy(item.id);
    setError('');
    try {
      const updated = await api<Approval>(`/api/v1/ledgers/${ledgerId}/approval-requests/${item.id}`, {
        method: 'PATCH',
        headers: { 'If-Match': `"v${item.version}"` },
        body: JSON.stringify({ decision }),
      });
      setItems(items.map(i => (i.id === item.id ? updated : i)));
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : '操作失败');
    } finally {
      setBusy(null);
    }
  }
  const pending = items.filter(i => i.status === 'pending').length;
  return (
    <section className="panel" aria-labelledby="approvals-title">
      <div className="row paneltop">
        <h2 id="approvals-title">待审批</h2>
        <span className={`pill${pending ? ' warn' : ''}`}>{pending} 项待处理</span>
      </div>
      <p className="sub">Agent 发起的高影响操作。批准只对列出的那一次请求有效，Agent 改动内容后不能复用。</p>
      {items.length ? (
        <ul className="plain-list approvals">
          {items.map(item => (
            <li
              key={item.id}
              ref={item.id === highlight ? focused : undefined}
              tabIndex={item.id === highlight ? -1 : undefined}
              className={item.id === highlight ? 'highlight' : ''}
              aria-label={`审批：${item.summary}`}
            >
              <div className="approval-text">
                <strong>{item.summary}</strong>
                {item.reason && <p className="small">{item.reason}</p>}
                <p className="small muted">
                  {METHOD[item.operation.method] ?? item.operation.method} ·{' '}
                  <code>{item.operation.path.replace(`/api/v1/ledgers/${ledgerId}`, '')}</code> ·{' '}
                  {item.requestedBy.name}
                  {item.requestedBy.via === 'token' ? ' 通过 Agent 令牌' : ''} · {when(item.createdAt)} 发起
                  {item.status === 'pending' ? ` · ${when(item.expiresAt)} 前有效` : ''}
                </p>
              </div>
              <div className="gap">
                {item.status === 'pending' ? (
                  <>
                    <button disabled={busy === item.id} onClick={() => void decide(item, 'rejected')}>
                      拒绝
                    </button>
                    <button
                      className="primary"
                      disabled={busy === item.id}
                      onClick={() => void decide(item, 'approved')}
                    >
                      批准
                    </button>
                  </>
                ) : (
                  <span className={`pill${item.status === 'rejected' || item.status === 'expired' ? ' warn' : ''}`}>
                    {APPROVAL_STATUS[item.status] ?? item.status}
                  </span>
                )}
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <p className="muted">没有审批请求。</p>
      )}
      <p role="alert" className="error">
        {error}
      </p>
    </section>
  );
}
