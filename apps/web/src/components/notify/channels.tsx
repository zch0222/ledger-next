'use client';
import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ApiError, api, intent, randomKey } from '@/lib/client';
import {
  CHANNEL_STATUS,
  CHANNEL_TYPES,
  DELIVERY_STATUS,
  type ChannelTypeId,
  type ChannelView,
} from '@/lib/notify-labels';

type Field = {
  key: string;
  label: string;
  secret?: boolean;
  placeholder?: string;
  optional?: boolean;
  type?: 'checkbox' | 'email' | 'url';
};
// Credentials the user enters for each provider. Secret fields are never shown again after saving.
const FIELDS: Record<Exclude<ChannelTypeId, 'in_app'>, Field[]> = {
  telegram: [
    { key: 'botToken', label: 'Bot token', secret: true, placeholder: '123456789:AA…' },
    { key: 'chatId', label: 'chat_id', placeholder: '个人 ID、群 ID（-100…）或 @频道名' },
  ],
  feishu: [
    {
      key: 'webhookUrl',
      label: 'Webhook 地址',
      type: 'url',
      placeholder: 'https://open.feishu.cn/open-apis/bot/v2/hook/…',
    },
    { key: 'signingSecret', label: '签名密钥（启用签名校验时填写）', secret: true, optional: true },
  ],
  wecom_bot: [
    {
      key: 'webhookUrl',
      label: 'Webhook 地址',
      type: 'url',
      placeholder: 'https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=…',
    },
  ],
  wecom_app: [
    { key: 'corpId', label: 'CorpID' },
    { key: 'agentId', label: 'AgentId' },
    { key: 'secret', label: '应用 Secret', secret: true },
    { key: 'toUser', label: '接收成员（UserID，多个用 | 分隔）', placeholder: 'zhangsan|lisi' },
  ],
  pushplus_wechat: [
    { key: 'token', label: 'pushplus 消息 token', secret: true },
    { key: 'includeDetails', label: '消息包含金额与备注（经第三方转发）', type: 'checkbox', optional: true },
  ],
  email: [{ key: 'address', label: '收件地址', type: 'email' }],
  webhook: [
    { key: 'url', label: 'HTTPS 地址', type: 'url', placeholder: 'https://example.com/hooks/ledger' },
    { key: 'secret', label: 'HMAC 签名密钥（推荐）', secret: true, optional: true },
  ],
};
const wait = (ms: number) => new Promise(r => setTimeout(r, ms));
const statusTone = (status: string) => (status === 'active' ? '' : ' warn');

/** P08: one card per channel type; each configured channel can be tested, verified, edited, paused or deleted. */
export function ChannelsPanel({ channels }: { channels: ChannelView[] }) {
  const [adding, setAdding] = useState<Exclude<ChannelTypeId, 'in_app'> | null>(null);
  const types = Object.keys(CHANNEL_TYPES) as ChannelTypeId[];
  return (
    <>
      <div className="channel-cards">
        {types.map(type => {
          const meta = CHANNEL_TYPES[type];
          const mine = channels.filter(c => c.type === type);
          return (
            <section className="panel channel-card" key={type} aria-labelledby={`type-${type}`}>
              <div className="channel">
                <span className="channel-icon" aria-hidden="true">
                  {meta.icon}
                </span>
                <div className="channel-text">
                  <h2 id={`type-${type}`}>{meta.name}</h2>
                  <p>{meta.desc}</p>
                </div>
                {type !== 'in_app' && (
                  <button onClick={() => setAdding(type)} aria-label={`添加${meta.name}渠道`}>
                    ＋ 添加
                  </button>
                )}
              </div>
              {mine.length ? (
                mine.map(c => <ChannelRow key={c.id} channel={c} />)
              ) : (
                <p className="small muted">未配置</p>
              )}
            </section>
          );
        })}
      </div>
      {adding && <ChannelForm type={adding} onClose={() => setAdding(null)} />}
    </>
  );
}

