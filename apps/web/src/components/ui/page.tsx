import Link from 'next/link';
import { DomainError } from '../../../../../packages/domain/src/policy';

/** Page title block from the prototype: kicker, h1, one-line description, optional action. */
export function PageHeading({
  title,
  description,
  action,
}: {
  title: string;
  description?: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <div className="heading">
      <div>
        <div className="kicker">YOUR MONEY, CLEARLY.</div>
        <h1>{title}</h1>
        {description && <p className="sub">{description}</p>}
      </div>
      {action}
    </div>
  );
}
export function Note({ children, tone }: { children: React.ReactNode; tone?: 'warn' }) {
  return (
    <div className={`note${tone === 'warn' ? ' note-warn' : ''}`}>
      <span className="dot" />
      <span>{children}</span>
    </div>
  );
}
/** A failed panel keeps the rest of the page readable and shows the request id for support. */
export function PanelError({ error, title = '这部分暂时无法读取' }: { error: unknown; title?: string }) {
  const requestId = (error as { requestId?: string })?.requestId;
  return (
    <div className="panel-error" role="alert">
      <strong>{title}</strong>
      <p className="small muted">
        {error instanceof DomainError ? error.message : '请稍后刷新重试。'}
        {requestId ? ` · 请求 ${requestId.slice(0, 8)}` : ''}
      </p>
    </div>
  );
}
/** Runs a panel's loader; a failure becomes a local error instead of failing the page. */
export async function attempt<T>(
  load: () => Promise<T>,
): Promise<{ ok: true; value: T } | { ok: false; error: unknown }> {
  try {
    return { ok: true, value: await load() };
  } catch (error) {
    if (error instanceof DomainError && (error.status === 401 || error.status === 404)) throw error;
    console.error(
      JSON.stringify({ panel: 'load', code: (error as { code?: string })?.code ?? (error as Error)?.name }),
    );
    return { ok: false, error };
  }
}
export function EmptyState({
  symbol,
  children,
  action,
}: {
  symbol?: string;
  children: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <div className="empty">
      {symbol && (
        <span className="empty-symbol" aria-hidden="true">
          {symbol}
        </span>
      )}
      <p>{children}</p>
      {action}
    </div>
  );
}
export function SettingsTabs({ ledgerId, current }: { ledgerId: string; current: string }) {
  const tabs = [
    ['', '账本与成员'],
    ['currencies', '币种与汇率'],
    ['data', '导入导出'],
    ['channels', '提醒渠道'],
    ['appearance', '外观'],
  ];
  return (
    <nav className="tabs" aria-label="设置">
      {tabs.map(([id, name]) => (
        <Link
          key={id}
          href={`/ledgers/${ledgerId}/settings${id ? `/${id}` : ''}`}
          aria-current={current === id ? 'page' : undefined}
          className={current === id ? 'active' : ''}
        >
          {name}
        </Link>
      ))}
    </nav>
  );
}
