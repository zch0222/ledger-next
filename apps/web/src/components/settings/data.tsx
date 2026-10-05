'use client';
import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { parseCsv } from '@ledger/domain/csv';
import { ApiError, api, intent } from '@/lib/client';
import { useLedgerUI } from '@/components/ledger-ui';
import { formatInstant } from '@/lib/time';
import { Select, plainOptions } from '@/components/ui/select';

type ImportJob = {
  id: string;
  status: string;
  fileName: string;
  rowCount: number;
  validRows: number;
  errorRows: number;
  duplicateRows: number;
  committedRows: number;
  revertedRows: number;
  failureReason: string | null;
  errors: { row: number; column: string | null; code: string; message: string }[];
  createdAt: string;
};
type ExportJob = {
  id: string;
  status: string;
  rowCount: number | null;
  downloadUrl: string | null;
  expiresAt: string | null;
  createdAt: string;
};
const FIELDS = [
  ['date', '日期', true, ['日期', '交易日期', '记账日期', 'date']],
  ['amount', '金额', true, ['金额', '交易金额', 'amount']],
  ['account', '账户', true, ['账户', '账户名称', 'account']],
  ['kind', '类型', false, ['类型', '收支', 'kind', 'type']],
  ['currency', '币种', false, ['币种', '货币', 'currency']],
  ['category', '分类', false, ['分类', '类别', 'category']],
  ['merchant', '商家', false, ['商家', '对方', '交易对方', 'merchant', 'payee']],
  ['note', '备注', false, ['备注', '说明', '描述', 'note', 'memo']],
] as const;
const STATUS: Record<string, string> = {
  validating: '校验中',
  validated: '待提交',
  committing: '入账中',
  committed: '已入账',
  failed: '未通过',
  reverting: '撤销中',
  reverted: '已撤销',
  queued: '排队中',
  running: '生成中',
  ready: '可下载',
  expired: '已过期',
};
const wait = (ms: number) => new Promise(r => setTimeout(r, ms));

