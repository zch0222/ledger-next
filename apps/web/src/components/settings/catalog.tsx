'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, intent } from '@/lib/client';
import { useLedgerUI } from '@/components/ledger-ui';
import { Checkbox } from '@/components/ui/checkbox';
import { Select } from '@/components/ui/select';

type Category = {
  id: string;
  name: string;
  kind: 'expense' | 'income';
  parentId: string | null;
  archivedAt: string | null;
  version: number;
};
type Tag = { id: string; name: string; archivedAt: string | null; version: number };
const STARTER_CATEGORIES = {
  expense: ['餐饮', '交通', '购物', '居住', '订阅', '娱乐', '医疗', '其他支出'],
  income: ['工资', '奖金', '其他收入'],
};

/** P12 分类 / 标签: two levels, archive instead of delete (history keeps pointing at them). */
export function CatalogManager({ categories, tags }: { categories: Category[]; tags: Tag[] }) {
  const ui = useLedgerUI();
  const router = useRouter();
  const base = `/api/v1/ledgers/${ui.ledger.id}`;
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [submission] = useState(intent);
  const [showArchived, setShowArchived] = useState(false);
  async function run(work: () => Promise<unknown>, done: string) {
    setBusy(true);
    setError('');
    try {
      await work();
      ui.toast({ text: done });
      setEditing(null);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : '操作失败');
    } finally {
      setBusy(false);
    }
  }
  const add = (event: React.FormEvent<HTMLFormElement>, path: 'categories' | 'tags') => {
    event.preventDefault();
    const form = event.currentTarget;
    const data = Object.fromEntries(new FormData(form)) as Record<string, string>;
    const payload = JSON.stringify(
      path === 'tags'
        ? { name: data.name }
        : { name: data.name, kind: data.kind, ...(data.parentId ? { parentId: data.parentId } : {}) },
    );
    void run(async () => {
      await api(`${base}/${path}`, {
        method: 'POST',
        headers: { 'Idempotency-Key': submission.key(path + payload) },
        body: payload,
      });
      submission.done();
      form.reset();
    }, `已添加 ${data.name}`);
  };
  const rename = (path: string, item: { id: string; version: number }) =>
    run(
      () =>
        api(`${base}/${path}/${item.id}`, {
          method: 'PATCH',
          headers: { 'If-Match': `"v${item.version}"` },
          body: JSON.stringify({ name: draft }),
        }),
      '已重命名',
    );
  const archive = (path: string, item: { id: string; name: string; version: number }) =>
    run(
      () => api(`${base}/${path}/${item.id}`, { method: 'DELETE', headers: { 'If-Match': `"v${item.version}"` } }),
      `已归档 ${item.name}（历史账目保留）`,
    );
  const row = (
    path: string,
    item: { id: string; name: string; version: number; archivedAt: string | null },
    child = false,
  ) => (
    <li key={item.id} className={child ? 'child' : undefined}>
      {editing === item.id ? (
        <form
          className="gap"
          onSubmit={e => {
            e.preventDefault();
            void rename(path, item);
          }}
        >
          <label className="visually-hidden" htmlFor={`edit-${item.id}`}>
            新名称
          </label>
          <input
            id={`edit-${item.id}`}
            value={draft}
            maxLength={80}
            onChange={e => setDraft(e.target.value)}
            autoFocus
          />
          <button className="primary" disabled={busy}>
            保存
          </button>
          <button type="button" onClick={() => setEditing(null)}>
            取消
          </button>
        </form>
      ) : (
        <>
          <span>
            {item.name}
            {item.archivedAt && <span className="pill">已归档</span>}
          </span>
          {ui.canWrite && !item.archivedAt && (
            <span className="gap">
              <button
                className="linkbtn"
                onClick={() => {
                  setEditing(item.id);
                  setDraft(item.name);
                }}
              >
                改名
              </button>
              <button className="linkbtn danger-text" onClick={() => void archive(path, item)}>
                归档
              </button>
            </span>
          )}
        </>
      )}
    </li>
  );
  const visible = categories.filter(c => showArchived || !c.archivedAt);
  // A new ledger starts with no categories; offer a common set in one click instead of typing each one.
  const starter = ui.canWrite && !categories.some(c => !c.archivedAt);
  const addStarter = () =>
    run(async () => {
      for (const [kind, names] of Object.entries(STARTER_CATEGORIES)) {
        for (const name of names) {
          await api(`${base}/categories`, { method: 'POST', body: JSON.stringify({ name, kind }) });
        }
      }
    }, '已添加常用分类，可随时改名或归档');
  return (
    <section className="panel" id="catalog">
      <div className="row paneltop">
        <h2>分类与标签</h2>
        <Checkbox className="check small" checked={showArchived} onCheckedChange={setShowArchived}>
          显示已归档
        </Checkbox>
      </div>
      {starter && (
        <div className="note starter-note">
          <span className="dot" />
          <span>
            还没有分类，记账和订阅暂时只能选“未分类”。可以先添加一套常用分类：
            {Object.values(STARTER_CATEGORIES).flat().join('、')}。
          </span>
          <button className="primary" disabled={busy} onClick={() => void addStarter()}>
            添加常用分类
          </button>
        </div>
      )}
      <div className="catalog-grid">
        {(['expense', 'income'] as const).map(kind => (
          <div key={kind}>
            <h3>{kind === 'expense' ? '支出分类' : '收入分类'}</h3>
            <ul className="plain-list catalog">
              {visible
                .filter(c => c.kind === kind && !c.parentId)
                .map(parent => [
                  row('categories', parent),
                  ...visible.filter(c => c.parentId === parent.id).map(child => row('categories', child, true)),
                ])}
              {!visible.some(c => c.kind === kind) && (
                <li className="muted">还没有{kind === 'expense' ? '支出' : '收入'}分类</li>
              )}
            </ul>
          </div>
        ))}
        <div>
          <h3>标签</h3>
          <ul className="plain-list catalog">
            {tags.filter(t => showArchived || !t.archivedAt).map(t => row('tags', t))}
            {!tags.length && <li className="muted">还没有标签</li>}
          </ul>
        </div>
      </div>
      {ui.canWrite && (
        <div className="catalog-forms">
          <form onSubmit={e => add(e, 'categories')} className="formgrid inline-form">
            <div className="field">
              <label htmlFor="new-category">新分类</label>
              <input id="new-category" name="name" required maxLength={80} placeholder="例如：餐饮" />
            </div>
            <div className="field">
              <label htmlFor="new-category-kind">类型</label>
              <Select
                id="new-category-kind"
                name="kind"
                defaultValue="expense"
                options={[
                  { value: 'expense', label: '支出' },
                  { value: 'income', label: '收入' },
                ]}
              />
            </div>
            <div className="field">
              <label htmlFor="new-category-parent">上级（可选）</label>
              <Select
                id="new-category-parent"
                name="parentId"
                defaultValue=""
                options={[
                  { value: '', label: '无（一级分类）' },
                  ...categories
                    .filter(c => !c.parentId && !c.archivedAt)
                    .map(c => ({ value: c.id, label: `${c.kind === 'expense' ? '支出' : '收入'} · ${c.name}` })),
                ]}
              />
            </div>
            <button className="primary" disabled={busy}>
              添加分类
            </button>
          </form>
          <form onSubmit={e => add(e, 'tags')} className="gap inline-form">
            <label className="visually-hidden" htmlFor="new-tag">
              新标签
            </label>
            <input id="new-tag" name="name" required maxLength={40} placeholder="新标签，例如：出差" />
            <button disabled={busy}>添加标签</button>
          </form>
        </div>
      )}
      <p role="alert" className="error">
        {error}
      </p>
    </section>
  );
}

/** Owner-only ledger rename; base currency and timezone are fixed facts of the ledger (D07). */
export function LedgerName({ name, version }: { name: string; version: number }) {
  const ui = useLedgerUI();
  const router = useRouter();
  const [value, setValue] = useState(name);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  return (
    <form
      className="gap"
      onSubmit={async e => {
        e.preventDefault();
        setBusy(true);
        setError('');
        try {
          await api(`/api/v1/ledgers/${ui.ledger.id}`, {
            method: 'PATCH',
            headers: { 'If-Match': `"v${version}"` },
            body: JSON.stringify({ name: value }),
          });
          ui.toast({ text: '账本名称已更新' });
          router.refresh();
        } catch (err) {
          setError(err instanceof Error ? err.message : '保存失败');
        } finally {
          setBusy(false);
        }
      }}
    >
      <label className="visually-hidden" htmlFor="ledger-rename">
        账本名称
      </label>
      <input id="ledger-rename" value={value} maxLength={80} onChange={e => setValue(e.target.value)} />
      <button className="primary" disabled={busy || value === name}>
        保存名称
      </button>
      <span role="alert" className="error">
        {error}
      </span>
    </form>
  );
}
