import { z } from 'zod';

// Request components are converted with io=input (defaults optional), responses with io=output.
// Schemas registered in both must not use defaults or transforms, or the two renderings would differ.
export const requests = z.registry<{ id: string; description?: string }>();
export const responses = z.registry<{ id: string; description?: string }>();
export function input<T extends z.ZodType>(id: string, schema: T, description?: string) { requests.add(schema, { id, description }); return schema; }
export function output<T extends z.ZodType>(id: string, schema: T, description?: string) { responses.add(schema, { id, description }); return schema; }
export function shared<T extends z.ZodType>(id: string, schema: T, description?: string) { input(id, schema, description); return output(id, schema, description); }

// ISO 4217 minor units; mirrors the seed in migration 0003. KWD (3 decimals) is defined for precision coverage but not enabled.
export const CURRENCY_TABLE = {
  CNY: { minorUnits: 2, enabled: true }, USD: { minorUnits: 2, enabled: true }, HKD: { minorUnits: 2, enabled: true },
  EUR: { minorUnits: 2, enabled: true }, JPY: { minorUnits: 0, enabled: true }, KWD: { minorUnits: 3, enabled: false },
} as const;
export type CurrencyCode = keyof typeof CURRENCY_TABLE;
export const ENABLED_CURRENCIES = ['CNY', 'USD', 'HKD', 'EUR', 'JPY'] as const satisfies readonly CurrencyCode[];
export const uuid = z.uuid();
export const Currency = shared('Currency', z.enum(ENABLED_CURRENCIES), 'ISO 4217 大写币种；首发启用 CNY/USD/HKD/EUR/JPY');
export const Decimal = shared('Decimal', z.string().regex(/^-?(0|[1-9]\d{0,17})(\.\d{1,6})?$/), '十进制字符串金额；服务端按币种 minor units 拒绝多余精度，不截断');
export const Rate = shared('Rate', z.string().regex(/^(0|[1-9]\d{0,19})(\.\d{1,18})?$/), '十进制字符串汇率，最多 18 位小数');
export const Money = shared('Money', z.object({ amount: Decimal, currency: Currency }).strict());
export const Timestamp = z.iso.datetime().meta({ description: 'RFC 3339 UTC 时间' });
export const LocalDate = z.iso.date().meta({ description: '业务日期 YYYY-MM-DD，按账本 / 订阅时区解释' });
export const LocalTime = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).meta({ description: '本地时间 HH:mm' });
export const Timezone = z.string().max(64).refine(value => { try { new Intl.DateTimeFormat('en', { timeZone: value }); return true; } catch { return false; } }, '无效的 IANA 时区').meta({ description: 'IANA 时区名' });
export const Role = shared('Role', z.enum(['owner', 'editor', 'viewer']));
export const Freshness = shared('Freshness', z.enum(['fresh', 'delayed', 'stale', 'market_closed', 'missing', 'manual']), '汇率新鲜度：fresh ≤120s；delayed ≤15min；stale 更久或持续失败');

export const SCOPES = [
  'ledgers:read', 'accounts:read', 'accounts:write', 'categories:read', 'categories:write',
  'transactions:read', 'transactions:write', 'subscriptions:read', 'subscriptions:write',
  'budgets:read', 'budgets:write', 'reports:read', 'fx:read', 'fx:write', 'reminders:read', 'reminders:write',
  'notifications:read', 'notifications:write', 'exports:read', 'approvals:write',
] as const;
export type Scope = (typeof SCOPES)[number];
export const ScopeSchema = shared('Scope', z.enum(SCOPES), 'PAT 作用域；Web Session 拥有全部作用域，仍受账本角色限制');

export const Meta = output('Meta', z.object({ requestId: uuid }));
export const Page = output('Page', z.object({ nextCursor: z.string().nullable(), hasMore: z.boolean() }), 'nextCursor 为不透明字符串，绑定用户、资源与筛选条件');
export const Problem = output('Problem', z.object({
  type: z.string(), title: z.string(), status: z.number().int(), code: z.string(), detail: z.string().optional(), requestId: z.string(),
  errors: z.array(z.object({ path: z.string(), message: z.string(), code: z.string().optional() })).optional(),
  approval: z.object({ id: z.uuid(), approvalUrl: z.string(), expiresAt: z.iso.datetime() }).optional().meta({ description: 'APPROVAL_REQUIRED：已为本请求创建的审批；批准后携带 X-Approval-Id 重试' }),
}), 'RFC 9457 problem+json；code 为稳定机器码，title 为可展示说明');

// Envelopes: single {data, meta}; list {data[], page, meta}.
export function resource<T extends z.ZodType>(id: string, schema: T, description?: string) {
  output(id, schema, description);
  return {
    schema,
    single: output(`${id}Response`, z.object({ data: schema, meta: Meta })),
    list: output(`${id}List`, z.object({ data: z.array(schema), page: Page, meta: Meta })),
  };
}

export const Limit = z.coerce.number().int().min(1).max(100).default(50).meta({ description: '每页条数，默认 50，最多 100' });
export const Cursor = z.string().max(512).meta({ description: '上一页返回的 nextCursor；篡改或与筛选条件不符返回 400' });
export const pageQuery = { limit: Limit, cursor: Cursor.optional() };
export const QueryBoolean = z.enum(['true', 'false']).default('false').transform(value => value === 'true');