/** P11 导入向导: choose a CSV → map its columns → server validates asynchronously → review row errors → commit. */
export function ImportWizard({ jobs: initialJobs }: { jobs: ImportJob[] }) {
  const ui = useLedgerUI();
  const router = useRouter();
  const base = `/api/v1/ledgers/${ui.ledger.id}/import-jobs`;
  const [file, setFile] = useState<File | null>(null);
  const [header, setHeader] = useState<string[]>([]);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [dateFormat, setDateFormat] = useState('YYYY-MM-DD');
  const [defaultKind, setDefaultKind] = useState('');
  const [job, setJob] = useState<ImportJob | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [submission] = useState(intent);
  const [confirmRevert, setConfirmRevert] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  // A file picked before the page finished loading has no change event to wait for: read it on mount.
  useEffect(() => {
    const picked = fileInput.current?.files?.[0];
    if (picked) void choose(picked);
  }, []);
  async function choose(next: File | null) {
    setFile(next);
    setJob(null);
    setError('');
    setHeader([]);
    if (!next) return;
    if (next.size > 5 * 1024 * 1024) {
      setError('文件超过 5 MB 上限');
      return;
    }
    try {
      const cols = (parseCsv(await next.slice(0, 64 * 1024).text(), Infinity, 1)[0] ?? [])
        .map(c => c.trim())
        .filter(Boolean);
      setHeader(cols);
      setMapping(
        Object.fromEntries(
          FIELDS.map(([field, , , guesses]) => [
            field,
            cols.find(
              c =>
                (guesses as readonly string[]).includes(c.toLowerCase()) || (guesses as readonly string[]).includes(c),
            ) ?? '',
          ]),
        ),
      );
    } catch {
      setError('无法读取表头，请确认是 UTF-8 编码的 CSV');
    }
  }
  async function poll(id: string, until: string[]) {
    for (let i = 0; i < 120; i++) {
      const current = await api<ImportJob>(`${base}/${id}`);
      setJob(current);
      if (until.includes(current.status)) return current;
      await wait(i < 10 ? 500 : 1500);
    }
    return null;
  }
  async function upload() {
    if (!file) return;
    setBusy(true);
    setError('');
    const map = {
      columns: Object.fromEntries(Object.entries(mapping).filter(([, v]) => v)),
      dateFormat,
      ...(defaultKind ? { defaultKind } : {}),
    };
    const body = new FormData();
    body.set('file', file);
    body.set('mapping', JSON.stringify(map));
    try {
      const created = await api<ImportJob>(base, {
        method: 'POST',
        headers: {
          'Idempotency-Key': submission.key(`${file.name}:${file.size}:${file.lastModified}:${JSON.stringify(map)}`),
        },
        body,
      });
      submission.done();
      setJob(created);
      await poll(created.id, ['validated', 'failed']);
    } catch (e) {
      setError(
        e instanceof ApiError
          ? `${e.message}${e.errors.length ? `：${e.errors.map(x => x.message).join('；')}` : ''}`
          : '上传失败',
      );
    } finally {
      setBusy(false);
    }
  }
  async function commit(id: string) {
    setBusy(true);
    setError('');
    try {
      await api(`${base}/${id}/commits`, { method: 'POST', headers: { 'Idempotency-Key': `commit-${id}` } });
      const done = await poll(id, ['committed', 'validated']);
      if (done?.status === 'committed') {
        ui.toast({
          text: `已入账 ${done.committedRows} 笔`,
          href: `/ledgers/${ui.ledger.id}/transactions`,
          linkText: '查看账目',
        });
        router.refresh();
      } else if (done?.failureReason) setError(done.failureReason);
    } catch (e) {
      setError(e instanceof Error ? e.message : '提交失败');
    } finally {
      setBusy(false);
    }
  }
  async function revert(id: string) {
    setBusy(true);
    setError('');
    try {
      await api(`${base}/${id}/reversals`, { method: 'POST', headers: { 'Idempotency-Key': `revert-${id}` } });
      await poll(id, ['reverted', 'committed']);
      ui.toast({ text: '已撤销该批次' });
      setConfirmRevert(null);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : '撤销失败');
    } finally {
      setBusy(false);
    }
  }
  const ready = file && header.length && FIELDS.every(([field, , required]) => !required || mapping[field]);
  const jobs = job ? [job, ...initialJobs.filter(j => j.id !== job.id)] : initialJobs;
  return (
    <section className="panel">
      <h2>CSV 导入</h2>
      <p className="sub">支持收入 / 支出；转账与退款请在应用内登记。重复的行不会重复入账，入账后可整批撤销。</p>
      {ui.canWrite ? (
        <div className="import-steps">
          <div className="field">
            <label htmlFor="import-file">1. 选择 UTF-8 CSV（≤5 MB、≤10,000 行）</label>
            <input
              ref={fileInput}
              id="import-file"
              type="file"
              accept=".csv,text/csv"
              onChange={e => void choose(e.target.files?.[0] ?? null)}
            />
          </div>
          {header.length > 0 && (
            <fieldset>
              <legend>2. 列映射（按表头）</legend>
              <div className="formgrid four">
                {FIELDS.map(([field, label, required]) => (
                  <div className="field" key={field}>
                    <label htmlFor={`map-${field}`}>
                      {label}
                      {required ? ' *' : ''}
                    </label>
                    <Select
                      id={`map-${field}`}
                      value={mapping[field] ?? ''}
                      onValueChange={column => setMapping(m => ({ ...m, [field]: column }))}
                      options={[{ value: '', label: required ? '请选择' : '不导入' }, ...plainOptions(header)]}
                    />
                  </div>
                ))}
              </div>
              <div className="formgrid">
                <div className="field">
                  <label htmlFor="map-date-format">日期格式</label>
                  <Select
                    id="map-date-format"
                    value={dateFormat}
                    onValueChange={setDateFormat}
                    options={plainOptions(['YYYY-MM-DD', 'YYYY/MM/DD', 'DD/MM/YYYY', 'MM/DD/YYYY'])}
                  />
                </div>
                {!mapping.kind && (
                  <div className="field">
                    <label htmlFor="map-default-kind">没有类型列时</label>
                    <Select
                      id="map-default-kind"
                      value={defaultKind}
                      onValueChange={setDefaultKind}
                      options={[
                        { value: '', label: '负数为支出，正数为收入' },
                        { value: 'expense', label: '全部为支出（金额为正）' },
                        { value: 'income', label: '全部为收入' },
                      ]}
                    />
                  </div>
                )}
              </div>
              <button className="primary" disabled={!ready || busy} onClick={() => void upload()}>
                {busy && job?.status === 'validating' ? '正在校验…' : '3. 上传并校验'}
              </button>
            </fieldset>
          )}
        </div>
      ) : (
        <p className="muted">仅查看成员不能导入。</p>
      )}
      {job && job.status !== 'reverted' && (
        <div className="import-result" aria-live="polite">
          <h3>
            {job.fileName} · {STATUS[job.status] ?? job.status}
          </h3>
          <p>
            共 {job.rowCount} 行：可导入 {job.validRows}，有问题 {job.errorRows}
            {job.duplicateRows ? `（其中 ${job.duplicateRows} 行此前已入账，已跳过）` : ''}
            {job.committedRows ? ` · 已入账 ${job.committedRows}` : ''}
          </p>
          {job.failureReason && <p className="warn-text">{job.failureReason}</p>}
          {job.errors.length > 0 && (
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>行</th>
                    <th>列</th>
                    <th>原因</th>
                  </tr>
                </thead>
                <tbody>
                  {job.errors.map(e => (
                    <tr key={`${e.row}-${e.code}`}>
                      <td className="num">{e.row}</td>
                      <td>{e.column ?? '—'}</td>
                      <td>{e.message}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {job.status === 'validated' && ui.canWrite && (
            <button className="primary" disabled={busy} onClick={() => void commit(job.id)}>
              {busy ? '正在入账…' : `提交入账 ${job.validRows} 笔`}
            </button>
          )}
        </div>
      )}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {jobs.length > 0 && (
        <>
          <h3>导入记录</h3>
          <ul className="plain-list">
            {jobs.map(j => (
              <li key={j.id}>
                <span>
                  {j.fileName} · {formatInstant(j.createdAt, ui.ledger.timezone)}
                </span>
                <span className="gap">
                  <span className="pill">{STATUS[j.status] ?? j.status}</span>
                  {j.committedRows ? <span className="small muted">{j.committedRows} 笔</span> : null}
                  {j.status === 'committed' &&
                    ui.ledger.role === 'owner' &&
                    (confirmRevert === j.id ? (
                      <>
                        <span className="small">将作废该批次入账的 {j.committedRows} 笔交易（审计保留）</span>
                        <button onClick={() => setConfirmRevert(null)}>取消</button>
                        <button className="danger" disabled={busy} onClick={() => void revert(j.id)}>
                          确认撤销
                        </button>
                      </>
                    ) : (
                      <button className="linkbtn" onClick={() => setConfirmRevert(j.id)}>
                        撤销批次
                      </button>
                    ))}
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}

/** P11 导出: generated by the worker; the link works for its creator only, for one hour. */
export function ExportPanel({ jobs: initialJobs, defaults }: { jobs: ExportJob[]; defaults: Record<string, string> }) {
  const ui = useLedgerUI();
  const base = `/api/v1/ledgers/${ui.ledger.id}/export-jobs`;
  const [jobs, setJobs] = useState(initialJobs);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    if (!jobs.some(j => j.status === 'queued' || j.status === 'running')) return;
    const timer = setTimeout(
      async () =>
        setJobs(
          await Promise.all(
            jobs.map(j => (j.status === 'queued' || j.status === 'running' ? api<ExportJob>(`${base}/${j.id}`) : j)),
          ),
        ),
      1000,
    );
    return () => clearTimeout(timer);
  }, [jobs, base]);
  return (
    <section className="panel">
      <h2>CSV 导出</h2>
      <p className="sub">导出有效账目（含原币、基准金额、分类与转账去向）。公式开头的单元格会被转义。</p>
      <form
        className="formgrid four"
        onSubmit={async e => {
          e.preventDefault();
          setBusy(true);
          setError('');
          const data = Object.fromEntries([...new FormData(e.currentTarget)].filter(([, v]) => v));
          try {
            const job = await api<ExportJob>(base, {
              method: 'POST',
              body: JSON.stringify({ format: 'csv', ...data }),
            });
            setJobs(js => [job, ...js]);
          } catch (err) {
            setError(err instanceof Error ? err.message : '导出失败');
          } finally {
            setBusy(false);
          }
        }}
      >
        <div className="field">
          <label htmlFor="export-from">开始日期（含）</label>
          <input id="export-from" name="dateFrom" type="date" defaultValue={defaults.dateFrom} />
        </div>
        <div className="field">
          <label htmlFor="export-to">结束日期（不含）</label>
          <input id="export-to" name="dateTo" type="date" defaultValue={defaults.dateTo} />
        </div>
        <div className="field">
          <label htmlFor="export-account">账户</label>
          <Select
            id="export-account"
            name="accountId"
            defaultValue={defaults.accountId ?? ''}
            options={[{ value: '', label: '全部' }, ...ui.accounts.map(a => ({ value: a.id, label: a.name }))]}
          />
        </div>
        <div className="field">
          <label>&nbsp;</label>
          <button className="primary" disabled={busy}>
            {busy ? '正在创建…' : '生成 CSV'}
          </button>
        </div>
      </form>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {jobs.length > 0 && (
        <ul className="plain-list">
          {jobs.map(j => (
            <li key={j.id}>
              <span>
                {formatInstant(j.createdAt, ui.ledger.timezone)}
                {j.rowCount !== null ? ` · ${j.rowCount} 笔` : ''}
              </span>
              <span className="gap">
                <span className="pill">{STATUS[j.status] ?? j.status}</span>
                {j.downloadUrl && (
                  <a href={j.downloadUrl} download>
                    下载
                  </a>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
