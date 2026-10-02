import { expect, it } from 'vitest';
import { addDays, localDate, zonedInstant } from '../../packages/domain/src/dates';

it('uses the business timezone, not the UTC date', () => {
  const at = new Date('2026-10-01T18:30:00Z');
  expect(localDate(at, 'UTC')).toBe('2026-10-01');
  expect(localDate(at, 'Asia/Hong_Kong')).toBe('2026-10-02');
  expect(localDate(at, 'America/New_York')).toBe('2026-10-01');
  expect(localDate(new Date('2026-12-31T23:59:59.999Z'), 'Asia/Tokyo')).toBe('2027-01-01');
  expect(localDate(new Date('2024-02-29T12:00:00Z'), 'Europe/London')).toBe('2024-02-29');
});

it('converts local wall-clock times to instants, including DST gaps and overlaps', () => {
  expect(zonedInstant('2026-10-02', '12:00', 'Asia/Hong_Kong').toISOString()).toBe('2026-10-02T04:00:00.000Z');
  expect(zonedInstant('2026-10-02', '00:00', 'UTC').toISOString()).toBe('2026-10-02T00:00:00.000Z');
  expect(zonedInstant('2026-07-01', '09:30', 'America/New_York').toISOString()).toBe('2026-07-01T13:30:00.000Z');
  expect(zonedInstant('2026-01-15', '09:30', 'America/New_York').toISOString()).toBe('2026-01-15T14:30:00.000Z');
  // Spring forward: 02:30 does not exist in New York on 2026-03-08 → first valid instant, 03:00 EDT.
  expect(zonedInstant('2026-03-08', '02:30', 'America/New_York').toISOString()).toBe('2026-03-08T07:00:00.000Z');
  // Fall back: 01:30 happens twice on 2026-11-01 → the first (EDT) occurrence.
  expect(zonedInstant('2026-11-01', '01:30', 'America/New_York').toISOString()).toBe('2026-11-01T05:30:00.000Z');
  // London: 01:30 skipped on 2026-03-29, repeated on 2026-10-25.
  expect(zonedInstant('2026-03-29', '01:30', 'Europe/London').toISOString()).toBe('2026-03-29T01:00:00.000Z');
  expect(zonedInstant('2026-10-25', '01:30', 'Europe/London').toISOString()).toBe('2026-10-25T00:30:00.000Z');
  expect(zonedInstant('2024-02-29', '23:59', 'Asia/Tokyo').toISOString()).toBe('2024-02-29T14:59:00.000Z');
});
it('adds calendar days across months and leap years', () => {
  expect(addDays('2026-01-31', 1)).toBe('2026-02-01');
  expect(addDays('2024-02-28', 1)).toBe('2024-02-29');
  expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
});
