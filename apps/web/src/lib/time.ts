import { zonedInstant } from '@ledger/domain/dates';

/** Current wall-clock time in a timezone as a datetime-local value (YYYY-MM-DDTHH:mm). */
export function nowLocal(timezone: string, at = new Date()) {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    })
      .formatToParts(at)
      .map(x => [x.type, x.value]),
  );
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`;
}
/** datetime-local value interpreted in the ledger timezone → RFC 3339 UTC. */
export const localToInstant = (value: string, timezone: string) =>
  zonedInstant(value.slice(0, 10), value.slice(11, 16), timezone).toISOString();
/** RFC 3339 instant → datetime-local value in the timezone. */
export const instantToLocal = (iso: string, timezone: string) => nowLocal(timezone, new Date(iso));
export const today = (timezone: string) => nowLocal(timezone).slice(0, 10);
/**
 * RFC 3339 instant for display, e.g. "2026/10/5 18:00:36". Always pass the ledger (or entry) timezone: without it the
 * server (UTC) and the browser render different text and React reports a hydration mismatch.
 */
export const formatInstant = (iso: string, timezone: string) =>
  new Date(iso).toLocaleString('zh-CN', { hour12: false, timeZone: timezone });
