import { addDays, localDate, zonedInstant } from './dates';
import { sum } from './money';

// Fire-time arithmetic for reminder rules (TECHNICAL_DESIGN §6.1, §6.3). Pure: dates are business dates in the
// rule's timezone; instants are computed with zonedInstant (DST gaps move forward, overlaps take the first instant).

export type QuietHours = { start: string; end: string } | null;
export type Fire = {
  scheduledAt: Date;
  localDate: string;
  localTime: string;
  deferredByQuietHours: boolean;
  expiresAt: Date;
};

const minutes = (time: string) => {
  const [h, m] = time.split(':').map(Number);
  return h * 60 + m;
};
const hhmm = (total: number) =>
  `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
/** Wall-clock HH:mm of an instant in a timezone. */
export function localTimeOf(at: Date, timezone: string) {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', { timeZone: timezone, hourCycle: 'h23', hour: '2-digit', minute: '2-digit' })
      .formatToParts(at)
      .map(x => [x.type, x.value]),
  );
  return `${p.hour}:${p.minute}`;
}

/** Whether a local time falls inside quiet hours [start, end); windows may cross midnight (22:00–08:00). */
export function inQuietHours(time: string, quiet: QuietHours) {
  if (!quiet || quiet.start === quiet.end) return false;
  const t = minutes(time);
  const s = minutes(quiet.start);
  const e = minutes(quiet.end);
  return s < e ? t >= s && t < e : t >= s || t < e;
}

/**
 * Moves a local date/time out of quiet hours to the end of the window (in the receiver's timezone). Returns the
 * original slot when it is outside the window.
 */
export function deferQuietHours(
  date: string,
  time: string,
  quiet: QuietHours,
): { date: string; time: string; deferred: boolean } {
  if (!inQuietHours(time, quiet)) return { date, time, deferred: false };
  const crossesMidnight = minutes(quiet!.start) > minutes(quiet!.end);
  const nextDay = crossesMidnight && minutes(time) >= minutes(quiet!.start);
  return { date: nextDay ? addDays(date, 1) : date, time: quiet!.end, deferred: true };
}

/** One slot: the wanted local date/time, moved out of quiet hours, with its expiry instant. */
export function slot(date: string, time: string, timezone: string, quiet: QuietHours, expiresAt: Date): Fire {
  const moved = deferQuietHours(date, time, quiet);
  return {
    scheduledAt: zonedInstant(moved.date, moved.time, timezone),
    localDate: moved.date,
    localTime: moved.time,
    deferredByQuietHours: moved.deferred,
    expiresAt,
  };
}

/** End of a business date in a timezone (the first instant of the next day). */
export const endOfDay = (date: string, timezone: string) => zonedInstant(addDays(date, 1), '00:00', timezone);

/**
 * Reminders before a dated event (bill due, trial end, cancellation deadline): one slot per lead day. Each slot is
 * valid until the next (closer) slot starts and the last one until the end of the event date, so a late start never
 * sends an outdated "in 3 days" message next to the "today" one.
 */
export function beforeEvent(eventDate: string, leadDays: number[], time: string, timezone: string, quiet: QuietHours) {
  const end = endOfDay(eventDate, timezone);
  const leads = [...new Set(leadDays)].sort((a, b) => b - a);
  const slots = leads.map(lead => ({ lead, ...slot(addDays(eventDate, -lead), time, timezone, quiet, end) }));
  return slots.map((s, i) => ({
    ...s,
    expiresAt: i + 1 < slots.length && slots[i + 1].scheduledAt < end ? slots[i + 1].scheduledAt : end,
  }));
}
/** Overdue: the day after the due date, valid for a week. */
export const afterDue = (dueDate: string, time: string, timezone: string, quiet: QuietHours) =>
  slot(addDays(dueDate, 1), time, timezone, quiet, endOfDay(addDays(dueDate, 8), timezone));

/** Periodic slots from `from` (business date) on: daily, weekly (Mondays) or monthly (the 1st), valid for a day. */
export function periodic(
  kind: 'daily' | 'weekly' | 'monthly',
  from: string,
  count: number,
  time: string,
  timezone: string,
  quiet: QuietHours,
) {
  const out: Fire[] = [];
  for (let date = from; out.length < count; date = addDays(date, 1)) {
    const weekday = new Date(`${date}T00:00:00Z`).getUTCDay();
    if (kind === 'weekly' && weekday !== 1) continue;
    if (kind === 'monthly' && !date.endsWith('-01')) continue;
    out.push(slot(date, time, timezone, quiet, endOfDay(addDays(date, kind === 'daily' ? 0 : 1), timezone)));
  }
  return out;
}

/** Today in the timezone and the local wall time, for scheduling decisions. */
export function nowIn(timezone: string, now = new Date()) {
  return { date: localDate(now, timezone), time: localTimeOf(now, timezone) };
}
export { hhmm };

export type FxState = { above: 'armed' | 'fired'; below: 'armed' | 'fired'; lastFiredAt: string | null };
export const FX_COOLDOWN_MS = 6 * 3600 * 1000;
export const FX_HYSTERESIS = '0.002';
/**
 * FX threshold decision: crossing a limit fires once; the limit re-arms only after the rate moves back by 0.2 %
 * (hysteresis), and at most one alert per rule every 6 hours (cooldown), so a rate jittering around the limit stays quiet.
 */
export function fxDecision(
  previous: Partial<FxState> | null,
  rate: string,
  above: string | null,
  below: string | null,
  now: Date,
) {
  const state: FxState = { above: 'armed', below: 'armed', lastFiredAt: null, ...previous };
  const r = sum([rate]);
  const next = { ...state };
  const cooled = !state.lastFiredAt || now.getTime() - Date.parse(state.lastFiredAt) >= FX_COOLDOWN_MS;
  let fire: 'above' | 'below' | null = null;
  if (above) {
    const limit = sum([above]);
    if (r.greaterThanOrEqualTo(limit)) {
      if (state.above === 'armed' && cooled) fire = 'above';
    } else if (r.lessThan(limit.times(sum(['1']).minus(FX_HYSTERESIS)))) next.above = 'armed';
  }
  if (!fire && below) {
    const limit = sum([below]);
    if (r.lessThanOrEqualTo(limit)) {
      if (state.below === 'armed' && cooled) fire = 'below';
    } else if (r.greaterThan(limit.times(sum(['1']).plus(FX_HYSTERESIS)))) next.below = 'armed';
  }
  if (fire) {
    next[fire] = 'fired';
    next.lastFiredAt = now.toISOString();
  }
  return { fire, next, changed: JSON.stringify(next) !== JSON.stringify(state) || !previous };
}
