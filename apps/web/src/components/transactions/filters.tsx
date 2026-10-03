'use client';
import { useEffect, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';

type Option = { id: string; name: string };
const LABELS: Record<string, string> = {
  q: '搜索',
  kind: '类型',
  categoryId: '分类',
  accountId: '账户',
  dateFrom: '起',
  dateTo: '止',
  status: '状态',
};
const KINDS: Record<string, string> = { expense: '支出', income: '收入', transfer: '转账', refund: '退款' };
const STATUSES: Record<string, string> = { posted: '有效', voided: '已作废 / 旧版本', all: '全部版本' };

/** P02 filters live in the URL: reload, back and shared links keep them (UI_SPEC §1). */
export function TransactionFilters({ categories, accounts }: { categories: Option[]; accounts: Option[] }) {
  const router = useRouter();
  const pathname = usePathname();
  const search = useSearchParams();
  const urlQ = search.get('q') ?? '';
  const [q, setQ] = useState(urlQ);
  const [seenQ, setSeenQ] = useState(urlQ);
  // Back / forward change the URL under us: the box follows it instead of pushing the old text again.
  if (urlQ !== seenQ) {
    setSeenQ(urlQ);
    setQ(urlQ);
  }
  const update = (patch: Record<string, string | null>) => {
    const next = new URLSearchParams(search);
    for (const [k, v] of Object.entries(patch)) {
      if (v) next.set(k, v);
      else next.delete(k);
    }
    next.delete('cursor');
    next.delete('tx');
    router.push(`${pathname}${next.size ? `?${next}` : ''}`);
  };
  useEffect(() => {
    if (urlQ === q.trim()) return;
    const timer = setTimeout(() => update({ q: q.trim() || null }), 400);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);
  const names: Record<string, (v: string) => string> = {
    kind: v => KINDS[v] ?? v,
    categoryId: v => categories.find(c => c.id === v)?.name ?? v,
    accountId: v => accounts.find(a => a.id === v)?.name ?? v,
    status: v => STATUSES[v] ?? v,
    q: v => `“${v}”`,
    dateFrom: v => v,
    dateTo: v => `${v} 前`,
  };
  const active = Object.keys(LABELS).filter(k => search.get(k));
  return (
    <div className="filters">
      <div className="filterbar" role="search">
        <input
          aria-label="搜索商家或备注"
          placeholder="搜索商家、备注…"
          value={q}
          onChange={e => setQ(e.target.value)}
          maxLength={100}
        />
        <select
          aria-label="交易类型"
          value={search.get('kind') ?? ''}
          onChange={e => update({ kind: e.target.value || null })}
        >
          <option value="">全部类型</option>
          {Object.entries(KINDS).map(([v, n]) => (
            <option key={v} value={v}>
              {n}
            </option>
          ))}
        </select>
        <select
          aria-label="分类筛选"
          value={search.get('categoryId') ?? ''}
          onChange={e => update({ categoryId: e.target.value || null })}
        >
          <option value="">全部分类</option>
          {categories.map(c => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
        <select
          aria-label="账户筛选"
          value={search.get('accountId') ?? ''}
          onChange={e => update({ accountId: e.target.value || null })}
        >
          <option value="">全部账户</option>
          {accounts.map(a => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </select>
        <label className="date-filter">
          <span className="visually-hidden">开始日期（含）</span>
          <input
            type="date"
            aria-label="开始日期（含）"
            value={search.get('dateFrom') ?? ''}
            onChange={e => update({ dateFrom: e.target.value || null })}
          />
        </label>
        <label className="date-filter">
          <span className="visually-hidden">结束日期（不含）</span>
          <input
            type="date"
            aria-label="结束日期（不含）"
            value={search.get('dateTo') ?? ''}
            onChange={e => update({ dateTo: e.target.value || null })}
          />
        </label>
        <select
          aria-label="版本状态"
          value={search.get('status') ?? 'posted'}
          onChange={e => update({ status: e.target.value === 'posted' ? null : e.target.value })}
        >
          {Object.entries(STATUSES).map(([v, n]) => (
            <option key={v} value={v}>
              {n}
            </option>
          ))}
        </select>
      </div>
      {active.length > 0 && (
        <div className="chips" aria-label="已选筛选">
          {active.map(k => (
            <button
              key={k}
              className="chip-filter"
              onClick={() => {
                if (k === 'q') setQ('');
                update({ [k]: null });
              }}
              aria-label={`移除筛选 ${LABELS[k]}`}
            >
              {LABELS[k]}：{names[k](search.get(k)!)} ✕
            </button>
          ))}
          <button
            className="linkbtn"
            onClick={() => {
              setQ('');
              router.push(pathname);
            }}
          >
            清空筛选
          </button>
        </div>
      )}
    </div>
  );
}
