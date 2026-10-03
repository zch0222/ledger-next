'use client';
import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ACCOUNT_TYPE_LABELS } from '../../../../../packages/ui/src/format';
import { ApiError, api, intent } from '../../lib/client';
import { useLedgerUI } from '../ledger-ui';

/** New account (P06 / onboarding step 2). Opening balance is not income; currency is fixed after creation. */
export function NewAccount({ open: initiallyOpen = false, first = false }: { open?: boolean; first?: boolean }) {
  const ui = useLedgerUI();
  const router = useRouter();
  const dialog = useRef<HTMLDialogElement>(null);
  const [open, setOpen] = useState(initiallyOpen);
  const [error, setError] = useState<ApiError | null>(null);
  const [busy, setBusy] = useState(false);
  const [submission] = useState(intent);
  useEffect(() => {
    if (open) dialog.current?.showModal();
    else dialog.current?.close();
  }, [open]);
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    const form = Object.fromEntries(new FormData(event.currentTarget)) as Record<string, string>;
    const payload = JSON.stringify({
      name: form.name,
      type: form.type,
      currency: form.currency,
      openingBalance: form.openingBalance || '0',
      ...(form.note ? { note: form.note } : {}),
    });
    try {
      await api(`/api/v1/ledgers/${ui.ledger.id}/accounts`, {
        method: 'POST',
        headers: { 'Idempotency-Key': submission.key(payload) },
        body: payload,
      });
      submission.done();
      ui.toast({ text: `已新建账户 ${form.name}` });
      setOpen(false);
      router.replace(first ? `/ledgers/${ui.ledger.id}/dashboard` : `/ledgers/${ui.ledger.id}/accounts`);
      router.refresh();
    } catch (e) {
      setError(e instanceof ApiError ? e : new ApiError('创建失败', 0, undefined));
    } finally {
      setBusy(false);
    }
  }
  const field = (path: string) => error?.errors.find(e => e.path === path)?.message;
  return (
    <>
      {ui.canWrite && (
        <button className="primary" onClick={() => setOpen(true)}>
          ＋ 新建账户
        </button>
      )}
      <dialog ref={dialog} aria-labelledby="account-title" onClose={() => setOpen(false)}>
        <form onSubmit={submit}>
          <div className="dialoghead">
            <h2 id="account-title">{first ? '添加首个账户' : '新建账户'}</h2>
            <button type="button" aria-label="关闭" onClick={() => setOpen(false)}>
              ✕
            </button>
          </div>
          <div className="dialogbody">
            {first && <p className="sub">账本已创建。添加一个现金、银行卡或信用卡账户，就可以开始记账。</p>}
            <div className="field">
              <label htmlFor="account-name">账户名称</label>
              <input
                id="account-name"
                name="name"
                required
                maxLength={80}
                placeholder="例如：招行借记卡"
                aria-describedby="account-name-error"
              />
              <div className="error" id="account-name-error">
                {field('name')}
              </div>
            </div>
            <div className="formgrid">
              <div className="field">
                <label htmlFor="account-type">类型</label>
                <select id="account-type" name="type" defaultValue="bank">
                  {Object.entries(ACCOUNT_TYPE_LABELS).map(([v, n]) => (
                    <option key={v} value={v}>
                      {n}
                    </option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label htmlFor="account-currency">结算币种</label>
                <select id="account-currency" name="currency" defaultValue={ui.ledger.baseCurrency}>
                  {['CNY', 'USD', 'HKD', 'EUR', 'JPY'].map(c => (
                    <option key={c}>{c}</option>
                  ))}
                </select>
              </div>
            </div>
            <div className="field">
              <label htmlFor="account-opening">期初余额（可为负，信用卡欠款填负数）</label>
              <input
                id="account-opening"
                name="openingBalance"
                className="num"
                inputMode="decimal"
                placeholder="0.00"
                aria-describedby="account-opening-error"
              />
              <div className="error" id="account-opening-error">
                {field('openingBalance')}
              </div>
            </div>
            <div className="field">
              <label htmlFor="account-note">备注（可选）</label>
              <input id="account-note" name="note" maxLength={500} />
            </div>
            <p className="small muted">期初余额不计入收入；结算币种创建后不能修改。</p>
            {error && !error.errors.length && (
              <p className="error" role="alert">
                {error.message}
              </p>
            )}
          </div>
          <div className="dialogfoot">
            {first ? (
              <button
                type="button"
                onClick={() => {
                  setOpen(false);
                  router.replace(`/ledgers/${ui.ledger.id}/dashboard`);
                }}
              >
                稍后再说
              </button>
            ) : (
              <button type="button" onClick={() => setOpen(false)}>
                取消
              </button>
            )}
            <button className="primary" disabled={busy}>
              {busy ? '正在保存…' : '保存账户'}
            </button>
          </div>
        </form>
      </dialog>
    </>
  );
}

/** Rename / archive one account; archiving warns about a remaining balance and keeps history. */
export function AccountActions({
  account,
}: {
  account: { id: string; name: string; currency: string; balance: string; version: number; note: string | null };
}) {
  const ui = useLedgerUI();
  const router = useRouter();
  const [mode, setMode] = useState<'idle' | 'rename' | 'archive'>('idle');
  const [name, setName] = useState(account.name);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  async function send(method: 'PATCH' | 'DELETE') {
    setBusy(true);
    setError('');
    try {
      await api(`/api/v1/ledgers/${ui.ledger.id}/accounts/${account.id}`, {
        method,
        headers: { 'If-Match': `"v${account.version}"` },
        ...(method === 'PATCH' ? { body: JSON.stringify({ name }) } : {}),
      });
      ui.toast({ text: method === 'PATCH' ? '已更新账户' : `已归档 ${account.name}` });
      setMode('idle');
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : '操作失败');
    } finally {
      setBusy(false);
    }
  }
  if (!ui.canWrite) return null;
  return (
    <div className="account-actions">
      {mode === 'idle' && (
        <div className="gap">
          <button onClick={() => ui.openEntry({ mode: 'create', kind: 'transfer', accountId: account.id })}>
            转账
          </button>
          <button onClick={() => ui.openEntry({ mode: 'create', accountId: account.id })}>记一笔</button>
          <button className="linkbtn" onClick={() => setMode('rename')}>
            改名
          </button>
          <button className="linkbtn" onClick={() => setMode('archive')}>
            归档
          </button>
        </div>
      )}
      {mode === 'rename' && (
        <form
          className="gap"
          onSubmit={e => {
            e.preventDefault();
            void send('PATCH');
          }}
        >
          <label className="visually-hidden" htmlFor={`rename-${account.id}`}>
            新名称
          </label>
          <input id={`rename-${account.id}`} value={name} maxLength={80} onChange={e => setName(e.target.value)} />
          <button className="primary" disabled={busy}>
            保存
          </button>
          <button type="button" onClick={() => setMode('idle')}>
            取消
          </button>
        </form>
      )}
      {mode === 'archive' && (
        <div className="note confirm-box" role="alertdialog" aria-label="确认归档">
          <span>
            {Number(account.balance) !== 0
              ? `账户仍有余额 ${account.currency} ${account.balance}，归档后不能再记账，余额与历史保留。`
              : '归档后不能再记账，历史保留。'}
          </span>
          <button onClick={() => setMode('idle')}>取消</button>
          <button className="danger" disabled={busy} onClick={() => void send('DELETE')}>
            确认归档
          </button>
        </div>
      )}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
