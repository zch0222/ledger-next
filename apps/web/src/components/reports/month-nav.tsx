import Link from 'next/link';
import { withParams } from '../../lib/period';

/** Previous / next month links that keep the other URL filters. */
export function MonthNav({
  path,
  range,
  params,
}: {
  path: string;
  range: { label: string; prev: string; next: string; isCurrent: boolean };
  params: Record<string, string | undefined>;
}) {
  return (
    <div className="month-nav" role="group" aria-label="选择月份">
      <Link className="button" href={withParams(path, { ...params, month: range.prev })} aria-label="上个月">
        ‹
      </Link>
      <span className="pill">
        {range.label}
        {range.isCurrent ? ' · 本月' : ''}
      </span>
      <Link className="button" href={withParams(path, { ...params, month: range.next })} aria-label="下个月">
        ›
      </Link>
    </div>
  );
}
