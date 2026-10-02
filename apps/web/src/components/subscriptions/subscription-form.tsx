'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { formatMoney } from '../../../../../packages/ui/src/format';
import { ApiError, api, intent } from '../../lib/client';
import { useLedgerUI } from '../ledger-ui';

type Preview = { previewId: string; nextOccurrences: string[]; monthlyEquivalent: { amount: string; currency: string }; warnings: { code: string; message: string }[] };
export type SubscriptionView = { id: string; name: string; amount: { amount: string; currency: string }; accountId: string | null; categoryId: string | null; cycle: { unit: 'day' | 'week' | 'month' | 'year'; count: number }; anchorDate: string; timezone: string; status: 'active' | 'paused' | 'cancelled'; nextDueDate: string | null; note: string | null; scheduleVersion: number; version: number; pausedUntil: string | null; endsOn: string | null; monthlyEquivalent: { amount: string; currency: string } };
const UNITS = { day: '天', week: '周', month: '月', year: '年' } as const;
const AMOUNT = /^(0|[1-9]\d{0,17})(\.\d{1,6})?$/;

/** 新增订阅 (UI_SPEC §4.2): 基本资料 / 周期 / 支付账户 / 提醒 in one page, with the next three dates next to the anchor. */
export function NewSubscription({ today }: { today: string }) {
  const ui = useLedgerUI(), router = useRouter(), dialog = useRef<HTMLDialogElement>(null);
  const [open, setOpen] = useState(false), [form, setForm] = useState({ name: '', amount: '', currency: ui.ledger.baseCurrency, unit: 'month', count: '1', anchorDate: today, accountId: ui.accounts[0]?.id ?? '', categoryId: '', note: '' });
  const [preview, setPreview] = useState<Preview | null>(null), [error, setError] = useState<ApiError | null>(null), [busy, setBusy] = useState(false), [submission] = useState(intent);
  useEffect(() => { if (open) dialog.current?.showModal(); else dialog.current?.close(); }, [open]);
  const body = useMemo(() => form.name.trim() && AMOUNT.test(form.amount) && Number(form.amount) > 0 && Number(form.count) >= 1 && form.anchorDate
    ? { name: form.name.trim(), amount: { amount: form.amount, currency: form.currency }, cycle: { unit: form.unit, count: Number(form.count) }, anchorDate: form.anchorDate, timezone: ui.ledger.timezone, ...(form.accountId ? { accountId: form.accountId } : {}), ...(form.categoryId ? { categoryId: form.categoryId } : {}), ...(form.note ? { note: form.note } : {}) } : null, [form, ui.ledger.timezone]);
  useEffect(() => {
    if (!open || !body) return;
    const timer = setTimeout(async () => {
      try { setPreview(await api<Preview>(`/api/v1/ledgers/${ui.ledger.id}/subscription-previews`, { method: 'POST', body: JSON.stringify(body) })); setError(null); }
      catch (e) { setPreview(null); setError(e instanceof ApiError ? e : null); }
    }, 350);
    return () => clearTimeout(timer);
  }, [body, open, ui.ledger.id]);
  const set = (patch: Partial<typeof form>) => { setForm(f => ({ ...f, ...patch })); setPreview(null); };
  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!preview) return;
    setBusy(true);
    try {
      await api(`/api/v1/ledgers/${ui.ledger.id}/subscriptions`, { method: 'POST', headers: { 'Idempotency-Key': submission.key(preview.previewId) }, body: JSON.stringify({ previewId: preview.previewId }) });
      submission.done(); ui.toast({ text: `已新增订阅 ${form.name}` }); setOpen(false); router.refresh();
    } catch (err) { setError(err instanceof ApiError ? err : new ApiError('保存失败', 0, undefined)); setPreview(null); setForm(f => ({ ...f })); } finally { setBusy(false); }
  }
  if (!ui.canWrite) return null;
  return <><button className="primary" onClick={() => setOpen(true)}>＋ 新增订阅</button>
    <dialog ref={dialog} className="entry-dialog" aria-labelledby="sub-title" onClose={() => setOpen(false)}><form onSubmit={save}>
      <div className="dialoghead"><h2 id="sub-title">新增订阅</h2><button type="button" aria-label="关闭" onClick={() => setOpen(false)}>✕</button></div>
      <div className="dialogbody">
        <fieldset><legend>基本资料</legend><div className="formgrid"><div className="field"><label htmlFor="sub-name">服务名称</label><input id="sub-name" value={form.name} maxLength={80} required onChange={e => set({ name: e.target.value })} placeholder="例如：Cloud Pro" /></div>
          <div className="field"><label htmlFor="sub-category">分类</label><select id="sub-category" value={form.categoryId} onChange={e => set({ categoryId: e.target.value })}><option value="">未分类</option>{ui.categories.filter(c => c.kind === 'expense').map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></div></div></fieldset>
        <fieldset><legend>金额与周期</legend><div className="formgrid four">
          <div className="field"><label htmlFor="sub-amount">每期金额（原币）</label><input id="sub-amount" className="num" inputMode="decimal" value={form.amount} onChange={e => set({ amount: e.target.value.trim() })} /></div>
          <div className="field"><label htmlFor="sub-currency">币种</label><select id="sub-currency" value={form.currency} onChange={e => set({ currency: e.target.value })}>{['CNY', 'USD', 'HKD', 'EUR', 'JPY'].map(c => <option key={c}>{c}</option>)}</select></div>
          <div className="field"><label htmlFor="sub-count">每</label><input id="sub-count" className="num" inputMode="numeric" value={form.count} onChange={e => set({ count: e.target.value.replace(/\D/g, '') })} /></div>
          <div className="field"><label htmlFor="sub-unit">单位</label><select id="sub-unit" value={form.unit} onChange={e => set({ unit: e.target.value })}>{Object.entries(UNITS).map(([v, n]) => <option key={v} value={v}>{n}</option>)}</select></div></div>
          <div className="field"><label htmlFor="sub-anchor">首个扣款日（锚点）</label><input id="sub-anchor" type="date" value={form.anchorDate} onChange={e => set({ anchorDate: e.target.value })} /></div>
          <div className="note" aria-live="polite"><span className="dot" /><div>{preview ? <>未来三次：{preview.nextOccurrences.join('、')} · 月均约 {formatMoney(preview.monthlyEquivalent.amount, preview.monthlyEquivalent.currency, { style: 'code' })}（预测，不计入实际支出）{preview.warnings.map(w => <div key={w.code} className="small warn-text">⚠ {w.message}</div>)}</> : '填写名称、金额和周期后显示未来三次扣款日。'}</div></div></fieldset>
        <fieldset><legend>支付账户</legend><div className="field"><label htmlFor="sub-account">默认账户</label><select id="sub-account" value={form.accountId} onChange={e => set({ accountId: e.target.value })}><option value="">暂不指定</option>{ui.accounts.map(a => <option key={a.id} value={a.id}>{a.name} · {a.currency}</option>)}</select></div><p className="small muted">到期只生成待确认账单，不会自动记为已支付。</p></fieldset>
        <fieldset><legend>提醒</legend><p className="small muted">保存后可在“提醒中心”为这个订阅设置提前提醒与接收渠道。</p></fieldset>
        <div className="field"><label htmlFor="sub-note">备注</label><input id="sub-note" value={form.note} maxLength={500} onChange={e => set({ note: e.target.value })} /></div>
        {error && <p className="error" role="alert">{error.message}{error.errors.length ? `：${error.errors.map(x => x.message).join('；')}` : ''}</p>}
      </div>
      <div className="dialogfoot"><button type="button" onClick={() => setOpen(false)}>取消</button><button className="primary" disabled={!preview || busy}>{busy ? '正在保存…' : '保存订阅'}</button></div>
    </form></dialog></>;
}

