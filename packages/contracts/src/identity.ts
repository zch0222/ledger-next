import { z } from 'zod';
import { Currency, Role, ScopeSchema, Timestamp, Timezone, input, resource, uuid } from './common';

export { uuid };
export const roleSchema = Role;
export const ledgerInput = input('LedgerCreate', z.object({
  name: z.string().trim().min(1).max(80),
  baseCurrency: Currency,
  timezone: Timezone,
}).strict());
export const ledgerPatch = input('LedgerUpdate', z.object({ name: z.string().trim().min(1).max(80) }).strict());
export const memberInput = input('MembershipCreate', z.object({ email: z.email().max(255).transform(s => s.toLowerCase()), role: roleSchema }).strict(), '只能添加已注册邮箱');
export const memberPatch = input('MembershipUpdate', z.object({ role: roleSchema }).strict());

export const Ledger = resource('Ledger', z.object({ id: uuid, name: z.string(), baseCurrency: Currency, timezone: z.string(), role: Role, version: z.number().int().positive() }));
export const Me = resource('Me', z.object({
  id: uuid, name: z.string(), email: z.email(),
  defaultLedgerId: uuid.nullable(),
  ledgers: z.array(Ledger.schema),
  auth: z.object({ type: z.enum(['session', 'token']), scopes: z.array(ScopeSchema) }),
}));
export const Membership = resource('Membership', z.object({ id: uuid, userId: uuid, name: z.string(), email: z.email(), role: Role, version: z.number().int().positive() }));
export const AuditEvent = resource('AuditEvent', z.object({
  id: uuid, action: z.string(), resourceId: uuid,
  actor: z.object({ id: uuid, name: z.string() }),
  requestId: z.string(), createdAt: Timestamp,
}), '审计事件，不包含密钥、密码或通知凭据');
