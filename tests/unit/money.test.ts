import { describe, expect, it } from 'vitest';
import { CURRENCY_TABLE, ENABLED_CURRENCIES } from '../../packages/contracts/src/common';
import {
  balance,
  compare,
  convert,
  crossRate,
  formatAmount,
  minorUnits,
  negate,
  parseAmount,
  parseRate,
  signedAmount,
  sum,
  toColumn,
} from '../../packages/domain/src/money';
import { accepted, conversions, crossRates, rejected } from '../fixtures/money';

const code = (c: string) => expect.objectContaining({ status: 422, code: c });

describe('amount parsing', () => {
  it.each(accepted)('accepts %s %s as %s', (input, currency, canonical) =>
    expect(parseAmount(input, currency)).toBe(canonical),
  );
  it.each(rejected)('rejects %s %s with %s', (input, currency, error) =>
    expect(() => parseAmount(input, currency)).toThrow(code(error)),
  );
  it('allows zero and negative values only when asked (opening balances, credit cards)', () => {
    expect(parseAmount('0', 'USD', { allowZero: true })).toBe('0.00');
    expect(parseAmount('-0.00', 'USD', { allowZero: true })).toBe('0.00');
    expect(parseAmount('-1000.5', 'CNY', { allowNegative: true })).toBe('-1000.50');
    expect(() => parseAmount('-0', 'USD', { allowZero: true })).toThrow(code('INVALID_AMOUNT'));
    expect(() => parseAmount(12 as unknown as string, 'USD')).toThrow(code('INVALID_AMOUNT'));
  });
  it('keeps the currency table consistent with the enabled API currencies', () => {
    expect(ENABLED_CURRENCIES.every(c => CURRENCY_TABLE[c].enabled)).toBe(true);
    expect(
      Object.entries(CURRENCY_TABLE)
        .filter(([, v]) => v.enabled)
        .map(([c]) => c),
    ).toEqual([...ENABLED_CURRENCIES]);
    expect([minorUnits('JPY'), minorUnits('USD'), minorUnits('KWD')]).toEqual([0, 2, 3]);
  });
});

describe('arithmetic without floating point', () => {
  it('0.1 + 0.2 is exactly 0.30', () => {
    expect(0.1 + 0.2).not.toBe(0.3); // the bug this module exists to avoid
    expect(formatAmount(sum(['0.1', '0.2']), 'USD')).toBe('0.30');
    expect(balance('0.00', Array(10).fill('0.10'), 'CNY')).toBe('1.00');
  });
  it('sums extreme magnitudes exactly', () => {
    expect(formatAmount(sum(['999999999999999999.99', '-999999999999999999.98']), 'USD')).toBe('0.01');
    expect(toColumn(sum(['999999999999999998.999', '0.001']))).toBe('999999999999999999.000000');
    expect(() => toColumn(sum(['999999999999999999.999999', '0.000001']))).toThrow(/DECIMAL\(24,6\)/);
    expect(() => toColumn('0.0000001')).toThrow(/DECIMAL\(24,6\)/);
  });
  it('signs postings by kind and computes balances from opening + postings', () => {
    expect(signedAmount('expense', '12.50')).toBe('-12.5');
    expect(signedAmount('transfer_out', '3')).toBe('-3');
    expect(signedAmount('income', '12.50')).toBe('12.5');
    expect(signedAmount('refund', '2.00')).toBe('2');
    expect(signedAmount('transfer_in', '7')).toBe('7');
    expect(balance('-1000.00', ['-12.5', '2', '500'], 'CNY')).toBe('-510.50');
    expect(balance('0', ['1500', '-300'], 'JPY')).toBe('1200');
    expect(negate('-0.5')).toBe('0.5');
    expect([compare('1.10', '1.1'), compare('2', '10'), compare('0.3', '0.29')]).toEqual([0, -1, 1]);
  });
  it('refuses to format a value that would lose precision', () => {
    expect(() => formatAmount('1.005', 'USD')).toThrow(/Invariant/);
    expect(() => formatAmount('1.5', 'JPY')).toThrow(/Invariant/);
  });
});

describe('exchange rates', () => {
  it.each(conversions)('%s %s × %s → %s %s', (amount, from, rate, to, expected) =>
    expect(convert(amount, from, rate, to)).toBe(expected),
  );
  it('requires a rate of exactly 1 within one currency', () =>
    expect(() => convert('1.00', 'USD', '1.01', 'USD')).toThrow(code('INVALID_RATE')));
  it.each(crossRates)('cross rate %s / %s', (from, to, expected) => expect(crossRate(from, to)).toBe(expected));
  it('validates rates and rejects unrepresentable cross rates', () => {
    expect(parseRate('0.000000000000000001')).toBe('0.000000000000000001');
    expect(parseRate('7.200')).toBe('7.2');
    for (const [rate, error] of [
      ['0', 'INVALID_RATE'],
      ['-1', 'INVALID_RATE'],
      ['1e-3', 'INVALID_RATE'],
      ['0.0000000000000000001', 'RATE_PRECISION'],
      ['100000000000000000000', 'RATE_OUT_OF_RANGE'],
    ] as const) {
      expect(() => parseRate(rate), rate).toThrow(code(error));
    }
    expect(() => crossRate('10000000000000000000', '0.000000000000000001')).toThrow(code('RATE_UNDERFLOW'));
  });
});
