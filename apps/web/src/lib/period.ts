import { nextMonth } from '@ledger/domain/report-periods';

/** Month view range from ?month=YYYY-MM (default: the ledger's current month); dateTo is exclusive. */
export function monthRange(month: string | undefined, today: string) {
  const current = /^\d{4}-(0[1-9]|1[0-2])$/.test(month ?? '') ? month! : today.slice(0, 7);
  const dateFrom = `${current}-01`;
  const dateTo = nextMonth(dateFrom);
  const [y, m] = current.split('-').map(Number);
  const prev = m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`;
  return {
    month: current,
    dateFrom,
    dateTo,
    label: `${y} 年 ${m} 月`,
    short: `${m} 月`,
    prev,
    next: dateTo.slice(0, 7),
    isCurrent: current === today.slice(0, 7),
    isFuture: current > today.slice(0, 7),
  };
}
/** Week bucket label "9/28–10/04" from its Monday. */
export function weekLabel(monday: string) {
  const start = new Date(`${monday}T00:00:00Z`);
  const end = new Date(start.getTime() + 6 * 86400_000);
  return `${start.getUTCMonth() + 1}/${String(start.getUTCDate()).padStart(2, '0')}–${end.getUTCMonth() + 1}/${String(end.getUTCDate()).padStart(2, '0')}`;
}
export function withParams(path: string, params: Record<string, string | undefined | null>) {
  const search = new URLSearchParams(Object.entries(params).filter((e): e is [string, string] => Boolean(e[1])));
  return search.size ? `${path}?${search}` : path;
}
