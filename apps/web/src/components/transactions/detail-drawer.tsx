'use client';
import { useEffect, useRef, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { FRESHNESS_LABELS, KIND_LABELS, formatMoney } from '../../../../../packages/ui/src/format';
import { ApiError, api } from '../../lib/client';
import type { TransactionView } from '../../lib/types';
import { useLedgerUI } from '../ledger-ui';

/** P03 账目详情: history-preserving actions only — correct (new version), refund (linked), void (reversing postings). */
export function TransactionDrawer({
  transaction: t,
  refunds,
  remaining,
  names,
}: {
  transaction: TransactionView;
  refunds: TransactionView[];
  remaining: string | null;
  names: { accounts: Record<string, string>; categories: Record<string, string> };
}) {
  const ui = useLedgerUI();
  const router = useRouter();
  const pathname = usePathname();
  const search = useSearchParams();
  const dialog = useRef<HTMLDialogElement>(null);
  const [confirmVoid, setConfirmVoid] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  useEffect(() => {
    dialog.current?.showModal();
  }, []);
  const close = () => {
    const next = new URLSearchParams(search);
    next.delete('tx');
    dialog.current?.close();
    router.replace(`${pathname}${next.size ? `?${next}` : ''}`, { scroll: false });
  };
  const link = (id: string) => {
    const next = new URLSearchParams(search);
    next.set('tx', id);
    return `${pathname}?${next}`;
  };
  async function voidIt() {
    setBusy(true);
    setError(null);
    try {
      await api(`/api/v1/ledgers/${ui.ledger.id}/transactions/${t.id}`, {
        method: 'DELETE',
        headers: { 'If-Match': `"v${t.version}"` },
      });
      ui.toast({
        text: `已作废：${t.merchant ?? KIND_LABELS[t.kind]} ${formatMoney(t.settlement.amount, t.settlement.currency, { style: 'code' })}`,
      });
      setConfirmVoid(false);
      router.refresh();
    } catch (e) {
      setError(e instanceof ApiError ? e : new ApiError('作废失败', 0, undefined));
    } finally {
      setBusy(false);
    }
  }
  const posted = t.status === 'posted';
  const canWrite = ui.canWrite && posted;
  // An expense with live refunds is locked: the refunds must be voided first (server answers 409 HAS_REFUNDS).
  const locked = refunds.some(r => r.status === 'posted');
  const account = (id: string | null) => (id ? (names.accounts[id] ?? '已归档账户') : '—');
  const rows: [string, React.ReactNode][] = [
    ['类型', KIND_LABELS[t.kind]],
    ['状态', posted ? '有效' : t.replacedById ? '已被更正（旧版本，保留审计）' : '已作废（保留审计）'],
    ['结算金额', formatMoney(t.settlement.amount, t.settlement.currency, { style: 'code' })],
    ...(t.original.currency !== t.settlement.currency || t.original.amount !== t.settlement.amount
      ? [
          ['原币金额', formatMoney(t.original.amount, t.original.currency, { style: 'code' })] as [
            string,
            React.ReactNode,
          ],
        ]
      : []),
    ['基准金额（历史入账）', formatMoney(t.base.amount, t.base.currency, { style: 'code' })],
    ...(t.exchangeRate
      ? [
          [
            '汇率',
            `1 ${t.exchangeRate.base} = ${t.exchangeRate.value} ${t.exchangeRate.quote} · ${FRESHNESS_LABELS[t.exchangeRate.freshness as keyof typeof FRESHNESS_LABELS] ?? t.exchangeRate.freshness} · ${t.exchangeRate.source}${t.exchangeRate.sourceAt ? ` · ${new Date(t.exchangeRate.sourceAt).toLocaleString('zh-CN', { hour12: false })}` : ''}${t.exchangeRate.manualReason ? ` · ${t.exchangeRate.manualReason}` : ''}`,
          ] as [string, React.ReactNode],
        ]
      : []),
    ...(t.transfer
      ? ([
          [
            '转出',
            `${account(t.transfer.sourceAccountId)} · ${formatMoney(t.transfer.sourceAmount.amount, t.transfer.sourceAmount.currency, { style: 'code' })}`,
          ],
          [
            '转入',
            `${account(t.transfer.targetAccountId)} · ${formatMoney(t.transfer.targetAmount.amount, t.transfer.targetAmount.currency, { style: 'code' })}`,
          ],
        ] as [string, React.ReactNode][])
      : [['账户', account(t.accountId)] as [string, React.ReactNode]]),
    [
      '分类',
      t.categoryId
        ? (names.categories[t.categoryId] ?? '已归档分类')
        : t.kind === 'transfer'
          ? '—（转账不计收支）'
          : '未分类',
    ],
    [
      '发生时间',
      `${new Date(t.occurredAt).toLocaleString('zh-CN', { hour12: false, timeZone: t.timezone })} · ${t.timezone}`,
    ],
    ['商家 / 说明', t.merchant ?? '—'],
    ['备注', t.note ?? '—'],
    [
      '来源',
      (
        { web: '网页', api: 'API', agent: 'Agent', import: 'CSV 导入', subscription: '订阅账单' } as Record<
          string,
          string
        >
      )[t.source] ?? t.source,
    ],
  ];
  return (
    <dialog
      ref={dialog}
      className="detail-dialog"
      aria-labelledby="detail-title"
      onCancel={e => {
        e.preventDefault();
        close();
      }}
    >
      <div className="dialoghead">
        <h2 id="detail-title">{t.merchant ?? KIND_LABELS[t.kind]}</h2>
        <button onClick={close} aria-label="关闭详情">
          ✕
        </button>
      </div>
      <div className="dialogbody">
        <dl className="detail-list">
          {rows.map(([k, v]) => (
            <div key={k}>
              <dt>{k}</dt>
              <dd>{v}</dd>
            </div>
          ))}
        </dl>
        {t.replacesId && (
          <p className="small">
            <a href={link(t.replacesId)}>查看被更正的旧版本 →</a>
          </p>
        )}
        {t.replacedById && (
          <p className="small">
            <a href={link(t.replacedById)}>查看更正后的新版本 →</a>
          </p>
        )}
        {t.refundOf && (
          <p className="small">
            <a href={link(t.refundOf)}>查看原支出 →</a>
          </p>
        )}
        {t.transfer?.feeTransactionId && (
          <p className="small">
            <a href={link(t.transfer.feeTransactionId)}>查看手续费支出 →</a>
          </p>
        )}
        {refunds.length > 0 && (
          <div className="refund-list">
            <h3>已退款</h3>
            {refunds.map(r => (
              <p key={r.id} className="small">
                <a href={link(r.id)}>
                  {r.localDate} · {formatMoney(r.settlement.amount, r.settlement.currency, { style: 'code' })}
                </a>
              </p>
            ))}
          </div>
        )}
        {t.kind === 'expense' && remaining && posted && (
          <p className="small muted">可退余额：{formatMoney(remaining, t.settlement.currency, { style: 'code' })}</p>
        )}
        {confirmVoid && (
          <div className="note confirm-box" role="alertdialog" aria-labelledby="void-title">
            <div>
              <strong id="void-title">
                作废「{t.merchant ?? KIND_LABELS[t.kind]}」
                {formatMoney(t.settlement.amount, t.settlement.currency, { style: 'code' })}？
              </strong>
              <p className="small">
                将追加反向记录：
                {t.transfer
                  ? `${account(t.transfer.sourceAccountId)} ${formatMoney(t.transfer.sourceAmount.amount, t.transfer.sourceAmount.currency, { sign: 'always' })}，${account(t.transfer.targetAccountId)} −${formatMoney(t.transfer.targetAmount.amount, t.transfer.targetAmount.currency, { sign: 'never' })}${t.transfer.feeTransactionId ? '，并作废关联手续费' : ''}`
                  : `${account(t.accountId)} ${t.kind === 'expense' ? '+' : '−'}${formatMoney(t.settlement.amount, t.settlement.currency, { sign: 'never' })}`}
                。原记录和审计保留。
              </p>
            </div>
            <button onClick={() => setConfirmVoid(false)}>取消</button>
            <button className="danger" disabled={busy} onClick={() => void voidIt()}>
              {busy ? '正在作废…' : '确认作废'}
            </button>
          </div>
        )}
        {canWrite && locked && <p className="small muted">已有退款：如需更正或作废，请先作废对应退款。</p>}
        {error && (
          <p className="error" role="alert">
            {error.message}
          </p>
        )}
      </div>
      <div className="dialogfoot">
        {canWrite && !locked && t.kind !== 'refund' && (
          <button
            onClick={() => {
              close();
              ui.openEntry({ mode: 'correct', transaction: t });
            }}
          >
            更正
          </button>
        )}
        {canWrite && t.kind === 'expense' && remaining && Number(remaining) > 0 && (
          <button
            onClick={() => {
              close();
              ui.openEntry({ mode: 'refund', transaction: t, remaining });
            }}
          >
            退款
          </button>
        )}
        {canWrite && !locked && !confirmVoid && (
          <button className="danger-outline" onClick={() => setConfirmVoid(true)}>
            作废
          </button>
        )}
        <button className="primary" onClick={close}>
          完成
        </button>
      </div>
    </dialog>
  );
}
