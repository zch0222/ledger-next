'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { FRESHNESS_LABELS, KIND_LABELS, formatMoney } from '../../../../packages/ui/src/format';
import { ApiError, api, intent } from '../lib/client';
import { instantToLocal, localToInstant, nowLocal } from '../lib/time';
import type { PreviewView, TransactionView } from '../lib/types';
import { useLedgerUI } from './ledger-ui';

export type EntryInit =
  | { mode: 'create'; kind?: 'expense' | 'income' | 'transfer'; accountId?: string; targetAccountId?: string; categoryId?: string; merchant?: string; amount?: string }
  | { mode: 'correct'; transaction: TransactionView }
  | { mode: 'refund'; transaction: TransactionView; remaining?: string }
  | { mode: 'bill'; bill: { id: string; name: string; scheduledDate: string; amount: { amount: string; currency: string } }; accountId?: string | null; categoryId?: string | null };
type Kind = 'expense' | 'income' | 'transfer';
type Form = { kind: Kind; accountId: string; amount: string; categoryId: string; when: string; merchant: string; note: string; targetAccountId: string; targetAmount: string; fee: string; originalAmount: string; originalCurrency: string; fxPolicy: 'fresh-only' | 'accept-stale' | 'manual'; rate: string; rateReason: string };
const AMOUNT = /^(0|[1-9]\d{0,17})(\.\d{1,6})?$/;
const TITLES = { create: '记一笔', correct: '更正账目', refund: '登记退款', bill: '确认账单已支付' };

function initialForm(init: EntryInit, accounts: { id: string; currency: string }[], timezone: string): Form {
  const blank: Form = { kind: 'expense', accountId: accounts[0]?.id ?? '', amount: '', categoryId: '', when: nowLocal(timezone), merchant: '', note: '', targetAccountId: accounts[1]?.id ?? '', targetAmount: '', fee: '', originalAmount: '', originalCurrency: '', fxPolicy: 'fresh-only', rate: '', rateReason: '' };
  if (init.mode === 'create') {
    const last = typeof sessionStorage === 'undefined' ? null : (() => { try { return sessionStorage.getItem('ledger:last-account'); } catch { return null; } })();
    const accountId = init.accountId ?? (accounts.some(a => a.id === last) ? last! : blank.accountId);
    return { ...blank, kind: init.kind ?? 'expense', accountId, targetAccountId: init.targetAccountId ?? accounts.find(a => a.id !== accountId)?.id ?? '', categoryId: init.categoryId ?? '', merchant: init.merchant ?? '', amount: init.amount ?? '' };
  }
  if (init.mode === 'bill') {
    const accountId = init.accountId && accounts.some(a => a.id === init.accountId) ? init.accountId : blank.accountId;
    const sameCurrency = accounts.find(a => a.id === accountId)?.currency === init.bill.amount.currency;
    return { ...blank, kind: 'expense', accountId, categoryId: init.categoryId ?? '', merchant: init.bill.name, amount: sameCurrency ? init.bill.amount.amount : '', ...(sameCurrency ? {} : { originalAmount: init.bill.amount.amount, originalCurrency: init.bill.amount.currency }) };
  }
  const t = init.transaction;
  if (init.mode === 'refund') return { ...blank, kind: 'expense', accountId: t.accountId ?? blank.accountId, amount: init.remaining ?? '', when: nowLocal(timezone), originalCurrency: t.settlement.currency };
  if (t.kind === 'transfer' && t.transfer) return { ...blank, kind: 'transfer', accountId: t.transfer.sourceAccountId, targetAccountId: t.transfer.targetAccountId, amount: t.transfer.sourceAmount.amount, targetAmount: t.transfer.targetAmount.amount, when: instantToLocal(t.occurredAt, t.timezone), note: t.note ?? '' };
  return { ...blank, kind: t.kind === 'income' ? 'income' : 'expense', accountId: t.accountId ?? '', amount: t.settlement.amount, categoryId: t.categoryId ?? '', when: instantToLocal(t.occurredAt, t.timezone), merchant: t.merchant ?? '', note: t.note ?? '',
    ...(t.original.currency !== t.settlement.currency ? { originalAmount: t.original.amount, originalCurrency: t.original.currency } : {}),
    ...(t.exchangeRate?.freshness === 'manual' && t.exchangeRate.source === 'manual' ? { fxPolicy: 'manual' as const, rate: t.exchangeRate.value, rateReason: t.exchangeRate.manualReason ?? '' } : {}) };
}

