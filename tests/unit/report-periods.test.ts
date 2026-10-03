import { expect, it } from 'vitest';
import { bucketOf, buckets, nextMonth, periodOf } from '@ledger/domain/report-periods';

it('buckets business dates by day, Monday week and month', () => {
  expect(bucketOf('2026-10-02', 'day')).toBe('2026-10-02');
  expect(bucketOf('2026-10-02', 'week')).toBe('2026-09-28'); // Friday → Monday
  expect(bucketOf('2026-10-04', 'week')).toBe('2026-09-28'); // Sunday stays in its week
  expect(bucketOf('2026-09-28', 'week')).toBe('2026-09-28');
  expect(bucketOf('2026-10-31', 'month')).toBe('2026-10-01');
  expect(nextMonth('2026-12-01')).toBe('2027-01-01');
});
it('lists every bucket of a half-open range and caps the number of points', () => {
  expect(buckets('2026-09-29', '2026-10-02', 'day')).toEqual(['2026-09-29', '2026-09-30', '2026-10-01']);
  expect(buckets('2026-10-01', '2026-10-15', 'week')).toEqual(['2026-09-28', '2026-10-05', '2026-10-12']);
  expect(buckets('2026-01-15', '2026-04-01', 'month')).toEqual(['2026-01-01', '2026-02-01', '2026-03-01']);
  expect(buckets('2025-01-01', '2026-01-01', 'day')).toHaveLength(365);
  expect(buckets('2024-01-01', '2025-01-01', 'day')).toHaveLength(366); // leap year still fits
  expect(() => buckets('2024-01-01', '2025-01-02', 'day')).toThrow(/最多 366 个数据点/);
});
it('finds the calendar period of a budget', () => {
  expect(periodOf('2026-10-02', 'week')).toEqual({ start: '2026-09-28', end: '2026-10-05' });
  expect(periodOf('2026-02-28', 'month')).toEqual({ start: '2026-02-01', end: '2026-03-01' });
  expect(periodOf('2026-12-31', 'month')).toEqual({ start: '2026-12-01', end: '2027-01-01' });
  expect(periodOf('2026-06-15', 'year')).toEqual({ start: '2026-01-01', end: '2027-01-01' });
});