function ChannelRow({ channel: c }: { channel: ChannelView }) {
  const router = useRouter();
  const [test, setTest] = useState<{ state: string; text: string } | null>(null);
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const base = `/api/v1/notification-channels/${c.id}`;
  async function runTest() {
    setBusy(true);
    setError('');
    setTest({ state: 'queued', text: '已排队，正在发送测试消息…' });
    try {
      const created = await api<{ id: string }>(`${base}/test-deliveries`, {
        method: 'POST',
        headers: { 'Idempotency-Key': randomKey() },
        body: JSON.stringify({}),
      });
      for (let i = 0; i < 40; i++) {
        const d = await api<{ status: string; lastError: string | null; reason: string | null }>(
          `${base}/test-deliveries/${created.id}`,
        );
        if (!['queued', 'sending'].includes(d.status)) {
          const where = CHANNEL_TYPES[c.type].name;
          setTest({
            state: d.status,
            text:
              d.status === 'accepted'
                ? c.type === 'email'
                  ? '邮件服务器已受理。请查收邮件，并在下方填写邮件里的 6 位验证码。'
                  : `平台已受理。请到 ${where} 确认确实收到（受理不代表已读）。`
                : d.status === 'delivered'
                  ? '接收端已返回 2xx。'
                  : d.status === 'delivery_unknown'
                    ? `结果未知：${d.reason ?? '请求已发出但没有应答'}`
                    : `${DELIVERY_STATUS[d.status] ?? d.status}：${d.lastError ?? d.reason ?? '原因未知'}`,
          });
          router.refresh();
          return;
        }
        await wait(i < 10 ? 500 : 1500);
      }
      setTest({ state: 'queued', text: '仍在排队：Worker 可能未运行，请稍后在提醒中心查看结果。' });
    } catch (e) {
      setError(e instanceof Error ? e.message : '测试失败');
      setTest(null);
    } finally {
      setBusy(false);
    }
  }
  async function verify() {
    setBusy(true);
    setError('');
    try {
      await api(`${base}/verifications`, { method: 'POST', body: JSON.stringify({ code }) });
      setTest({ state: 'verified', text: '验证成功，邮件渠道已启用。' });
      setCode('');
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : '验证失败');
    } finally {
      setBusy(false);
    }
  }
  async function patch(body: Record<string, unknown>) {
    setBusy(true);
    setError('');
    try {
      await api(base, { method: 'PATCH', headers: { 'If-Match': `"v${c.version}"` }, body: JSON.stringify(body) });
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : '保存失败');
    } finally {
      setBusy(false);
    }
  }
  async function remove() {
    setBusy(true);
    setError('');
    try {
      await api(base, { method: 'DELETE', headers: { 'If-Match': `"v${c.version}"` } });
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : '删除失败');
      setBusy(false);
    }
  }
  const summary = Object.entries(c.configSummary);
  return (
    <div className="channel-row" role="group" aria-label={`${c.name} 渠道`}>
      <div className="row">
        <strong>{c.name}</strong>
        <span className={`pill${statusTone(c.status)}`}>
          {c.enabled ? (CHANNEL_STATUS[c.status] ?? c.status) : '已停用'}
        </span>
      </div>
      {summary.length > 0 && (
        <p className="small muted channel-summary">{summary.map(([k, v]) => `${k}: ${v}`).join(' · ')}</p>
      )}
      <p className="small muted">
        {c.lastVerifiedAt
          ? `最近验证 ${new Date(c.lastVerifiedAt).toLocaleString('zh-CN', { hour12: false })}`
          : '尚未验证：发送测试消息并确认收到后启用'}
      </p>
      {c.lastError && (
        <p className="small warn-text" role="status">
          最近失败：{c.lastError}
        </p>
      )}
      {test && (
        <p className={`small${['failed', 'delivery_unknown'].includes(test.state) ? ' warn-text' : ''}`} role="status">
          {test.text}
        </p>
      )}
      {c.type === 'email' && c.status === 'verifying' && (
        <form
          className="gap"
          onSubmit={e => {
            e.preventDefault();
            void verify();
          }}
        >
          <label className="visually-hidden" htmlFor={`code-${c.id}`}>
            邮件验证码
          </label>
          <input
            id={`code-${c.id}`}
            className="num"
            inputMode="numeric"
            maxLength={6}
            placeholder="6 位验证码"
            value={code}
            onChange={e => setCode(e.target.value.replace(/\D/g, ''))}
          />
          <button className="primary" disabled={busy || code.length !== 6}>
            确认收件
          </button>
        </form>
      )}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {c.type !== 'in_app' && (
        <div className="gap channel-actions">
          <button onClick={() => void runTest()} disabled={busy || !c.enabled || c.status === 'disabled'}>
            {busy && test?.state === 'queued' ? '正在测试…' : '发送测试消息'}
          </button>
          <button onClick={() => setEditing(true)}>修改配置</button>
          {c.enabled ? (
            <button onClick={() => void patch({ enabled: false })} disabled={busy}>
              停用
            </button>
          ) : (
            <button onClick={() => void patch({ enabled: true })} disabled={busy}>
              启用
            </button>
          )}
          {confirmDelete ? (
            <span className="gap">
              <span className="small">删除后凭据立即清除，未发送的提醒取消。</span>
              <button onClick={() => setConfirmDelete(false)}>取消</button>
              <button className="danger" onClick={() => void remove()} disabled={busy}>
                确认删除
              </button>
            </span>
          ) : (
            <button className="danger-outline" onClick={() => setConfirmDelete(true)}>
              删除
            </button>
          )}
        </div>
      )}
      {editing && (
        <ChannelForm type={c.type as Exclude<ChannelTypeId, 'in_app'>} channel={c} onClose={() => setEditing(false)} />
      )}
    </div>
  );
}