/** P03 记账 / 更正 / 退款: preview first (no money moves), then submit the same preview with one Idempotency-Key. */
export function EntryDrawer({ init, onClose }: { init: EntryInit; onClose: () => void }) {
  const { ledger, accounts, categories, toast } = useLedgerUI();
  const router = useRouter(), dialog = useRef<HTMLDialogElement>(null), amountRef = useRef<HTMLInputElement>(null);
  const [form, setForm] = useState<Form>(() => initialForm(init, accounts, ledger.timezone));
  const [preview, setPreview] = useState<PreviewView | null>(null), [previewing, setPreviewing] = useState(false);
  const [error, setError] = useState<ApiError | null>(null), [busy, setBusy] = useState(false), [dirty, setDirty] = useState(false), [confirmClose, setConfirmClose] = useState(false);
  const [submission] = useState(intent), [conflict, setConflict] = useState<TransactionView | null>(null);
  const original = init.mode === 'correct' || init.mode === 'refund' ? init.transaction : null;
  const account = accounts.find(a => a.id === form.accountId), target = accounts.find(a => a.id === form.targetAccountId);
  const isRefund = init.mode === 'refund', isTransfer = form.kind === 'transfer' && !isRefund;
  const crossRefund = isRefund && account && original && account.currency !== original.settlement.currency;
  const set = (patch: Partial<Form>) => { setForm(f => ({ ...f, ...patch })); setDirty(true); setPreview(null); setError(null); };

  useEffect(() => { dialog.current?.showModal(); amountRef.current?.focus(); }, []);

  // The request body for the preview; null while the form is incomplete.
  const body = useMemo(() => {
    if (!account || !AMOUNT.test(form.amount) || Number(form.amount) === 0 || !form.when) return null;
    const occurredAt = localToInstant(form.when, ledger.timezone), base = { occurredAt, timezone: ledger.timezone };
    const fx = form.fxPolicy === 'manual' ? { fxPolicy: 'manual', manualRate: { value: form.rate, reason: form.rateReason } } : { fxPolicy: form.fxPolicy };
    if (isRefund) {
      if (crossRefund && !AMOUNT.test(form.originalAmount)) return null;
      return { kind: 'refund', originalTransactionId: original!.id, accountId: account.id, settlement: { amount: form.amount, currency: account.currency }, ...(crossRefund ? { originalAmount: { amount: form.originalAmount, currency: original!.settlement.currency } } : {}), ...(form.note ? { note: form.note } : {}), ...base };
    }
    if (isTransfer) {
      const targetAmount = target && target.currency === account.currency ? form.amount : form.targetAmount;
      if (!target || target.id === account.id || !AMOUNT.test(targetAmount)) return null;
      return { kind: 'transfer', sourceAccountId: account.id, targetAccountId: target.id, sourceAmount: { amount: form.amount, currency: account.currency }, targetAmount: { amount: targetAmount, currency: target.currency },
        ...(form.fee && AMOUNT.test(form.fee) && Number(form.fee) > 0 ? { fee: { amount: { amount: form.fee, currency: account.currency } } } : {}), ...(form.note ? { note: form.note } : {}), ...fx, ...base };
    }
    return { kind: form.kind, accountId: account.id, settlement: { amount: form.amount, currency: account.currency },
      ...(form.originalCurrency && form.originalCurrency !== account.currency && AMOUNT.test(form.originalAmount) ? { original: { amount: form.originalAmount, currency: form.originalCurrency } } : {}),
      ...(form.categoryId ? { categoryId: form.categoryId } : {}), ...(form.merchant ? { merchant: form.merchant } : {}), ...(form.note ? { note: form.note } : {}), ...fx, ...base };
  }, [form, account, target, ledger.timezone, isRefund, isTransfer, crossRefund, original]);

  // Live preview, debounced: amounts, rate and balance effect are computed by the server, never guessed here.
  useEffect(() => {
    if (!body) return;
    const timer = setTimeout(async () => {
      setPreviewing(true);
      try { setPreview(await api<PreviewView>(`/api/v1/ledgers/${ledger.id}/transaction-previews`, { method: 'POST', body: JSON.stringify(body) })); setError(null); }
      catch (e) { setPreview(null); setError(e instanceof ApiError ? e : new ApiError('预览失败', 0, undefined)); }
      finally { setPreviewing(false); }
    }, 350);
    return () => clearTimeout(timer);
  }, [body, ledger.id]);

  function close(force = false) {
    if (dirty && !force) { setConfirmClose(true); return; }
    dialog.current?.close();
    onClose();
  }
  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (!preview || busy) return;
    setBusy(true); setError(null);
    const key = submission.key(preview.previewId);
    try {
      const base = `/api/v1/ledgers/${ledger.id}/transactions`;
      const saved = init.mode === 'correct'
        ? await api<TransactionView>(`${base}/${original!.id}`, { method: 'PATCH', headers: { 'If-Match': `"v${original!.version}"`, 'Idempotency-Key': key }, body: JSON.stringify({ previewId: preview.previewId }) })
        : init.mode === 'bill'
          ? (await api<{ transaction: TransactionView }>(`/api/v1/ledgers/${ledger.id}/bill-occurrences/${init.bill.id}/payments`, { method: 'POST', headers: { 'Idempotency-Key': key }, body: JSON.stringify({ previewId: preview.previewId }) })).transaction
          : await api<TransactionView>(init.mode === 'refund' ? `${base}/${original!.id}/refunds` : base, { method: 'POST', headers: { 'Idempotency-Key': key }, body: JSON.stringify({ previewId: preview.previewId }) });
      submission.done();
      try { if (account) sessionStorage.setItem('ledger:last-account', account.id); } catch { /* storage may be unavailable */ }
      toast({ text: `${init.mode === 'correct' ? '已更正' : '已记录'} ${KIND_LABELS[saved.kind]} ${formatMoney(saved.settlement.amount, saved.settlement.currency, { style: 'code' })}`, href: `/ledgers/${ledger.id}/transactions?tx=${saved.id}`, linkText: '查看详情' });
      dialog.current?.close(); onClose(); router.refresh();
    } catch (e) {
      const failure = e instanceof ApiError ? e : new ApiError('保存失败，请重试', 0, undefined);
      // A consumed / expired / stale preview needs a fresh one; the same intent then gets a new key.
      if (['PREVIEW_STALE', 'PREVIEW_EXPIRED', 'PREVIEW_CONSUMED'].includes(failure.code ?? '')) { submission.done(); setPreview(null); setForm(f => ({ ...f })); }
      // 412: someone changed this entry meanwhile — show the server's current value next to the input; never overwrite.
      if (failure.status === 412 && original) {
        submission.done();
        const read = (id: string) => api<TransactionView>(`/api/v1/ledgers/${ledger.id}/transactions/${id}`);
        let latest = await read(original.id).catch(() => null);
        // Follow the correction chain to the version that is current now.
        for (let hops = 0; latest?.replacedById && hops < 20; hops++) latest = await read(latest.replacedById).catch(() => latest);
        setConflict(latest);
      }
      setError(failure);
    } finally { setBusy(false); }
  }

  const fieldError = (...paths: string[]) => error?.errors.find(e => paths.some(p => e.path === p || e.path.startsWith(`${p}.`)))?.message;
  const fxChoice = error?.code === 'FX_RATE_STALE' || error?.code === 'FX_RATE_MISSING' || form.fxPolicy !== 'fresh-only';
  const usable = accounts.filter(a => a.id !== form.accountId);
  const sortedCategories = categories.filter(c => c.kind === (form.kind === 'income' ? 'income' : 'expense'))
    .map(c => ({ ...c, label: c.parentId ? `${categories.find(p => p.id === c.parentId)?.name ?? ''} / ${c.name}` : c.name })).sort((a, b) => a.label.localeCompare(b.label, 'zh-CN'));

  return <dialog ref={dialog} className="entry-dialog" aria-labelledby="entry-title" onCancel={e => { e.preventDefault(); close(); }}>
    <form onSubmit={save} noValidate>
      <div className="dialoghead"><h2 id="entry-title">{TITLES[init.mode]}</h2><button type="button" onClick={() => close()} aria-label="关闭">✕</button></div>
      <div className="dialogbody">
        {init.mode === 'bill' && <p className="sub entry-context">账单：{init.bill.name} · {init.bill.scheduledDate} · {formatMoney(init.bill.amount.amount, init.bill.amount.currency, { style: 'code' })}。确认后记为实际支出并关联此账单。</p>}
        {original && <p className="sub entry-context">{init.mode === 'refund' ? '原支出' : '原账目'}：{original.merchant ?? KIND_LABELS[original.kind]} · {formatMoney(original.settlement.amount, original.settlement.currency, { style: 'code' })} · {original.localDate}</p>}
        {init.mode === 'create' && <div className="seg kind-seg" role="radiogroup" aria-label="类型">{(['expense', 'income', 'transfer'] as const).map(k => <label key={k}><input type="radio" name="entry-kind" checked={form.kind === k} onChange={() => set({ kind: k, categoryId: '' })} /><span>{KIND_LABELS[k]}</span></label>)}</div>}
        <div className="field"><label htmlFor="entry-amount">{isTransfer ? '转出金额' : isRefund ? '退款金额' : '结算金额'}{account ? ` · ${account.currency}` : ''}</label>
          <input ref={amountRef} id="entry-amount" className="large-amount num" inputMode="decimal" autoComplete="off" placeholder="0.00" value={form.amount} aria-invalid={Boolean(fieldError('settlement', 'sourceAmount'))} aria-describedby="entry-amount-error" onChange={e => set({ amount: e.target.value.trim() })} />
          <div className="error" id="entry-amount-error">{form.amount && !AMOUNT.test(form.amount) ? '请输入大于 0 的金额，例如 128.50' : fieldError('settlement', 'sourceAmount')}</div></div>
        <div className="formgrid">
          <div className="field"><label htmlFor="entry-account">{isTransfer ? '转出账户' : isRefund ? '退回账户' : '账户'}</label>
            <select id="entry-account" value={form.accountId} onChange={e => set({ accountId: e.target.value })}>{accounts.length ? accounts.map(a => <option key={a.id} value={a.id}>{a.name} · {a.currency}</option>) : <option value="">请先新建账户</option>}</select></div>
          {isTransfer
            ? <div className="field"><label htmlFor="entry-target">转入账户</label><select id="entry-target" value={form.targetAccountId} onChange={e => set({ targetAccountId: e.target.value })}>{usable.map(a => <option key={a.id} value={a.id}>{a.name} · {a.currency}</option>)}</select></div>
            : !isRefund && <div className="field"><label htmlFor="entry-category">分类</label><select id="entry-category" value={form.categoryId} onChange={e => set({ categoryId: e.target.value })}><option value="">未分类</option>{sortedCategories.map(c => <option key={c.id} value={c.id}>{c.label}</option>)}</select></div>}
        </div>
        {isTransfer && target && account && target.currency !== account.currency && <div className="field"><label htmlFor="entry-target-amount">转入金额 · {target.currency}</label><input id="entry-target-amount" className="num" inputMode="decimal" value={form.targetAmount} onChange={e => set({ targetAmount: e.target.value.trim() })} /></div>}
        {isTransfer && <div className="field"><label htmlFor="entry-fee">手续费（可选）{account ? ` · ${account.currency}` : ''}</label><input id="entry-fee" className="num" inputMode="decimal" value={form.fee} onChange={e => set({ fee: e.target.value.trim() })} /><p className="small muted">手续费记为独立支出；转账本金不计入收支。</p></div>}
        {crossRefund && <div className="field"><label htmlFor="entry-original-amount">按原支付币种计的退款额 · {original!.settlement.currency}</label><input id="entry-original-amount" className="num" inputMode="decimal" value={form.originalAmount} onChange={e => set({ originalAmount: e.target.value.trim() })} /></div>}
        <div className="formgrid">
          <div className="field"><label htmlFor="entry-when">发生时间 · {ledger.timezone}</label><input id="entry-when" type="datetime-local" value={form.when} onChange={e => set({ when: e.target.value })} /></div>
          {!isTransfer && !isRefund && <div className="field"><label htmlFor="entry-merchant">商家 / 说明</label><input id="entry-merchant" maxLength={120} value={form.merchant} onChange={e => set({ merchant: e.target.value })} placeholder="例如：午餐" /></div>}
        </div>
        <details className="entry-more" open={Boolean(form.note || form.originalCurrency)}><summary>更多：备注{!isTransfer && !isRefund ? ' / 原币' : ''}</summary>
          <div className="field"><label htmlFor="entry-note">备注</label><input id="entry-note" maxLength={500} value={form.note} onChange={e => set({ note: e.target.value })} /></div>
          {!isTransfer && !isRefund && <div className="formgrid"><div className="field"><label htmlFor="entry-original-currency">原币（商家标价）</label><select id="entry-original-currency" value={form.originalCurrency} onChange={e => set({ originalCurrency: e.target.value })}><option value="">同结算币</option>{['CNY', 'USD', 'HKD', 'EUR', 'JPY'].map(c => <option key={c}>{c}</option>)}</select></div>
            {form.originalCurrency && <div className="field"><label htmlFor="entry-original">原币金额</label><input id="entry-original" className="num" inputMode="decimal" value={form.originalAmount} onChange={e => set({ originalAmount: e.target.value.trim() })} /></div>}</div>}
        </details>
        {fxChoice && !isRefund && <fieldset className="fx-choice"><legend>汇率口径</legend>
          <div className="seg">{([['fresh-only', '参考汇率'], ['accept-stale', '沿用旧率'], ['manual', '手填汇率']] as const).map(([value, label]) => <label key={value}><input type="radio" name="fx-policy" checked={form.fxPolicy === value} onChange={() => set({ fxPolicy: value })} /><span>{label}</span></label>)}</div>
          {form.fxPolicy === 'manual' && <div className="formgrid"><div className="field"><label htmlFor="entry-rate">1 {account?.currency} = ? {ledger.baseCurrency}</label><input id="entry-rate" className="num" inputMode="decimal" value={form.rate} onChange={e => set({ rate: e.target.value.trim() })} /></div><div className="field"><label htmlFor="entry-rate-reason">理由</label><input id="entry-rate-reason" maxLength={200} value={form.rateReason} onChange={e => set({ rateReason: e.target.value })} placeholder="例如：银行账单" /></div></div>}
        </fieldset>}
        <div className="note entry-preview" aria-live="polite"><span className="dot" /><div>{previewing ? '正在计算入账结果…' : preview ? <PreviewSummary preview={preview} original={init.mode === 'correct' ? original : null} /> : body ? '正在准备预览…' : '填写金额与账户后显示入账预览：结算金额、折合基准币、汇率来源与余额影响。'}</div></div>
        {conflict && <div className="note conflict-box" role="alert" aria-labelledby="conflict-title"><strong id="conflict-title">这笔账目已被其他人修改，你的更正未保存</strong>
          <div className="conflict-grid"><div><h3>服务器当前（v{conflict.version}）</h3><p className="num">{formatMoney(conflict.settlement.amount, conflict.settlement.currency, { style: 'code' })} · {conflict.merchant ?? KIND_LABELS[conflict.kind]}</p><p className="small muted">{conflict.status === 'voided' ? '已作废' : '当前有效版本'}</p></div>
            <div><h3>你的输入</h3><p className="num">{preview ? formatMoney(preview.settlement.amount, preview.settlement.currency, { style: 'code' }) : account ? formatMoney(form.amount || '0', account.currency, { style: 'code' }) : '—'} · {form.merchant || KIND_LABELS[form.kind]}</p><p className="small muted">尚未保存</p></div></div>
          <button type="button" onClick={() => { dialog.current?.close(); onClose(); router.push(`/ledgers/${ledger.id}/transactions?tx=${conflict.id}`); router.refresh(); }}>重新载入最新版本</button></div>}
        {error && !conflict && <div className="error" role="alert">{error.message}{error.requestId ? <span className="small muted"> · 请求 {error.requestId.slice(0, 8)}</span> : null}</div>}
        {confirmClose && <div className="note confirm-box" role="alertdialog" aria-label="放弃未保存的内容"><span>有未保存的内容。</span><button type="button" onClick={() => setConfirmClose(false)}>继续编辑</button><button type="button" onClick={() => close(true)}>放弃</button></div>}
      </div>
      <div className="dialogfoot"><button type="button" onClick={() => close()}>取消</button><button className="primary" type="submit" disabled={!preview || busy || Boolean(conflict)}>{busy ? '正在保存…' : init.mode === 'correct' ? '确认更正' : init.mode === 'refund' ? '确认退款' : init.mode === 'bill' ? '确认已支付' : '保存'}</button></div>
    </form>
  </dialog>;
}

