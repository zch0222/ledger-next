// RFC 4180 CSV reading / writing for imports and exports. Pure functions; no I/O.

export class CsvError extends Error {
  constructor(
    public row: number,
    message: string,
  ) {
    super(message);
  }
}

/**
 * Parses UTF-8 CSV text (BOM, CRLF / LF, quoted fields with "" escapes). Rows are arrays of raw cell text.
 * More than `maxRows` rows is an error; `stopAfter` returns early (e.g. 1 to read only the header).
 */
export function parseCsv(text: string, maxRows = Infinity, stopAfter = Infinity): string[][] {
  const input = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  let i = 0;
  let line = 1;
  let rowStart = 1;
  const endCell = () => {
    row.push(cell);
    cell = '';
  };
  const endRow = () => {
    endCell();
    if (!(row.length === 1 && row[0] === '')) {
      if (rows.length >= maxRows) throw new CsvError(rowStart, `超过 ${maxRows} 行上限`);
      rows.push(row);
    }
    row = [];
    rowStart = line;
  };
  while (i < input.length) {
    const c = input[i];
    if (quoted) {
      if (c === '"') {
        if (input[i + 1] === '"') {
          cell += '"';
          i += 2;
          continue;
        }
        quoted = false;
        i++;
        if (i < input.length && ![',', '\n', '\r'].includes(input[i])) {
          throw new CsvError(line, '引号字段后存在多余字符');
        }
        continue;
      }
      if (c === '\n') line++;
      cell += c;
      i++;
      continue;
    }
    if (c === '"') {
      if (cell !== '') throw new CsvError(line, '未加引号的字段中出现引号');
      quoted = true;
      i++;
      continue;
    }
    if (c === ',') {
      endCell();
      i++;
      continue;
    }
    if (c === '\r' || c === '\n') {
      line++;
      endRow();
      if (rows.length >= stopAfter) return rows;
      i += c === '\r' && input[i + 1] === '\n' ? 2 : 1;
      continue;
    }
    cell += c;
    i++;
  }
  if (quoted) throw new CsvError(line, '引号未闭合');
  if (cell !== '' || row.length) endRow();
  return rows;
}

const FORMULA = /^[=+\-@\t\r]/;
/** Spreadsheet formula injection guard: cells starting with = + - @ TAB CR get a leading apostrophe. */
export const escapeFormula = (value: string) => (FORMULA.test(value) ? `'${value}` : value);
/** Reverses escapeFormula for re-imported exports. */
export const unescapeFormula = (value: string) =>
  value.startsWith("'") && FORMULA.test(value.slice(1)) ? value.slice(1) : value;
const quote = (value: string) => (/[",\r\n]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value);
export const csvLine = (cells: readonly (string | null | undefined)[]) =>
  cells.map(v => quote(escapeFormula(v ?? ''))).join(',');

/** Amount cell → plain decimal text: trims, drops a leading "+" and thousands separators of the form 1,234,567.89. */
export function normalizeAmountCell(raw: string) {
  const value = raw.trim().replace(/^\+/, '');
  if (/^-?\d{1,3}(,\d{3})+(\.\d+)?$/.test(value)) return value.replaceAll(',', '');
  return value;
}
const DATE_FORMATS = {
  'YYYY-MM-DD': /^(?<y>\d{4})-(?<m>\d{1,2})-(?<d>\d{1,2})$/,
  'YYYY/MM/DD': /^(?<y>\d{4})\/(?<m>\d{1,2})\/(?<d>\d{1,2})$/,
  'DD/MM/YYYY': /^(?<d>\d{1,2})\/(?<m>\d{1,2})\/(?<y>\d{4})$/,
  'MM/DD/YYYY': /^(?<m>\d{1,2})\/(?<d>\d{1,2})\/(?<y>\d{4})$/,
} as const;
export type DateFormat = keyof typeof DATE_FORMATS;
/** Date cell in the mapped format → YYYY-MM-DD, or null for impossible dates such as 2026-02-30. */
export function normalizeDateCell(raw: string, format: DateFormat) {
  const groups = DATE_FORMATS[format].exec(raw.trim())?.groups;
  if (!groups) return null;
  const y = Number(groups.y);
  const m = Number(groups.m);
  const d = Number(groups.d);
  const date = new Date(Date.UTC(y, m - 1, d));
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d || y < 1970 || y > 2999) {
    return null;
  }
  return date.toISOString().slice(0, 10);
}
const KINDS: Record<string, 'expense' | 'income' | 'transfer' | 'refund'> = {
  expense: 'expense',
  支出: 'expense',
  income: 'income',
  收入: 'income',
  transfer: 'transfer',
  转账: 'transfer',
  refund: 'refund',
  退款: 'refund',
};
export const normalizeKindCell = (raw: string) => KINDS[raw.trim().toLowerCase()] ?? null;
