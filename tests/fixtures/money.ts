// Multi-currency boundary fixtures (M2-MODEL). Used by unit tests and by the MySQL integration suite,
// so the same values are proven both in decimal arithmetic and in DECIMAL(24,6) / DECIMAL(38,18) storage.
export const accepted = [
  // [input, currency, canonical]
  ['1500', 'JPY', '1500'],
  ['12', 'USD', '12.00'],
  ['12.5', 'CNY', '12.50'],
  ['0.01', 'HKD', '0.01'],
  ['1.234', 'KWD', '1.234'],
  ['0.001', 'KWD', '0.001'],
  ['999999999999999999', 'JPY', '999999999999999999'],
  ['999999999999999999.99', 'USD', '999999999999999999.99'],
  ['999999999999999999.999', 'KWD', '999999999999999999.999'],
] as const;

export const rejected = [
  // [input, currency, error code]
  ['1500.5', 'JPY', 'AMOUNT_PRECISION'],
  ['0.001', 'USD', 'AMOUNT_PRECISION'],
  ['1.2345', 'KWD', 'AMOUNT_PRECISION'],
  ['1000000000000000000', 'JPY', 'AMOUNT_OUT_OF_RANGE'],
  ['0', 'USD', 'AMOUNT_NOT_POSITIVE'],
  ['0.00', 'CNY', 'AMOUNT_NOT_POSITIVE'],
  ['-5.00', 'CNY', 'AMOUNT_NOT_POSITIVE'],
  ['1e3', 'USD', 'INVALID_AMOUNT'],
  ['01.00', 'USD', 'INVALID_AMOUNT'],
  ['1.', 'USD', 'INVALID_AMOUNT'],
  ['.5', 'USD', 'INVALID_AMOUNT'],
  [' 1.00', 'USD', 'INVALID_AMOUNT'],
  ['+1.00', 'USD', 'INVALID_AMOUNT'],
  ['NaN', 'USD', 'INVALID_AMOUNT'],
  ['10.00', 'GBP', 'UNSUPPORTED_CURRENCY'],
] as const;

export const conversions = [
  // [amount, from, rate (to per 1 from), to, expected] — HALF_EVEN at the target's minor units
  ['10.00', 'USD', '7.2', 'CNY', '72.00'],
  ['0.05', 'CNY', '2.5', 'HKD', '0.12'], // 0.125 → 0.12 (even)
  ['0.05', 'CNY', '2.7', 'HKD', '0.14'], // 0.135 → 0.14 (even)
  ['1.00', 'USD', '149.5', 'JPY', '150'], // 149.5 → 150 (even)
  ['1.00', 'USD', '150.5', 'JPY', '150'], // 150.5 → 150 (even)
  ['1.000', 'KWD', '3.2551', 'USD', '3.26'],
  ['100000', 'JPY', '0.002031', 'KWD', '203.100'],
  ['999999999999999999.99', 'USD', '0.000000000000000001', 'CNY', '1.00'],
  ['12.34', 'HKD', '1', 'HKD', '12.34'],
] as const;

export const crossRates = [
  // [R(from) per pivot, R(to) per pivot, expected from→to]
  ['7.2', '150', '20.833333333333333333'],
  ['150', '7.2', '0.048'],
  ['1', '0.000000000000000001', '0.000000000000000001'],
  ['3', '1', '0.333333333333333333'],
] as const;
