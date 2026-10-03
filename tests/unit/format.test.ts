import { describe, expect, it } from 'vitest';
import { formatDate, formatMoney, formatPercent, groupDigits } from '@ledger/ui/format';
import { monthRange, weekLabel, withParams } from '@/lib/period';
import { instantToLocal, localToInstant, nowLocal, today } from '@/lib/time';

describe('money and date display', () => {
  it('groups digits on the text, never through floating point', () => {
    expect(groupDigits('1234567.50')).toBe('1,234,567.50');
    expect(groupDigits('-999')).toBe('-999');
    expect(groupDigits('12345678901234567.123456')).toBe('12,345,678,901,234,567.123456');
    expect(groupDigits('0')).toBe('0');
  });
  it('formats with symbol or code and spells out the sign', () => {
    expect(formatMoney('1234.50', 'CNY')).toBe('¥1,234.50');
    expect(formatMoney('1234.50', 'HKD', { style: 'code' })).toBe('HKD 1,234.50');
    expect(formatMoney('-20.00', 'USD')).toBe('−$20.00');
    expect(formatMoney('-20.00', 'USD', { sign: 'never' })).toBe('$20.00');
    expect(formatMoney('20.00', 'EUR', { sign: 'always' })).toBe('+€20.00');
    expect(formatMoney('0.00', 'EUR', { sign: 'always' })).toBe('€0.00');
    expect(formatMoney('5', 'XYZ')).toBe('XYZ 5');
  });
  it('labels dates and ratios', () => {
    expect(formatDate('2026-10-02', '2026-10-02')).toBe('10 月 2 日');
    expect(formatDate('2025-12-31', '2026-10-02')).toBe('2025 年 12 月 31 日');
    expect(formatDate('2026-01-05')).toBe('1 月 5 日');
    expect(formatPercent('0.8333')).toBe('83%');
    expect(formatPercent('0.8333', 1)).toBe('83.3%');
  });
});

describe('page periods and URLs', () => {
  it('derives month ranges with an exclusive end and safe defaults', () => {
    expect(monthRange(undefined, '2026-10-02')).toEqual({
      month: '2026-10',
      dateFrom: '2026-10-01',
      dateTo: '2026-11-01',
      label: '2026 年 10 月',
      short: '10 月',
      prev: '2026-09',
      next: '2026-11',
      isCurrent: true,
      isFuture: false,
    });
    expect(monthRange('2026-01', '2026-10-02')).toMatchObject({
      dateFrom: '2026-01-01',
      dateTo: '2026-02-01',
      prev: '2025-12',
      isCurrent: false,
    });
    expect(monthRange('2026-12', '2026-10-02')).toMatchObject({
      dateTo: '2027-01-01',
      next: '2027-01',
      isFuture: true,
    });
    expect(monthRange('2026-13', '2026-10-02').month).toBe('2026-10'); // invalid input falls back to the current month
    expect(monthRange('bad', '2026-10-02').month).toBe('2026-10');
  });
  it('labels weeks and builds links without empty parameters', () => {
    expect(weekLabel('2026-09-28')).toBe('9/28–10/04');
    expect(weekLabel('2026-12-28')).toBe('12/28–1/03');
    expect(withParams('/x', { a: '1', b: undefined, c: null, d: '' })).toBe('/x?a=1');
    expect(withParams('/x', {})).toBe('/x');
  });
  it('converts between ledger wall-clock time and instants', () => {
    const at = new Date('2026-10-02T04:05:00Z');
    expect(nowLocal('Asia/Hong_Kong', at)).toBe('2026-10-02T12:05');
    expect(nowLocal('America/New_York', at)).toBe('2026-10-02T00:05');
    expect(localToInstant('2026-10-02T12:05', 'Asia/Hong_Kong')).toBe('2026-10-02T04:05:00.000Z');
    expect(instantToLocal('2026-10-02T04:05:00.000Z', 'Asia/Hong_Kong')).toBe('2026-10-02T12:05');
    expect(today('UTC')).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    // A DST gap moves forward to the first valid time.
    expect(localToInstant('2026-03-08T02:30', 'America/New_York')).toBe('2026-03-08T07:00:00.000Z'); // 03:00 EDT
  });
});
