/** Business date (YYYY-MM-DD) of an instant in an IANA timezone; reports and filters use it, not the UTC date. */
export function localDate(at: Date, timezone: string) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(at);
}

const FORMATTERS = new Map<string, Intl.DateTimeFormat>();
function formatter(timezone: string) {
  let f = FORMATTERS.get(timezone);
  if (!f) {
    FORMATTERS.set(
      timezone,
      (f = new Intl.DateTimeFormat('en-US', {
        timeZone: timezone,
        hourCycle: 'h23',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      })),
    );
  }
  return f;
}
/** Wall-clock time in `timezone` at an instant, as milliseconds of a fake UTC clock. */
function wallClock(at: number, timezone: string) {
  const p = Object.fromEntries(
    formatter(timezone)
      .formatToParts(new Date(at))
      .map(x => [x.type, x.value]),
  );
  return Date.UTC(
    Number(p.year),
    Number(p.month) - 1,
    Number(p.day),
    Number(p.hour),
    Number(p.minute),
    Number(p.second),
  );
}
const offsetAt = (at: number, timezone: string) => wallClock(at, timezone) - Math.floor(at / 1000) * 1000;

/**
 * The instant at which the wall clock in `timezone` shows `date` (YYYY-MM-DD) and `time` (HH:mm).
 * A time skipped by a DST gap moves forward to the first valid instant (the transition); a time that occurs twice in
 * a DST overlap resolves to its first occurrence (TECHNICAL_DESIGN §6.1).
 */
export function zonedInstant(date: string, time: string, timezone: string): Date {
  const [y, m, d] = date.split('-').map(Number);
  const [hh, mm] = time.split(':').map(Number);
  const wall = Date.UTC(y, m - 1, d, hh, mm);
  const offsets = [
    ...new Set([offsetAt(wall - 86400_000, timezone), offsetAt(wall, timezone), offsetAt(wall + 86400_000, timezone)]),
  ];
  const valid = offsets
    .map(o => wall - o)
    .filter(t => wallClock(t, timezone) === wall)
    .sort((a, b) => a - b);
  if (valid.length) return new Date(valid[0]);
  // Gap: find the transition between the earliest and latest candidate instants (offset changes exactly once there).
  let lo = Math.min(...offsets.map(o => wall - o));
  let hi = Math.max(...offsets.map(o => wall - o));
  const before = offsetAt(lo, timezone);
  while (hi - lo > 1000) {
    const mid = Math.floor((lo + hi) / 2 / 1000) * 1000;
    if (offsetAt(mid, timezone) === before) lo = mid;
    else hi = mid;
  }
  return new Date(hi);
}
/** Adds whole days to a YYYY-MM-DD date. */
export function addDays(date: string, days: number) {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}
