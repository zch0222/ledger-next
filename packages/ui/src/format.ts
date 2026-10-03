// Display formatting for decimal-string amounts. Never parses money into JS numbers: grouping is done on the text.
const SYMBOLS: Record<string, string> = { CNY: '¥', USD: '$', HKD: 'HK$', EUR: '€', JPY: '¥', KWD: 'KD' };

/** "-1234567.5" → "-1,234,567.5" */
export function groupDigits(value: string) {
  const negative = value.startsWith('-');
  const body = negative ? value.slice(1) : value;
  const [int, frac] = body.split('.');
  const grouped = int.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${negative ? '-' : ''}${grouped}${frac !== undefined ? `.${frac}` : ''}`;
}
/**
 * Money for display. `symbol` (default) gives "¥1,234.50"; `code` gives "CNY 1,234.50" for original amounts
 * whose currency must be unambiguous. `sign` adds + / − (real minus sign) so direction never relies on colour.
 */
export function formatMoney(
  amount: string,
  currency: string,
  options: { style?: 'symbol' | 'code'; sign?: 'auto' | 'always' | 'never' } = {},
) {
  const negative = amount.startsWith('-');
  const digits = groupDigits(negative ? amount.slice(1) : amount);
  const body = options.style === 'code' ? `${currency} ${digits}` : `${SYMBOLS[currency] ?? `${currency} `}${digits}`;
  const sign = options.sign ?? 'auto';
  if (sign === 'never') return body;
  if (negative) return `−${body}`;
  return sign === 'always' && !/^0(\.0+)?$/.test(amount) ? `+${body}` : body;
}
/** "2026-10-02" → "10 月 2 日"; with year when it differs from `today`. */
export function formatDate(date: string, today?: string) {
  const [y, m, d] = date.split('-').map(Number);
  return `${today && today.slice(0, 4) !== date.slice(0, 4) ? `${y} 年 ` : ''}${m} 月 ${d} 日`;
}
/** Ratio string "0.8333" → "83%". */
export const formatPercent = (ratio: string, digits = 0) => `${(Number(ratio) * 100).toFixed(digits)}%`;
export const KIND_LABELS = { expense: '支出', income: '收入', transfer: '转账', refund: '退款' } as const;
export const FRESHNESS_LABELS = {
  fresh: '实时',
  delayed: '更新延迟',
  stale: '已过期',
  market_closed: '最近报价',
  missing: '暂无汇率',
  manual: '人工汇率',
} as const;
export const ROLE_LABELS = { owner: '所有者', editor: '可编辑', viewer: '仅查看' } as const;
export const ACCOUNT_TYPE_LABELS = {
  cash: '现金',
  bank: '银行账户',
  credit_card: '信用卡',
  e_wallet: '电子钱包',
  investment: '投资',
  other: '其他',
} as const;
