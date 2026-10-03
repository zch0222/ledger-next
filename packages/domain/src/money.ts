import DecimalJs from 'decimal.js';
import { CURRENCY_TABLE, type CurrencyCode } from '@ledger/contracts/common';
import { DomainError } from './policy';

// All money arithmetic goes through this module. JS numbers never hold amounts: values travel as decimal strings
// (mysql2 runs with decimalNumbers=false) and are combined with a private high-precision Decimal.
const D = DecimalJs.clone({ precision: 64, rounding: DecimalJs.ROUND_HALF_EVEN, toExpNeg: -64, toExpPos: 64 });
type Value = InstanceType<typeof D>;

/** DECIMAL(24,6): at most 18 integer digits. */
export const MONEY_SCALE = 6;
const MONEY_LIMIT = new D('1e18');
/** DECIMAL(38,18): at most 20 integer digits. */
export const RATE_SCALE = 18;
const RATE_LIMIT = new D('1e20');
const PLAIN = /^-?(0|[1-9]\d*)(\.\d+)?$/;

const invalid = (code: string, message: string) => new DomainError(422, code, message);
export function minorUnits(currency: string) {
  const entry = (CURRENCY_TABLE as Record<string, { minorUnits: number }>)[currency];
  if (!entry) throw invalid('UNSUPPORTED_CURRENCY', `不支持的币种 ${currency}`);
  return entry.minorUnits;
}
function decimals(value: string) {
  return value.includes('.') ? value.length - value.indexOf('.') - 1 : 0;
}

/**
 * Validates a user amount against the currency's minor units and returns it in canonical form ("12" USD → "12.00").
 * Excess precision is rejected, never truncated.
 */
export function parseAmount(
  value: string,
  currency: CurrencyCode | string,
  options: { allowZero?: boolean; allowNegative?: boolean } = {},
) {
  const units = minorUnits(currency);
  if (typeof value !== 'string' || !PLAIN.test(value) || value === '-0') {
    throw invalid('INVALID_AMOUNT', '金额须为十进制字符串，例如 "12.50"');
  }
  if (decimals(value) > units) throw invalid('AMOUNT_PRECISION', `${currency} 金额最多 ${units} 位小数`);
  const amount = new D(value).plus(0); // plus(0) folds "-0.00" into 0
  if (amount.abs().gte(MONEY_LIMIT)) throw invalid('AMOUNT_OUT_OF_RANGE', '金额超出可记录范围');
  if (amount.isZero() && !options.allowZero) throw invalid('AMOUNT_NOT_POSITIVE', '金额必须大于 0');
  if (amount.isNegative() && !options.allowNegative) throw invalid('AMOUNT_NOT_POSITIVE', '金额必须大于 0');
  return amount.toFixed(units);
}

/** Validates a positive exchange rate (≤18 decimals, ≤20 integer digits) and returns its canonical string. */
export function parseRate(value: string) {
  if (typeof value !== 'string' || !PLAIN.test(value) || value.startsWith('-')) {
    throw invalid('INVALID_RATE', '汇率须为正的十进制字符串');
  }
  if (decimals(value) > RATE_SCALE) throw invalid('RATE_PRECISION', '汇率最多 18 位小数');
  const rate = new D(value);
  if (rate.isZero()) throw invalid('INVALID_RATE', '汇率必须大于 0');
  if (rate.gte(RATE_LIMIT)) throw invalid('RATE_OUT_OF_RANGE', '汇率超出可记录范围');
  return rate.toFixed();
}

/**
 * Provider market data (may use exponent notation or more than 18 decimals) → canonical DECIMAL(38,18) text.
 * Rounded HALF_EVEN to 18 decimals; non-positive, non-finite or out-of-range values are rejected.
 */
export function normalizeRate(value: string) {
  if (typeof value !== 'string' || !/^\d+(\.\d+)?([eE][+-]?\d+)?$/.test(value)) {
    throw invalid('INVALID_RATE', '汇率须为正的十进制数');
  }
  const rate = new D(value).toDecimalPlaces(RATE_SCALE);
  if (rate.isZero()) throw invalid('RATE_UNDERFLOW', '汇率低于可记录精度');
  if (rate.gte(RATE_LIMIT)) throw invalid('RATE_OUT_OF_RANGE', '汇率超出可记录范围');
  return rate.toFixed();
}
/** Relative change |b − a| / a, for detecting implausible jumps between two provider batches. */
export function relativeChange(previous: string, next: string) {
  return new D(next).minus(previous).abs().dividedBy(previous);
}
export const exceeds = (value: InstanceType<typeof D>, threshold: string) => value.greaterThan(threshold);

/** Formats a stored or computed value with exactly the currency's minor units; precision loss is a bug, so it throws. */
export function formatAmount(value: string | Value, currency: string) {
  const units = minorUnits(currency);
  const amount = new D(value);
  if (!amount.toDecimalPlaces(units).eq(amount)) {
    throw new Error(`Invariant: ${amount.toFixed()} exceeds ${currency} precision`);
  }
  return amount.toFixed(units);
}
/** Value for a DECIMAL(24,6) column. */
export function toColumn(value: string | Value) {
  const amount = new D(value);
  if (!amount.toDecimalPlaces(MONEY_SCALE).eq(amount) || amount.abs().gte(MONEY_LIMIT)) {
    throw new Error(`Invariant: ${amount.toFixed()} does not fit DECIMAL(24,6)`);
  }
  return amount.toFixed(MONEY_SCALE);
}

export function sum(values: readonly (string | Value)[]) {
  return values.reduce<Value>((total, v) => total.plus(v), new D(0));
}
export const negate = (value: string) => new D(value).negated().toFixed();
export const compare = (a: string, b: string) => new D(a).comparedTo(b);

/**
 * amount (fromCurrency) × rate (toCurrency per 1 fromCurrency), rounded HALF_EVEN to the target's minor units.
 * Each transaction is rounded once; reports sum the rounded values so totals equal the detail rows.
 */
export function convert(amount: string, fromCurrency: string, rate: string, toCurrency: string) {
  if (fromCurrency === toCurrency) {
    if (!new D(rate).eq(1)) throw invalid('INVALID_RATE', '同币种汇率必须为 1');
    return formatAmount(amount, toCurrency);
  }
  return new D(amount).times(rate).toDecimalPlaces(minorUnits(toCurrency)).toFixed(minorUnits(toCurrency));
}

/**
 * Cross rate from one provider batch quoted against a pivot P: with R(X) = X per 1 P, U→C = R(C) / R(U).
 * Rounded HALF_EVEN to 18 decimals; a result that rounds to zero cannot be represented and is rejected.
 */
export function crossRate(pivotToFrom: string, pivotToTarget: string) {
  const rate = new D(parseRate(pivotToTarget)).dividedBy(parseRate(pivotToFrom)).toDecimalPlaces(RATE_SCALE);
  if (rate.isZero()) throw invalid('RATE_UNDERFLOW', '交叉汇率低于可记录精度');
  return rate.toFixed();
}

export type PostingKind = 'expense' | 'income' | 'refund' | 'transfer_out' | 'transfer_in';
/** Positive business amount → signed posting: income and refunds add, expenses and outgoing transfers subtract. */
export function signedAmount(kind: PostingKind, amount: string) {
  return kind === 'expense' || kind === 'transfer_out' ? negate(amount) : new D(amount).toFixed();
}

/** Account balance = opening balance + every effective posting, in the account currency. */
export function balance(openingBalance: string, postings: readonly string[], currency: string) {
  return formatAmount(sum([openingBalance, ...postings]), currency);
}
