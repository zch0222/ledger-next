'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { ApiError, api, intent } from '@/lib/client';
import { useLedgerUI } from '@/components/ledger-ui';

/** P09: a manual rate always needs a reason; reports use it only where the market has no quote. */
export function ManualRateForm({ currencies, today }: { currencies: readonly string[]; today: string }) {
  const ui = useLedgerUI();
  const router = useRouter();
  const [error, setError] = useState<ApiError | null>(null);
  const [busy, setBusy] = useState(false);
  const [submission] = useState(intent);
  if (!ui.canWrite) return null;
  return (
    <form
      className="manual-rate"
      onSubmit={async e => {
        e.preventDefault();
        setBusy(true);
        setError(null);
        const form = e.currentTarget;
        const data = Object.fromEntries(new FormData(form));
        const payload = JSON.stringify(data);
        try {
          await api(`/api/v1/ledgers/${ui.ledger.id}/manual-rate-records`, {
            method: 'POST',
            headers: { 'Idempotency-Key': submission.key(payload) },
            body: payload,
          });
          submission.done();
          form.reset();
          ui.toast({ text: '已记录人工汇率' });
          router.refresh();
        } catch (err) {
          setError(err instanceof ApiError ? err : new ApiError('保存失败', 0, undefined));
        } finally {
          setBusy(false);
        }
      }}
    >
      <h3>补录人工汇率</h3>
      <div className="formgrid four">
        <div className="field">
          <label htmlFor="rate-base">1 单位</label>
          <select id="rate-base" name="base" defaultValue={currencies.find(c => c !== ui.ledger.baseCurrency)}>
            {currencies.map(c => (
              <option key={c}>{c}</option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="rate-quote">折合</label>
          <select id="rate-quote" name="quote" defaultValue={ui.ledger.baseCurrency}>
            {currencies.map(c => (
              <option key={c}>{c}</option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="rate-value">汇率</label>
          <input id="rate-value" name="value" className="num" inputMode="decimal" required placeholder="7.10" />
        </div>
        <div className="field">
          <label htmlFor="rate-date">生效日期</label>
          <input id="rate-date" name="effectiveDate" type="date" required defaultValue={today} max={today} />
        </div>
      </div>
      <div className="field">
        <label htmlFor="rate-reason">理由（必填）</label>
        <input id="rate-reason" name="reason" required maxLength={200} placeholder="例如：银行月末牌价" />
      </div>
      {error && (
        <p className="error" role="alert">
          {error.message}
          {error.errors.length ? `：${error.errors.map(x => x.message).join('；')}` : ''}
        </p>
      )}
      <button className="primary" disabled={busy}>
        {busy ? '正在保存…' : '保存人工汇率'}
      </button>
    </form>
  );
}
