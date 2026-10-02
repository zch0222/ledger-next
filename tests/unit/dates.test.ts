import { expect, it } from 'vitest';
import { localDate } from '../../packages/domain/src/dates';

it('uses the business timezone, not the UTC date', () => {
  const at = new Date('2026-10-01T18:30:00Z');
  expect(localDate(at, 'UTC')).toBe('2026-10-01');
  expect(localDate(at, 'Asia/Hong_Kong')).toBe('2026-10-02');
  expect(localDate(at, 'America/New_York')).toBe('2026-10-01');
  expect(localDate(new Date('2026-12-31T23:59:59.999Z'), 'Asia/Tokyo')).toBe('2027-01-01');
  expect(localDate(new Date('2024-02-29T12:00:00Z'), 'Europe/London')).toBe('2024-02-29');
});
