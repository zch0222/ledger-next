// Billing-cycle arithmetic on business dates (YYYY-MM-DD). Pure; unit-tested for month ends and leap years.
export type Cycle = { unit: 'day' | 'week' | 'month' | 'year'; count: number };

const daysIn = (year: number, month: number) => new Date(Date.UTC(year, month, 0)).getUTCDate(); // month is 1-based
const parts = (date: string) => date.split('-').map(Number) as [number, number, number];
const iso = (y: number, m: number, d: number) =>
  `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;

/**
 * The n-th occurrence (n ≥ 0) of a cycle anchored at `anchor`. Months keep the anchor day and fall back to the last
 * day of short months (1/31 → 2/28 → 3/31); a 2/29 yearly anchor falls on 2/28 in common years.
 */
export function occurrence(anchor: string, cycle: Cycle, n: number) {
  const [y, m, d] = parts(anchor);
  if (cycle.unit === 'day' || cycle.unit === 'week') {
    const days = n * cycle.count * (cycle.unit === 'week' ? 7 : 1);
    return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
  }
  const months = cycle.unit === 'month' ? n * cycle.count : n * cycle.count * 12;
  const total = m - 1 + months;
  const year = y + Math.floor(total / 12);
  const month = (total % 12) + 1;
  return iso(year, month, Math.min(d, daysIn(year, month)));
}

/** Occurrences in [from, to) — at most `limit`, so a misconfigured daily cycle cannot explode. */
export function occurrencesBetween(anchor: string, cycle: Cycle, from: string, to: string, limit = 400) {
  const out: string[] = [];
  let n = firstIndexOnOrAfter(anchor, cycle, from);
  for (
    let date = occurrence(anchor, cycle, n);
    date < to && out.length < limit;
    date = occurrence(anchor, cycle, ++n)
  ) {
    out.push(date);
  }
  return out;
}
/** Smallest n with occurrence(n) ≥ date (n ≥ 0). */
export function firstIndexOnOrAfter(anchor: string, cycle: Cycle, date: string) {
  if (date <= anchor) return 0;
  const [ay, am, ad] = parts(anchor);
  const [y, m, d] = parts(date);
  let n: number;
  if (cycle.unit === 'day' || cycle.unit === 'week') {
    const span = (Date.UTC(y, m - 1, d) - Date.UTC(ay, am - 1, ad)) / 86400_000;
    const step = cycle.count * (cycle.unit === 'week' ? 7 : 1);
    n = Math.floor(span / step);
  } else n = Math.floor(((y - ay) * 12 + (m - am)) / (cycle.count * (cycle.unit === 'year' ? 12 : 1)));
  n = Math.max(0, n - 1);
  while (occurrence(anchor, cycle, n) < date) n++;
  return n;
}
export const nextOccurrences = (anchor: string, cycle: Cycle, onOrAfter: string, count: number) => {
  const n = firstIndexOnOrAfter(anchor, cycle, onOrAfter);
  return Array.from({ length: count }, (_, i) => occurrence(anchor, cycle, n + i));
};

/** Billing cycles per year, as an exact fraction (numerator / denominator) for the monthly-equivalent forecast. */
export function cyclesPerYear(cycle: Cycle): [string, string] {
  if (cycle.unit === 'day') return ['365.25', String(cycle.count)];
  if (cycle.unit === 'week') return ['365.25', String(7 * cycle.count)];
  if (cycle.unit === 'month') return ['12', String(cycle.count)];
  return ['1', String(cycle.count)];
}

/** Planning warnings shown next to the next three dates. */
export function scheduleWarnings(anchor: string, cycle: Cycle) {
  const warnings: { code: string; message: string }[] = [];
  const day = parts(anchor)[2];
  if (cycle.unit === 'month' && day > 28) {
    warnings.push({ code: 'MONTH_END', message: `锚点为 ${day} 日：短月取当月最后一天，之后仍回到 ${day} 日` });
  }
  if (cycle.unit === 'year' && anchor.slice(5) === '02-29') {
    warnings.push({ code: 'LEAP_DAY', message: '2 月 29 日的年费在平年取 2 月 28 日' });
  }
  if (cycle.unit === 'day' && cycle.count === 1) {
    warnings.push({ code: 'DAILY', message: '每日周期会生成大量账单，请确认' });
  }
  return warnings;
}