/** Add or edit a channel. Saved secrets are never displayed; editing credentials means entering them again. */
function ChannelForm({
  type,
  channel,
  onClose,
}: {
  type: Exclude<ChannelTypeId, 'in_app'>;
  channel?: ChannelView;
  onClose: () => void;
}) {
  const router = useRouter();
  const dialog = useRef<HTMLDialogElement>(null);
  const [submission] = useState(intent);
  const [error, setError] = useState<ApiError | null>(null);
  const [busy, setBusy] = useState(false);
  const [replace, setReplace] = useState(!channel);
  useEffect(() => {
    dialog.current?.showModal();
  }, []);
  const meta = CHANNEL_TYPES[type];
  const fields = FIELDS[type];
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    const form = new FormData(event.currentTarget);
    const config: Record<string, unknown> = { type };
    for (const f of fields) {
      if (f.type === 'checkbox') {
        config[f.key] = form.get(f.key) === 'on';
        continue;
      }
      const value = String(form.get(f.key) ?? '').trim();
      if (value) config[f.key] = value;
    }
    const name = String(form.get('name') ?? '').trim() || meta.name;
    try {
      if (channel) {
        await api(`/api/v1/notification-channels/${channel.id}`, {
          method: 'PATCH',
          headers: { 'If-Match': `"v${channel.version}"` },
          body: JSON.stringify({ name, ...(replace ? { config } : {}) }),
        });
      } else {
        const payload = JSON.stringify({ name, config });
        await api('/api/v1/notification-channels', {
          method: 'POST',
          headers: { 'Idempotency-Key': submission.key(payload) },
          body: payload,
        });
        submission.done();
      }
      dialog.current?.close();
      onClose();
      router.refresh();
    } catch (e) {
      setError(e instanceof ApiError ? e : new ApiError('保存失败', 0, undefined));
    } finally {
      setBusy(false);
    }
  }
  const fieldError = (key: string) => error?.errors.find(e => e.path === `config.${key}`)?.message;
  return (
    <dialog
      ref={dialog}
      aria-labelledby="channel-form-title"
      onClose={onClose}
      onCancel={e => {
        e.preventDefault();
        dialog.current?.close();
        onClose();
      }}
    >
      <form onSubmit={submit}>
        <div className="dialoghead">
          <h2 id="channel-form-title">{channel ? `修改 ${channel.name}` : `添加${meta.name}`}</h2>
          <button
            type="button"
            aria-label="关闭"
            onClick={() => {
              dialog.current?.close();
              onClose();
            }}
          >
            ✕
          </button>
        </div>
        <div className="dialogbody">
          <p className="sub">{meta.desc}</p>
          <div className="field">
            <label htmlFor="channel-name">名称</label>
            <input id="channel-name" name="name" maxLength={60} defaultValue={channel?.name ?? meta.name} />
          </div>
          {channel && (
            <label className="small check-row">
              <input type="checkbox" checked={replace} onChange={e => setReplace(e.target.checked)} />{' '}
              重新填写凭据（保存后需重新测试）
            </label>
          )}
          {replace &&
            fields.map(f =>
              f.type === 'checkbox' ? (
                <label key={f.key} className="small check-row">
                  <input type="checkbox" name={f.key} /> {f.label}
                </label>
              ) : (
                <div className="field" key={f.key}>
                  <label htmlFor={`channel-${f.key}`}>{f.label}</label>
                  <input
                    id={`channel-${f.key}`}
                    name={f.key}
                    type={f.secret ? 'password' : (f.type ?? 'text')}
                    autoComplete="off"
                    required={!f.optional}
                    placeholder={f.placeholder}
                    aria-describedby={`channel-${f.key}-error`}
                  />
                  <div className="error" id={`channel-${f.key}-error`}>
                    {fieldError(f.key)}
                  </div>
                </div>
              ),
            )}
          <p className="small muted">凭据加密保存，之后只显示末尾 4 位。保存后请发送测试消息，并确认确实收到。</p>
          {error && !error.errors.length && (
            <p className="error" role="alert">
              {error.message}
            </p>
          )}
        </div>
        <div className="dialogfoot">
          <button
            type="button"
            onClick={() => {
              dialog.current?.close();
              onClose();
            }}
          >
            取消
          </button>
          <button className="primary" disabled={busy}>
            {busy ? '正在保存…' : '保存'}
          </button>
        </div>
      </form>
    </dialog>
  );
}
