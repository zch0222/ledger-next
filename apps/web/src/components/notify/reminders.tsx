'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ApiError, api, intent } from '@/lib/client';
import { CHANNEL_STATUS, CHANNEL_TYPES, DATED_EVENTS, EVENT_LABELS, type ChannelView } from '@/lib/notify-labels';
import { useLedgerUI } from '@/components/ledger-ui';

type Option = { id: string; name: string };
export type RuleView = {
  id: string;
  eventType: string;
  subscriptionId: string | null;
  budgetId: string | null;
  leadDays: number[];
  localTime: string;
  timezone: string;
  quietHours: { start: string; end: string } | null;
  channelIds: string[];
  enabled: boolean;
  version: number;
  fx: { base: string; quote: string; above: string | null; below: string | null } | null;
  nextFireTimes: string[];
};
type Preview = {
  previewId: string;
  nextFireTimes: { scheduledAt: string; localDate: string; localTime: string; deferredByQuietHours: boolean }[];
  warnings: { code: string; message: string }[];
};
const EVENTS = [
  'bill_due',
  'overdue',
  'trial_end',
  'cancel_deadline',
  'budget_threshold',
  'daily_entry',
  'weekly_summary',
  'monthly_summary',
  'fx_threshold',
  'delivery_failed',
];
const LEADS = [7, 3, 1, 0];
const CURRENCIES = ['USD', 'CNY', 'HKD', 'EUR', 'JPY'];

