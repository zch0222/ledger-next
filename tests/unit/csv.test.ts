import { describe, expect, it } from 'vitest';
import { CsvError, csvLine, escapeFormula, normalizeAmountCell, normalizeDateCell, normalizeKindCell, parseCsv, unescapeFormula } from '../../packages/domain/src/csv';

describe('CSV reading', () => {
  it('handles BOM, quotes, escaped quotes, embedded newlines and CRLF', () => {
    const text = '﻿日期,备注,金额\r\n2026-10-02,"午餐, 同事 ""请客""",-28.50\r\n2026-10-03,"多行\n备注",12\n\n';
    expect(parseCsv(text)).toEqual([['日期', '备注', '金额'], ['2026-10-02', '午餐, 同事 "请客"', '-28.50'], ['2026-10-03', '多行\n备注', '12']]);
    expect(parseCsv('a,b')).toEqual([['a', 'b']]);
    expect(parseCsv('a,\n,b\r')).toEqual([['a', ''], ['', 'b']]);
    expect(parseCsv('')).toEqual([]);
  });
  it('reports malformed input with a line number and enforces the row limit', () => {
    const error = (text: string, max?: number) => { try { parseCsv(text, max); return null; } catch (e) { return e as CsvError; } };
    expect(error('a,"b\nc')).toMatchObject({ row: 2, message: '引号未闭合' });
    expect(error('a,"b"x\n')).toMatchObject({ row: 1, message: '引号字段后存在多余字符' });
    expect(error('a,b"c\n')).toMatchObject({ message: '未加引号的字段中出现引号' });
    expect(error('h\n1\n2\n3\n', 3)).toMatchObject({ row: 4, message: '超过 3 行上限' });
    expect(error('h\n1\n2\n', 3)).toBeNull();
    expect(parseCsv('h1,h2\n1,"unterminated', Infinity, 1)).toEqual([['h1', 'h2']]); // header only
  });
});

describe('CSV writing', () => {
  it('escapes spreadsheet formulas and quotes separators', () => {
    expect(escapeFormula('=SUM(A1)')).toBe("'=SUM(A1)");
    for (const prefix of ['+', '-', '@', '\t', '\r']) expect(escapeFormula(`${prefix}x`)).toBe(`'${prefix}x`);
    expect(escapeFormula('午餐')).toBe('午餐');
    expect(unescapeFormula("'=SUM(A1)")).toBe('=SUM(A1)');
    expect(unescapeFormula("'quoted")).toBe("'quoted");
    expect(csvLine(['2026-10-02', '=HYPERLINK("x")', 'a,b', null, 'line\nbreak', '12.00'])).toBe(`2026-10-02,"'=HYPERLINK(""x"")","a,b",,"line\nbreak",12.00`);
    // Round trip: what we write parses back to the escaped text, and unescaping restores the original.
    expect(parseCsv(csvLine(['@cmd', '"q"']))[0].map(unescapeFormula)).toEqual(['@cmd', '"q"']);
  });
});

describe('cell normalization', () => {
  it('normalizes amounts with signs and thousands separators', () => {
    expect(normalizeAmountCell(' 1,234,567.89 ')).toBe('1234567.89');
    expect(normalizeAmountCell('-1,234.5')).toBe('-1234.5');
    expect(normalizeAmountCell('+12')).toBe('12');
    expect(normalizeAmountCell('12,34')).toBe('12,34'); // not a thousands pattern: left for validation to reject
  });
  it('parses dates in the mapped format and rejects impossible ones', () => {
    expect(normalizeDateCell('2026-10-02', 'YYYY-MM-DD')).toBe('2026-10-02');
    expect(normalizeDateCell('2026/1/5', 'YYYY/MM/DD')).toBe('2026-01-05');
    expect(normalizeDateCell('05/01/2026', 'DD/MM/YYYY')).toBe('2026-01-05');
    expect(normalizeDateCell('01/05/2026', 'MM/DD/YYYY')).toBe('2026-01-05');
    expect(normalizeDateCell('2026-02-30', 'YYYY-MM-DD')).toBeNull();
    expect(normalizeDateCell('2024-02-29', 'YYYY-MM-DD')).toBe('2024-02-29');
    expect(normalizeDateCell('1969-12-31', 'YYYY-MM-DD')).toBeNull();
    expect(normalizeDateCell('02.10.2026', 'YYYY-MM-DD')).toBeNull();
  });
  it('maps kind labels in Chinese and English', () => {
    expect(normalizeKindCell('支出')).toBe('expense');
    expect(normalizeKindCell(' Income ')).toBe('income');
    expect(normalizeKindCell('转账')).toBe('transfer');
    expect(normalizeKindCell('退款')).toBe('refund');
    expect(normalizeKindCell('other')).toBeNull();
  });
});
