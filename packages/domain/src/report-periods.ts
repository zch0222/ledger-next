import { addDays } from './dates';
import { DomainError } from './policy';

// Calendar arithmetic for reports and budgets on business dates (YYYY-MM-DD in the ledger timezone). Pure.
export const MAX_POINTS = 366;
/** Bucket start of a business date: the date itself, the Monday of its week, or the first of its month. */
export function bucketOf(date: string, interval: 'day' | 'week' | 'month') {
  if (interval === 'day') return date;
  if (interval === 'month') return `${date.slice(0, 7)}-01`;
  const weekday = new Date(`${date}T00:00:00Z`).getUTCDay(); // 0 = Sunday
  return addDays(date, -((weekday + 6) % 7));
}
export function buckets(dateFrom: string, dateTo: string, interval: 'day' | 'week' | 'month') {
  const out: string[] = [];
  for (
    let b = bucketOf(dateFrom, interval);
    b < dateTo;
    b = interval === 'day' ? addDays(b, 1) : interval === 'week' ? addDays(b, 7) : nextMonth(b)
  ) {
    out.push(b);
    if (out.length > MAX_POINTS) {
      throw new DomainError(422, 'RANGE_TOO_LARGE', `最多 ${MAX_POINTS} 个数据点，请缩小范围或改用更大的间隔`);
    }
  }
  return out;
}
export const nextMonth = (first: string) => {
  const [y, m] = first.split('-').map(Number);
  return `${m === 12 ? y + 1 : y}-${String(m === 12 ? 1 : m + 1).padStart(2, '0')}-01`;
};

/** Calendar period containing `date`: Monday weeks, calendar months, calendar years. */
export function periodOf(date: string, period: 'week' | 'month' | 'year') {
  if (period === 'week') {
    const start = bucketOf(date, 'week');
    return { start, end: addDays(start, 7) };
  }
  if (period === 'month') {
    const start = `${date.slice(0, 7)}-01`;
    return { start, end: nextMonth(start) };
  }
  const year = Number(date.slice(0, 4));
  return { start: `${year}-01-01`, end: `${year + 1}-01-01` };
}