/** New / edit reminder: event, subject, lead days, local time, quiet hours, channels; the server previews the next three times. */
export function RuleForm({
  rule,
  channels,
  subscriptions,
  budgets,
  onClose,
}: {
  rule?: RuleView;
  channels: ChannelView[];
  subscriptions: Option[];
  budgets: Option[];
  onClose: () => void;
}) {
  const ui = useLedgerUI();
  const router = useRouter();
  const dialog = useRef<HTMLDialogElement>(null);
  const [submission] = useState(intent);
  const [form, setForm] = useState(() => ({
    eventType: rule?.eventType ?? 'bill_due',
    subscriptionId: rule?.subscriptionId ?? '',
    budgetId: rule?.budgetId ?? '',
    leadDays: rule?.leadDays ?? [3, 0],
    localTime: rule?.localTime ?? '09:00',
    quiet: Boolean(rule?.quietHours ?? true),
    quietStart: rule?.quietHours?.start ?? '22:00',
    quietEnd: rule?.quietHours?.end ?? '08:00',
    channelIds: rule?.channelIds ?? channels.filter(c => c.type === 'in_app').map(c => c.id),
    fxBase: rule?.fx?.base ?? 'USD',
    fxQuote: rule?.fx?.quote ?? ui.ledger.baseCurrency,
    fxAbove: rule?.fx?.above ?? '',
    fxBelow: rule?.fx?.below ?? '',
  }));
  const [preview, setPreview] = useState<Preview | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    dialog.current?.showModal();
  }, []);
  const set = (patch: Partial<typeof form>) => {
    setForm(f => ({ ...f, ...patch }));
    setPreview(null);
    setError(null);
  };
  const dated = DATED_EVENTS.includes(form.eventType);
  const body = useMemo(
    () =>
      form.channelIds.length
        ? {
            eventType: form.eventType,
            localTime: form.localTime,
            timezone: ui.ledger.timezone,
            channelIds: form.channelIds,
            ...(form.subscriptionId && ['bill_due', 'overdue', 'trial_end', 'cancel_deadline'].includes(form.eventType)
              ? { subscriptionId: form.subscriptionId }
              : {}),
            ...(form.budgetId && form.eventType === 'budget_threshold' ? { budgetId: form.budgetId } : {}),
            ...(dated ? { leadDays: form.leadDays } : {}),
            ...(form.quiet ? { quietHours: { start: form.quietStart, end: form.quietEnd } } : {}),
            ...(form.eventType === 'fx_threshold'
              ? {
                  fx: {
                    base: form.fxBase,
                    quote: form.fxQuote,
                    ...(form.fxAbove ? { above: form.fxAbove } : {}),
                    ...(form.fxBelow ? { below: form.fxBelow } : {}),
                  },
                }
              : {}),
          }
        : null,
    [form, dated, ui.ledger.timezone],
  );
  useEffect(() => {
    if (!body || rule) return;
    let current = true; // drop responses for an input that has since changed
    const timer = setTimeout(async () => {
      try {
        const next = await api<Preview>(`/api/v1/ledgers/${ui.ledger.id}/reminder-previews`, {
          method: 'POST',
          body: JSON.stringify(body),
        });
        if (current) setPreview(next);
      } catch (e) {
        if (current) {
          setPreview(null);
          setError(e instanceof ApiError ? e : null);
        }
      }
    }, 350);
    return () => {
      current = false;
      clearTimeout(timer);
    };
  }, [body, rule, ui.ledger.id]);
  const close = () => {
    dialog.current?.close();
    onClose();
  };
  async function save(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (rule) {
        await api(`/api/v1/ledgers/${ui.ledger.id}/reminder-rules/${rule.id}`, {
          method: 'PATCH',
          headers: { 'If-Match': `"v${rule.version}"` },
          body: JSON.stringify({
            localTime: form.localTime,
            channelIds: form.channelIds,
            quietHours: form.quiet ? { start: form.quietStart, end: form.quietEnd } : null,
            ...(dated ? { leadDays: form.leadDays } : {}),
            ...(form.eventType === 'fx_threshold' && body && 'fx' in body ? { fx: body.fx } : {}),
          }),
        });
      } else if (preview) {
        await api(`/api/v1/ledgers/${ui.ledger.id}/reminder-rules`, {
          method: 'POST',
          headers: { 'Idempotency-Key': submission.key(preview.previewId) },
          body: JSON.stringify({ previewId: preview.previewId }),
        });
        submission.done();
      }
      ui.toast({ text: rule ? '提醒已更新：未发送的旧计划已取消并按新规则重排' : '已创建提醒' });
      close();
      router.refresh();
    } catch (e) {
      setError(e instanceof ApiError ? e : new ApiError('保存失败', 0, undefined));
    } finally {
      setBusy(false);
    }
  }
  return (
    <dialog
      ref={dialog}
      className="entry-dialog"
      aria-labelledby="rule-title"
      onCancel={e => {
        e.preventDefault();
        close();
      }}
    >
      <form onSubmit={save}>
        <div className="dialoghead">
          <h2 id="rule-title">{rule ? '修改提醒' : '新建提醒'}</h2>
          <button type="button" aria-label="关闭" onClick={close}>
            ✕
          </button>
        </div>
        <div className="dialogbody">
          <div className="formgrid">
            <div className="field">
              <label htmlFor="rule-event">提醒什么</label>
              <select
                id="rule-event"
                value={form.eventType}
                disabled={Boolean(rule)}
                onChange={e => set({ eventType: e.target.value })}
              >
                {EVENTS.map(ev => (
                  <option key={ev} value={ev}>
                    {EVENT_LABELS[ev]}
                  </option>
                ))}
              </select>
            </div>
            {['bill_due', 'overdue', 'trial_end', 'cancel_deadline'].includes(form.eventType) && (
              <div className="field">
                <label htmlFor="rule-subscription">订阅</label>
                <select
                  id="rule-subscription"
                  value={form.subscriptionId}
                  disabled={Boolean(rule)}
                  onChange={e => set({ subscriptionId: e.target.value })}
                >
                  <option value="">全部订阅</option>
                  {subscriptions.map(s => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </div>
            )}
            {form.eventType === 'budget_threshold' && (
              <div className="field">
                <label htmlFor="rule-budget">预算</label>
                <select
                  id="rule-budget"
                  value={form.budgetId}
                  disabled={Boolean(rule)}
                  onChange={e => set({ budgetId: e.target.value })}
                >
                  <option value="">全部预算</option>
                  {budgets.map(b => (
                    <option key={b.id} value={b.id}>
                      {b.name}
                    </option>
                  ))}
                </select>
              </div>
            )}
          </div>
          {dated && (
            <fieldset>
              <legend>提前多久</legend>
              <div className="gap">
                {LEADS.map(n => (
                  <label key={n} className="check-row">
                    <input
                      type="checkbox"
                      checked={form.leadDays.includes(n)}
                      onChange={e =>
                        set({ leadDays: e.target.checked ? [...form.leadDays, n] : form.leadDays.filter(x => x !== n) })
                      }
                    />{' '}
                    {n === 0 ? '当天' : `${n} 天前`}
                  </label>
                ))}
              </div>
            </fieldset>
          )}
          {form.eventType === 'fx_threshold' && (
            <fieldset>
              <legend>汇率条件（参考汇率，不是成交价）</legend>
              <div className="formgrid four">
                <div className="field">
                  <label htmlFor="rule-fx-base">1 单位</label>
                  <select id="rule-fx-base" value={form.fxBase} onChange={e => set({ fxBase: e.target.value })}>
                    {CURRENCIES.map(c => (
                      <option key={c}>{c}</option>
                    ))}
                  </select>
                </div>
                <div className="field">
                  <label htmlFor="rule-fx-quote">折合</label>
                  <select id="rule-fx-quote" value={form.fxQuote} onChange={e => set({ fxQuote: e.target.value })}>
                    {CURRENCIES.map(c => (
                      <option key={c}>{c}</option>
                    ))}
                  </select>
                </div>
                <div className="field">
                  <label htmlFor="rule-fx-above">高于</label>
                  <input
                    id="rule-fx-above"
                    className="num"
                    inputMode="decimal"
                    value={form.fxAbove}
                    onChange={e => set({ fxAbove: e.target.value.trim() })}
                  />
                </div>
                <div className="field">
                  <label htmlFor="rule-fx-below">低于</label>
                  <input
                    id="rule-fx-below"
                    className="num"
                    inputMode="decimal"
                    value={form.fxBelow}
                    onChange={e => set({ fxBelow: e.target.value.trim() })}
                  />
                </div>
              </div>
            </fieldset>
          )}
          <div className="formgrid">
            <div className="field">
              <label htmlFor="rule-time">发送时间 · {ui.ledger.timezone}</label>
              <input
                id="rule-time"
                type="time"
                value={form.localTime}
                onChange={e => set({ localTime: e.target.value })}
              />
            </div>
            <div className="field">
              <span className="field-label">免打扰</span>
              <label className="check-row">
                <input type="checkbox" checked={form.quiet} onChange={e => set({ quiet: e.target.checked })} />{' '}
                免打扰时段顺延
              </label>
            </div>
          </div>
          {form.quiet && (
            <div className="formgrid">
              <div className="field">
                <label htmlFor="rule-quiet-start">免打扰开始</label>
                <input
                  id="rule-quiet-start"
                  type="time"
                  value={form.quietStart}
                  onChange={e => set({ quietStart: e.target.value })}
                />
              </div>
              <div className="field">
                <label htmlFor="rule-quiet-end">免打扰结束</label>
                <input
                  id="rule-quiet-end"
                  type="time"
                  value={form.quietEnd}
                  onChange={e => set({ quietEnd: e.target.value })}
                />
              </div>
            </div>
          )}
          <fieldset>
            <legend>发到哪些渠道</legend>
            {channels.map(c => (
              <label key={c.id} className="check-row channel-pick">
                <input
                  type="checkbox"
                  checked={form.channelIds.includes(c.id)}
                  onChange={e =>
                    set({
                      channelIds: e.target.checked
                        ? [...form.channelIds, c.id]
                        : form.channelIds.filter(x => x !== c.id),
                    })
                  }
                />{' '}
                {c.name}{' '}
                <span className="small muted">
                  · {CHANNEL_TYPES[c.type].name} · {CHANNEL_STATUS[c.status] ?? c.status}
                </span>
              </label>
            ))}
          </fieldset>
          {!rule && (
            <div className="note" aria-live="polite">
              <span className="dot" />
              <div>
                {preview ? (
                  <>
                    {preview.nextFireTimes.length ? (
                      <>
                        下三次：
                        {preview.nextFireTimes
                          .map(f => `${f.localDate} ${f.localTime}${f.deferredByQuietHours ? '（免打扰顺延）' : ''}`)
                          .join('、')}
                      </>
                    ) : (
                      '事件触发，无固定时间。'
                    )}
                    {preview.warnings.map(w => (
                      <div key={w.code} className="small warn-text">
                        ⚠ {w.message}
                      </div>
                    ))}
                  </>
                ) : body ? (
                  '正在计算发送时间…'
                ) : (
                  '至少选择一个渠道。'
                )}
              </div>
            </div>
          )}
          {error && (
            <p className="error" role="alert">
              {error.message}
              {error.errors.length ? `：${error.errors.map(x => x.message).join('；')}` : ''}
            </p>
          )}
        </div>
        <div className="dialogfoot">
          <button type="button" onClick={close}>
            取消
          </button>
          <button className="primary" disabled={busy || (!rule && !preview)}>
            {busy ? '正在保存…' : '保存提醒'}
          </button>
        </div>
      </form>
    </dialog>
  );
}

export function NewRule(props: { channels: ChannelView[]; subscriptions: Option[]; budgets: Option[] }) {
  const ui = useLedgerUI();
  const [open, setOpen] = useState(false);
  if (!ui.canWrite) return null;
  return (
    <>
      <button className="primary" onClick={() => setOpen(true)}>
        ＋ 新建提醒
      </button>
      {open && <RuleForm {...props} onClose={() => setOpen(false)} />}
    </>
  );
}

export function RuleActions({
  rule,
  ...props
}: {
  rule: RuleView;
  channels: ChannelView[];
  subscriptions: Option[];
  budgets: Option[];
}) {
  const ui = useLedgerUI();
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  if (!ui.canWrite) return null;
  const url = `/api/v1/ledgers/${ui.ledger.id}/reminder-rules/${rule.id}`;
  async function send(init: RequestInit, text: string) {
    setBusy(true);
    setError('');
    try {
      await api(url, { ...init, headers: { 'If-Match': `"v${rule.version}"` } });
      ui.toast({ text });
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : '操作失败');
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="gap rule-actions">
      <button onClick={() => setEditing(true)}>修改</button>
      <button
        disabled={busy}
        onClick={() =>
          void send(
            { method: 'PATCH', body: JSON.stringify({ enabled: !rule.enabled }) },
            rule.enabled ? '已暂停：未发送的提醒已取消' : '已恢复',
          )
        }
      >
        {rule.enabled ? '暂停' : '恢复'}
      </button>
      {confirm ? (
        <>
          <button onClick={() => setConfirm(false)}>取消</button>
          <button className="danger" disabled={busy} onClick={() => void send({ method: 'DELETE' }, '提醒已删除')}>
            确认删除
          </button>
        </>
      ) : (
        <button className="danger-outline" onClick={() => setConfirm(true)}>
          删除
        </button>
      )}
      {error && (
        <span className="error" role="alert">
          {error}
        </span>
      )}
      {editing && <RuleForm rule={rule} {...props} onClose={() => setEditing(false)} />}
    </div>
  );
}

export function RetryDelivery({ id, status }: { id: string; status: string }) {
  const ui = useLedgerUI();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [error, setError] = useState('');
  async function retry() {
    setBusy(true);
    setError('');
    try {
      await api(`/api/v1/ledgers/${ui.ledger.id}/notification-deliveries/${id}/retries`, {
        method: 'POST',
        body: '{}',
      });
      ui.toast({ text: '已重新排队' });
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : '重试失败');
    } finally {
      setBusy(false);
      setConfirm(false);
    }
  }
  // An unknown result may already have arrived: resending can duplicate it, so it needs a second click.
  if (status === 'delivery_unknown' && !confirm) {
    return (
      <button className="linkbtn" onClick={() => setConfirm(true)}>
        重发…
      </button>
    );
  }
  return (
    <span className="gap">
      {status === 'delivery_unknown' && <span className="small warn-text">可能重复收到</span>}
      <button className="linkbtn" disabled={busy} onClick={() => void retry()}>
        {status === 'delivery_unknown' ? '确认重发' : '重试'}
      </button>
      {error && (
        <span className="error" role="alert">
          {error}
        </span>
      )}
    </span>
  );
}

export function MarkRead({ id, version, read }: { id: string; version: number; read: boolean }) {
  const ui = useLedgerUI();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  return (
    <button
      className="linkbtn"
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        try {
          await api(`/api/v1/ledgers/${ui.ledger.id}/notifications/${id}`, {
            method: 'PATCH',
            headers: { 'If-Match': `"v${version}"` },
            body: JSON.stringify({ read: !read }),
          });
          router.refresh();
        } finally {
          setBusy(false);
        }
      }}
    >
      {read ? '标为未读' : '标为已读'}
    </button>
  );
}
