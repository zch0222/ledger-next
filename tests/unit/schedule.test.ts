import { describe, expect, it } from 'vitest';
import {
  cyclesPerYear,
  firstIndexOnOrAfter,
  nextOccurrences,
  occurrence,
  occurrencesBetween,
  scheduleWarnings,
} from '../../packages/domain/src/schedule';

describe('billing cycles', () => {
  it('keeps the 31st anchor across short months (AC04)', () => {
    const monthly = { unit: 'month', count: 1 } as const;
    expect([0, 1, 2, 3, 4].map(n => occurrence('2026-01-31', monthly, n))).toEqual([
      '2026-01-31',
      '2026-02-28',
      '2026-03-31',
      '2026-04-30',
      '2026-05-31',
    ]);
    expect(occurrence('2028-01-31', monthly, 1)).toBe('2028-02-29'); // leap year
    expect(occurrence('2026-11-30', monthly, 3)).toBe('2027-02-28');
    expect(occurrence('2026-08-31', { unit: 'month', count: 6 }, 1)).toBe('2027-02-28');
  });
  it('handles leap-day yearly anchors and other units', () => {
    const yearly = { unit: 'year', count: 1 } as const;
    expect([0, 1, 2, 3, 4].map(n => occurrence('2024-02-29', yearly, n))).toEqual([
      '2024-02-29',
      '2025-02-28',
      '2026-02-28',
      '2027-02-28',
      '2028-02-29',
    ]);
    expect(occurrence('2026-10-02', { unit: 'week', count: 2 }, 3)).toBe('2026-11-13');
    expect(occurrence('2026-12-30', { unit: 'day', count: 3 }, 1)).toBe('2027-01-02');
    expect(occurrence('2026-03-15', { unit: 'month', count: 12 }, 1)).toBe('2027-03-15');
  });
  it('finds the next occurrences on or after a date and lists a range', () => {
    const monthly = { unit: 'month', count: 1 } as const;
    expect(nextOccurrences('2026-01-31', monthly, '2026-10-02', 3)).toEqual(['2026-10-31', '2026-11-30', '2026-12-31']);
    expect(nextOccurrences('2026-10-02', monthly, '2026-10-02', 1)).toEqual(['2026-10-02']);
    expect(nextOccurrences('2026-12-01', monthly, '2026-10-02', 2)).toEqual(['2026-12-01', '2027-01-01']);
    expect(occurrencesBetween('2026-09-20', { unit: 'week', count: 1 }, '2026-10-01', '2026-10-20')).toEqual([
      '2026-10-04',
      '2026-10-11',
      '2026-10-18',
    ]);
    expect(occurrencesBetween('2026-01-01', { unit: 'day', count: 1 }, '2026-01-01', '2027-01-01', 10)).toHaveLength(
      10,
    );
    for (const date of ['2026-02-27', '2026-02-28', '2026-03-01', '2027-02-28']) {
      const n = firstIndexOnOrAfter('2024-02-29', { unit: 'year', count: 1 }, date);
      expect(occurrence('2024-02-29', { unit: 'year', count: 1 }, n) >= date).toBe(true);
      if (n > 0) expect(occurrence('2024-02-29', { unit: 'year', count: 1 }, n - 1) < date).toBe(true);
    }
  });
  it('describes cycles per year and warns about month ends', () => {
    expect(cyclesPerYear({ unit: 'month', count: 3 })).toEqual(['12', '3']);
    expect(cyclesPerYear({ unit: 'year', count: 1 })).toEqual(['1', '1']);
    expect(cyclesPerYear({ unit: 'week', count: 2 })).toEqual(['365.25', '14']);
    expect(cyclesPerYear({ unit: 'day', count: 30 })).toEqual(['365.25', '30']);
    expect(scheduleWarnings('2026-01-31', { unit: 'month', count: 1 }).map(w => w.code)).toEqual(['MONTH_END']);
    expect(scheduleWarnings('2024-02-29', { unit: 'year', count: 1 }).map(w => w.code)).toEqual(['LEAP_DAY']);
    expect(scheduleWarnings('2026-01-01', { unit: 'day', count: 1 }).map(w => w.code)).toEqual(['DAILY']);
    expect(scheduleWarnings('2026-01-15', { unit: 'month', count: 1 })).toEqual([]);
  });
});