/** 管理订阅: edit (new schedule version), pause with optional resume date, resume, cancel (now / end of period). */
export function ManageSubscription({ subscription: s, today }: { subscription: SubscriptionView; today: string }) {
  const ui = useLedgerUI(), router = useRouter(), dialog = useRef<HTMLDialogElement>(null);
  const [open, setOpen] = useState(false), [mode, setMode] = useState<'menu' | 'edit' | 'pause' | 'cancel'>('menu'), [error, setError] = useState(''), [busy, setBusy] = useState(false);
  useEffect(() => { if (open) dialog.current?.showModal(); else dialog.current?.close(); }, [open]);
  async function patch(body: Record<string, unknown>, done: string) {
    setBusy(true); setError('');
    try { await api(`/api/v1/ledgers/${ui.ledger.id}/subscriptions/${s.id}`, { method: 'PATCH', headers: { 'If-Match': `"v${s.version}"` }, body: JSON.stringify(body) }); ui.toast({ text: done }); setOpen(false); setMode('menu'); router.refresh(); }
    catch (e) { setError(e instanceof Error ? e.message : '保存失败'); } finally { setBusy(false); }
  }
  const dayBefore = (date: string) => new Date(Date.parse(`${date}T00:00:00Z`) - 86400_000).toISOString().slice(0, 10);
  return <><button className="full-width" onClick={() => setOpen(true)}>管理订阅 →</button>
    <dialog ref={dialog} aria-labelledby={`manage-${s.id}`} onClose={() => { setOpen(false); setMode('menu'); }}>
      <div className="dialoghead"><h2 id={`manage-${s.id}`}>{s.name}</h2><button aria-label="关闭" onClick={() => setOpen(false)}>✕</button></div>
      <div className="dialogbody">
        <dl className="detail-list"><div><dt>金额</dt><dd>{formatMoney(s.amount.amount, s.amount.currency, { style: 'code' })} / {s.cycle.count > 1 ? s.cycle.count : ''}{UNITS[s.cycle.unit]}</dd></div><div><dt>锚点</dt><dd>{s.anchorDate}</dd></div><div><dt>状态</dt><dd>{{ active: '使用中', paused: s.pausedUntil ? `已暂停，${s.pausedUntil} 自动恢复` : '已暂停', cancelled: `已取消，服务至 ${s.endsOn}` }[s.status]}</dd></div><div><dt>计划版本</dt><dd>v{s.scheduleVersion}</dd></div></dl>
        {mode === 'edit' && <form className="formgrid" onSubmit={e => { e.preventDefault(); const f = Object.fromEntries(new FormData(e.currentTarget)) as Record<string, string>; void patch({ name: f.name, amount: { amount: f.amount, currency: s.amount.currency }, anchorDate: f.anchorDate, cycle: { unit: f.unit, count: Number(f.count) } }, '订阅已更新，未付的旧计划已取消'); }}>
          <div className="field"><label htmlFor={`edit-name-${s.id}`}>名称</label><input id={`edit-name-${s.id}`} name="name" defaultValue={s.name} maxLength={80} /></div>
          <div className="field"><label htmlFor={`edit-amount-${s.id}`}>金额 · {s.amount.currency}</label><input id={`edit-amount-${s.id}`} name="amount" className="num" defaultValue={s.amount.amount} /></div>
          <div className="field"><label htmlFor={`edit-count-${s.id}`}>每</label><input id={`edit-count-${s.id}`} name="count" className="num" defaultValue={s.cycle.count} /></div>
          <div className="field"><label htmlFor={`edit-unit-${s.id}`}>单位</label><select id={`edit-unit-${s.id}`} name="unit" defaultValue={s.cycle.unit}>{Object.entries(UNITS).map(([v, n]) => <option key={v} value={v}>{n}</option>)}</select></div>
          <div className="field"><label htmlFor={`edit-anchor-${s.id}`}>锚点</label><input id={`edit-anchor-${s.id}`} name="anchorDate" type="date" defaultValue={s.anchorDate} /></div>
          <p className="small muted">修改金额或周期会生成新计划版本，已付记录保留。</p><button className="primary" disabled={busy}>保存修改</button></form>}
        {mode === 'pause' && <form onSubmit={e => { e.preventDefault(); const until = new FormData(e.currentTarget).get('until') as string; void patch({ status: 'paused', ...(until ? { pausedUntil: until } : {}) }, '已暂停，未来账单已取消'); }}>
          <div className="field"><label htmlFor={`pause-${s.id}`}>自动恢复日期（可选）</label><input id={`pause-${s.id}`} name="until" type="date" min={today} /></div><p className="small muted">恢复后按原锚点继续，不补发暂停期间的提醒。</p><button className="primary" disabled={busy}>确认暂停</button></form>}
        {mode === 'cancel' && <div className="cancel-choice"><p>取消后保留已付记录，之后的账单不再生成。</p>
          <button disabled={busy} onClick={() => void patch({ status: 'cancelled', endsOn: today }, '订阅已取消')}>服务立即结束</button>
          {s.nextDueDate && <button disabled={busy} onClick={() => void patch({ status: 'cancelled', endsOn: dayBefore(s.nextDueDate!) }, '订阅将在本周期结束')}>本周期结束（{dayBefore(s.nextDueDate)}）</button>}</div>}
        {error && <p className="error" role="alert">{error}</p>}
      </div>
      {ui.canWrite && s.status !== 'cancelled' && <div className="dialogfoot">
        {s.status === 'active' && mode === 'menu' && <><button onClick={() => setMode('edit')}>编辑</button><button onClick={() => setMode('pause')}>暂停</button><button className="danger-outline" onClick={() => setMode('cancel')}>取消订阅</button></>}
        {s.status === 'paused' && mode === 'menu' && <><button className="primary" disabled={busy} onClick={() => void patch({ status: 'active' }, '已恢复，按原锚点生成未来账单')}>立即恢复</button><button className="danger-outline" onClick={() => setMode('cancel')}>取消订阅</button></>}
        {mode !== 'menu' && <button onClick={() => setMode('menu')}>返回</button>}
      </div>}
    </dialog></>;
}