function PreviewSummary({ preview, original }: { preview: PreviewView; original: TransactionView | null }) {
  const { accounts } = useLedgerUI();
  const rate = preview.exchangeRate;
  return <div className="preview-summary">
    <div><strong>{formatMoney(preview.settlement.amount, preview.settlement.currency, { style: 'code' })}</strong>{preview.base.currency !== preview.settlement.currency && <> · 折合 {formatMoney(preview.base.amount, preview.base.currency, { style: 'code' })}</>}
      {original && <span className="small"> · 原值 {formatMoney(original.settlement.amount, original.settlement.currency, { style: 'code' })} → 新值 {formatMoney(preview.settlement.amount, preview.settlement.currency, { style: 'code' })}</span>}</div>
    {rate && <div className="small">汇率 1 {rate.base} = {rate.value} {rate.quote} · <span className={rate.freshness === 'fresh' ? '' : 'warn-text'}>{FRESHNESS_LABELS[rate.freshness as keyof typeof FRESHNESS_LABELS] ?? rate.freshness}</span>{rate.sourceAt ? ` · 报价 ${new Date(rate.sourceAt).toLocaleString('zh-CN', { hour12: false })}` : ''}{rate.manualReason ? ` · ${rate.manualReason}` : ''}</div>}
    <div className="small">{preview.accountDeltas.map(d => `${accounts.find(a => a.id === d.accountId)?.name ?? '账户'} ${formatMoney(d.delta, d.currency, { sign: 'always' })}`).join('；')}</div>
    {preview.warnings.map(w => <div key={w.code} className="small warn-text">⚠ {w.message}</div>)}
  </div>;
}
