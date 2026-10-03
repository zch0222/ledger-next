'use client';
import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ApiError, api, intent } from '@/lib/client';
import { useLedgerUI } from '@/components/ledger-ui';

type Budget = {
  id: string;
  name: string | null;
  categoryId: string | null;
  period: string;
  amount: { amount: string; currency: string };
  alertThresholds: number[];
  version: number;
};
/** New / edit budget. Budgets are in the base currency, use booked amounts and ignore transfer principal. */
export function BudgetForm({ budget, today }: { budget?: Budget; today: string }) {
  const ui = useLedgerUI();
  const router = useRouter();
  const dialog = useRef<HTMLDialogElement>(null);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const [busy, setBusy] = useState(false);
  const [submission] = useState(intent);
  useEffect(() => {
    if (open) dialog.current?.showModal();
    else dialog.current?.close();
  }, [open]);
  if (!ui.canWrite) return null;
  const parents = ui.categories.filter(c => c.kind === 'expense' && !c.parentId);
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    const f = Object.fromEntries(new FormData(event.currentTarget)) as Record<string, string>;
    const thresholds = f.thresholds
      .split(/[,，\s]+/)
      .filter(Boolean)
      .map(Number);
    const amount = { amount: f.amount, currency: ui.ledger.baseCurrency };
    try {
      if (budget) {
        await api(`/api/v1/ledgers/${ui.ledger.id}/budgets/${budget.id}`, {
          method: 'PATCH',
          headers: { 'If-Match': `"v${budget.version}"` },
          body: JSON.stringify({ name: f.name || null, amount, alertThresholds: thresholds }),
        });
      } else {
        const payload = JSON.stringify({
          ...(f.name ? { name: f.name } : {}),
          ...(f.categoryId ? { categoryId: f.categoryId } : {}),
          period: f.period,
          amount,
          startDate: f.startDate,
          alertThresholds: thresholds,
        });
        await api(`/api/v1/ledgers/${ui.ledger.id}/budgets`, {
          method: 'POST',
          headers: { 'Idempotency-Key': submission.key(payload) },
          body: payload,
        });
        submission.done();
      }
      ui.toast({ text: budget ? '预算已更新' : '已新建预算' });
      setOpen(false);
      router.refresh();
    } catch (e) {
      setError(e instanceof ApiError ? e : new ApiError('保存失败', 0, undefined));
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      {budget ? (
        <button className="linkbtn small" onClick={() => setOpen(true)}>
          调整
        </button>
      ) : (
        <button className="primary" onClick={() => setOpen(true)}>
          ＋ 新建预算
        </button>
      )}
      <dialog ref={dialog} aria-labelledby={`budget-title-${budget?.id ?? 'new'}`} onClose={() => setOpen(false)}>
        <form onSubmit={submit}>
          <div className="dialoghead">
            <h2 id={`budget-title-${budget?.id ?? 'new'}`}>{budget ? '调整预算' : '新建预算'}</h2>
            <button type="button" aria-label="关闭" onClick={() => setOpen(false)}>
              ✕
            </button>
          </div>
          <div className="dialogbody">
            <div className="field">
              <label htmlFor="budget-name">名称（可选）</label>
              <input id="budget-name" name="name" maxLength={80} defaultValue={budget?.name ?? ''} />
            </div>
            {!budget && (
              <div className="formgrid">
                <div className="field">
                  <label htmlFor="budget-category">范围</label>
                  <select id="budget-category" name="categoryId" defaultValue="">
                    <option value="">全部支出（总预算）</option>
                    {parents.map(c => (
                      <option key={c.id} value={c.id}>
                        {c.name}（含子分类）
                      </option>
                    ))}
                  </select>
                </div>
                <div className="field">
                  <label htmlFor="budget-period">周期</label>
                  <select id="budget-period" name="period" defaultValue="month">
                    <option value="week">每周（周一起）</option>
                    <option value="month">每月</option>
                    <option value="year">每年</option>
                  </select>
                </div>
              </div>
            )}
            <div className="formgrid">
              <div className="field">
                <label htmlFor="budget-amount">金额 · {ui.ledger.baseCurrency}</label>
                <input
                  id="budget-amount"
                  name="amount"
                  className="num"
                  inputMode="decimal"
                  required
                  defaultValue={budget?.amount.amount}
                />
              </div>
              {!budget && (
                <div className="field">
                  <label htmlFor="budget-start">开始日期</label>
                  <input
                    id="budget-start"
                    name="startDate"
                    type="date"
                    required
                    defaultValue={`${today.slice(0, 7)}-01`}
                  />
                </div>
              )}
            </div>
            <div className="field">
              <label htmlFor="budget-thresholds">提醒阈值（%，逗号分隔）</label>
              <input
                id="budget-thresholds"
                name="thresholds"
                defaultValue={(budget?.alertThresholds ?? [80, 100]).join(', ')}
              />
            </div>
            <p className="small muted">按历史入账金额统计；退款抵减，转账本金不占预算。</p>
            {error && (
              <p className="error" role="alert">
                {error.message}
                {error.errors.length ? `：${error.errors.map(x => x.message).join('；')}` : ''}
              </p>
            )}
          </div>
          <div className="dialogfoot">
            {budget && <ArchiveBudget budget={budget} onDone={() => setOpen(false)} />}
            <button type="button" onClick={() => setOpen(false)}>
              取消
            </button>
            <button className="primary" disabled={busy}>
              {busy ? '正在保存…' : '保存'}
            </button>
          </div>
        </form>
      </dialog>
    </>
  );
}
function ArchiveBudget({ budget, onDone }: { budget: Budget; onDone: () => void }) {
  const ui = useLedgerUI();
  const router = useRouter();
  const [confirm, setConfirm] = useState(false);
  return confirm ? (
    <button
      type="button"
      className="danger"
      onClick={async () => {
        await api(`/api/v1/ledgers/${ui.ledger.id}/budgets/${budget.id}`, {
          method: 'DELETE',
          headers: { 'If-Match': `"v${budget.version}"` },
        });
        ui.toast({ text: '预算已归档' });
        onDone();
        router.refresh();
      }}
    >
      确认归档
    </button>
  ) : (
    <button type="button" className="danger-outline" onClick={() => setConfirm(true)}>
      归档预算
    </button>
  );
}