/** Bill actions: confirm payment (opens the entry drawer prefilled), skip, restore. */
export function BillActions({ bill, subscription }: { bill: { id: string; name: string; scheduledDate: string; status: string; version: number; amount: { amount: string; currency: string } }; subscription?: { accountId: string | null; categoryId: string | null } }) {
  const ui = useLedgerUI(), router = useRouter(), [busy, setBusy] = useState(false);
  if (!ui.canWrite) return null;
  const status = async (next: 'skipped' | 'scheduled') => {
    setBusy(true);
    try { await api(`/api/v1/ledgers/${ui.ledger.id}/bill-occurrences/${bill.id}`, { method: 'PATCH', headers: { 'If-Match': `"v${bill.version}"` }, body: JSON.stringify({ status: next }) }); ui.toast({ text: next === 'skipped' ? '已跳过本期' : '已恢复本期' }); router.refresh(); }
    catch (e) { ui.toast({ text: e instanceof Error ? e.message : '操作失败' }); } finally { setBusy(false); }
  };
  if (bill.status === 'paid' || bill.status === 'cancelled') return null;
  if (bill.status === 'skipped') return <button className="linkbtn" disabled={busy} onClick={() => void status('scheduled')}>恢复</button>;
  return <span className="gap"><button className="linkbtn" onClick={() => ui.openEntry({ mode: 'bill', bill, accountId: subscription?.accountId, categoryId: subscription?.categoryId })}>确认已付</button><button className="linkbtn" disabled={busy} onClick={() => void status('skipped')}>跳过</button></span>;
}
