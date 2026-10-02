import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { and, asc, desc, eq, gt, inArray, like, lt, or, sql } from 'drizzle-orm';
import { ApiTokenCreate, ApprovalQuery, ApprovalRequestCreate, ApprovalRequestUpdate } from '../../contracts/src/platform';
import { matchOperation } from '../../contracts/src/operations';
import { database, type Executor, type Tx } from '../../db/src/index';
import { apiTokens, approvalRequests, idempotencyRecords, ledgers, memberships, user, writePreviews } from '../../db/src/schema';
import { ledgerAccess } from './access';
import { audit } from './audit';
import type { AuthContext, Keyset } from './identity';
import { sum } from './money';
import { DomainError, requireVersion } from './policy';

// M6-SERVER: personal access tokens, approval requests for high-impact Agent writes, and operation lookups.
// A token acts as its user (ledger roles still apply) narrowed to its scopes and ledgers; only its SHA-256 is stored.
export type TokenAuth = { type: 'token'; tokenId: string; scopes: string[]; ledgerIds: string[] };
export type Auth = { type: 'session'; sessionCreatedAt?: Date } | TokenAuth;
const TOKEN_PREFIX = 'lnp_', APPROVAL_TTL_MS = 24 * 3600 * 1000, REAUTH_MS = 15 * 60 * 1000;
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const appUrl = () => (process.env.APP_URL ?? 'http://localhost:3000').replace(/\/$/, '');
/** Canonical JSON (sorted keys) so the same body always hashes the same, whatever the key order. */
export function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map(k => `${JSON.stringify(k)}:${canonical((value as Record<string, unknown>)[k])}`).join(',')}}`;
  return JSON.stringify(value ?? null);
}
export const bodyHash = (body: unknown) => hash(canonical(body ?? null));

// ---------- tokens ----------

type TokenRow = typeof apiTokens.$inferSelect;
export const presentToken = (row: TokenRow) => ({ id: row.id, name: row.name, prefix: row.prefix, scopes: row.scopes as string[], ledgerIds: row.ledgerIds as string[], expiresAt: row.expiresAt.toISOString(),
  lastUsedAt: row.lastUsedAt?.toISOString() ?? null, revokedAt: row.revokedAt?.toISOString() ?? null, createdAt: row.createdAt.toISOString() });

/** Issues a token (shown once). Requires a Web session signed in within the last 15 minutes. */
export async function createToken(ctx: AuthContext & { auth?: Auth }, body: unknown, now = new Date()) {
  const input = ApiTokenCreate.parse(body);
  if (ctx.auth?.type !== 'session') throw new DomainError(403, 'SESSION_REQUIRED', '只能在网页登录状态下签发令牌');
  if (!ctx.auth.sessionCreatedAt || now.getTime() - ctx.auth.sessionCreatedAt.getTime() > REAUTH_MS) throw new DomainError(403, 'REAUTH_REQUIRED', '为安全起见，请重新输入密码后再签发令牌');
  const ledgerIds = [...new Set(input.ledgerIds)];
  const member = await database().select({ ledgerId: memberships.ledgerId }).from(memberships).where(and(eq(memberships.userId, ctx.userId), inArray(memberships.ledgerId, ledgerIds)));
  if (member.length !== ledgerIds.length) throw new DomainError(422, 'VALIDATION_ERROR', '请检查输入字段', {}, [{ path: 'ledgerIds', message: '只能授权你参与的账本' }]);
  const token = `${TOKEN_PREFIX}${randomBytes(32).toString('base64url')}`;
  const row: TokenRow = { id: randomUUID(), userId: ctx.userId, name: input.name, tokenHash: hash(token), prefix: token.slice(0, 12), scopes: [...new Set(input.scopes)].sort(), ledgerIds,
    expiresAt: new Date(now.getTime() + input.expiresInDays * 86400_000), revokedAt: null, lastUsedAt: null, createdAt: now };
  await database().transaction(async tx => {
    await tx.insert(apiTokens).values(row);
    for (const ledgerId of ledgerIds) await audit(tx, ctx, ledgerId, 'api_token.created', row.id);
  });
  return { ...presentToken(row), token };
}
export async function listTokens(ctx: AuthContext, page: Keyset) {
  const after = page.after && or(lt(apiTokens.createdAt, new Date(page.after[0])), and(eq(apiTokens.createdAt, new Date(page.after[0])), lt(apiTokens.id, page.after[1])));
  return database().select().from(apiTokens).where(and(eq(apiTokens.userId, ctx.userId), after)).orderBy(desc(apiTokens.createdAt), desc(apiTokens.id)).limit(page.limit + 1);
}
/** Revocation takes effect on the next request: every request re-reads the token row. */
export async function revokeToken(ctx: AuthContext, id: string, now = new Date()) {
  const [row] = await database().select().from(apiTokens).where(and(eq(apiTokens.id, id), eq(apiTokens.userId, ctx.userId)));
  if (!row) throw new DomainError(404, 'NOT_FOUND', '令牌不存在');
  if (row.revokedAt) return;
  await database().transaction(async tx => {
    await tx.update(apiTokens).set({ revokedAt: now }).where(eq(apiTokens.id, id));
    for (const ledgerId of row.ledgerIds as string[]) await audit(tx, ctx, ledgerId, 'api_token.revoked', id);
  });
}
/** Bearer authentication: unknown, expired and revoked tokens are all the same 401. */
export async function resolveToken(raw: string, now = new Date()) {
  const invalid = new DomainError(401, 'INVALID_TOKEN', '令牌无效、已过期或已撤销', { 'WWW-Authenticate': 'Bearer error="invalid_token"' });
  if (!raw.startsWith(TOKEN_PREFIX) || raw.length > 128) throw invalid;
  const [row] = await database().select({ token: apiTokens, user }).from(apiTokens).innerJoin(user, eq(user.id, apiTokens.userId)).where(eq(apiTokens.tokenHash, hash(raw)));
  if (!row || row.token.revokedAt || row.token.expiresAt <= now) throw invalid;
  if (!row.token.lastUsedAt || now.getTime() - row.token.lastUsedAt.getTime() > 60_000) await database().update(apiTokens).set({ lastUsedAt: now }).where(eq(apiTokens.id, row.token.id));
  return { userId: row.user.id, user: { name: row.user.name, email: row.user.email }, auth: { type: 'token' as const, tokenId: row.token.id, scopes: row.token.scopes as string[], ledgerIds: row.token.ledgerIds as string[] } };
}

// ---------- approvals ----------

type ApprovalRow = typeof approvalRequests.$inferSelect;
const presentApproval = (row: ApprovalRow, requester: { id: string; name: string }) => ({
  id: row.id, status: row.status !== 'pending' || row.expiresAt > new Date() ? row.status : 'expired' as const, operation: { method: row.method, path: row.path, bodyHash: row.bodyHash },
  summary: row.summary, reason: row.reason, requestedBy: { id: requester.id, name: requester.name, via: row.via }, decidedBy: row.decidedBy, decidedAt: row.decidedAt?.toISOString() ?? null,
  expiresAt: row.expiresAt.toISOString(), approvalUrl: `${appUrl()}/ledgers/${row.ledgerId}/agents?approval=${row.id}`, version: row.version, createdAt: row.createdAt.toISOString(),
});
async function withRequester(rows: ApprovalRow[]) {
  const ids = [...new Set(rows.map(r => r.requestedBy))];
  const people = new Map(ids.length ? (await database().select({ id: user.id, name: user.name }).from(user).where(inArray(user.id, ids))).map(p => [p.id, p]) : []);
  return rows.map(r => presentApproval(r, people.get(r.requestedBy) ?? { id: r.requestedBy, name: '' }));
}

/** Records a request for a specific write; the hash binds the approval to exactly this method, path and body. */
export async function createApproval(ctx: AuthContext & { auth?: Auth }, ledgerId: string, body: unknown, now = new Date(), db: Executor | Tx = database()) {
  const input = ApprovalRequestCreate.parse(body);
  await ledgerAccess(db, ctx, ledgerId, 'editor');
  const path = input.path.split('?')[0];
  const match = matchOperation(input.method, path.replace(/^\/api\/v1/, ''));
  if (!path.startsWith(`/api/v1/ledgers/${ledgerId}/`) || match.kind !== 'match' || match.operation.method === 'get')
    throw new DomainError(422, 'VALIDATION_ERROR', '请检查输入字段', {}, [{ path: 'path', message: '只能为本账本内的写入接口申请审批' }]);
  const row: ApprovalRow = { id: randomUUID(), ledgerId, status: 'pending', method: input.method, path, bodyHash: bodyHash(input.body), summary: input.summary, reason: input.reason ?? null,
    requestedBy: ctx.userId, via: ctx.auth?.type ?? 'session', tokenId: ctx.auth?.type === 'token' ? ctx.auth.tokenId : null, decidedBy: null, decidedAt: null, decisionNote: null,
    expiresAt: new Date(now.getTime() + APPROVAL_TTL_MS), consumedAt: null, version: 1, createdAt: now };
  await db.insert(approvalRequests).values(row);
  const [requester] = await db.select({ id: user.id, name: user.name }).from(user).where(eq(user.id, ctx.userId));
  return presentApproval(row, requester);
}
export async function listApprovals(ctx: AuthContext, ledgerId: string, query: unknown, page: Keyset) {
  const q = ApprovalQuery.partial().parse(query);
  await ledgerAccess(database(), ctx, ledgerId, 'owner');
  const after = page.after && or(lt(approvalRequests.createdAt, new Date(page.after[0])), and(eq(approvalRequests.createdAt, new Date(page.after[0])), lt(approvalRequests.id, page.after[1])));
  const now = new Date();
  const status = q.status === 'expired' ? and(eq(approvalRequests.status, 'pending'), lt(approvalRequests.expiresAt, now)) : q.status === 'pending' ? and(eq(approvalRequests.status, 'pending'), gt(approvalRequests.expiresAt, now)) : q.status ? eq(approvalRequests.status, q.status) : undefined;
  const rows = await database().select().from(approvalRequests).where(and(eq(approvalRequests.ledgerId, ledgerId), status, after)).orderBy(desc(approvalRequests.createdAt), desc(approvalRequests.id)).limit(page.limit + 1);
  return (await withRequester(rows)).map((p, i) => ({ ...p, createdAtDate: rows[i].createdAt }));
}
export async function getApproval(ctx: AuthContext, ledgerId: string, id: string) {
  await ledgerAccess(database(), ctx, ledgerId, 'viewer');
  const [row] = await database().select().from(approvalRequests).where(and(eq(approvalRequests.ledgerId, ledgerId), eq(approvalRequests.id, id)));
  // Requesters see their own requests; owners see all of the ledger's.
  const role = (await ledgerAccess(database(), ctx, ledgerId, 'viewer')).role;
  if (!row || (row.requestedBy !== ctx.userId && role !== 'owner')) throw new DomainError(404, 'NOT_FOUND', '审批不存在或你没有访问权限');
  return (await withRequester([row]))[0];
}
/** Owner decision in the Web UI (session only — enforced by the operation having no token scopes). */
export async function decideApproval(ctx: AuthContext, ledgerId: string, id: string, body: unknown, etag: string | null, now = new Date()) {
  const input = ApprovalRequestUpdate.parse(body);
  return database().transaction(async tx => {
    await ledgerAccess(tx, ctx, ledgerId, 'owner', true);
    const [row] = await tx.select().from(approvalRequests).where(and(eq(approvalRequests.ledgerId, ledgerId), eq(approvalRequests.id, id))).for('update');
    if (!row) throw new DomainError(404, 'NOT_FOUND', '审批不存在或你没有访问权限');
    requireVersion(etag, row.version);
    if (row.status !== 'pending' || row.expiresAt <= now) throw new DomainError(409, 'APPROVAL_CLOSED', '该审批已处理或已过期');
    const next = { status: input.decision, decidedBy: ctx.userId, decidedAt: now, decisionNote: input.note ?? null, version: row.version + 1 } as const;
    await tx.update(approvalRequests).set(next).where(eq(approvalRequests.id, id));
    await audit(tx, ctx, ledgerId, `approval.${input.decision}`, id);
    return (await withRequester([{ ...row, ...next }]))[0];
  });
}
/**
 * Uses an approval for the request being executed: it must be approved, unexpired, requested by the same user and
 * match method, path and body hash exactly. Returns an undo for when the write itself then fails.
 */
export async function consumeApproval(ctx: AuthContext, ledgerId: string, id: string, request: { method: string; path: string; body: unknown }, now = new Date()) {
  const refused = (message: string) => new DomainError(403, 'APPROVAL_INVALID', message);
  const [row] = await database().select().from(approvalRequests).where(and(eq(approvalRequests.ledgerId, ledgerId), eq(approvalRequests.id, id)));
  if (!row || row.requestedBy !== ctx.userId) throw refused('审批不存在或不属于当前用户');
  if (row.status !== 'approved') throw refused(row.status === 'pending' ? '审批尚未被批准' : '审批已被拒绝、过期或已使用');
  if (row.expiresAt <= now) throw refused('审批已过期');
  if (row.method !== request.method.toUpperCase() || row.path !== request.path || row.bodyHash !== bodyHash(request.body)) throw refused('请求内容与审批不一致：批准不能换用于其他请求');
  const [result] = await database().update(approvalRequests).set({ status: 'consumed', consumedAt: now, version: sql`${approvalRequests.version} + 1` }).where(and(eq(approvalRequests.id, id), eq(approvalRequests.status, 'approved')));
  if (!(result as { affectedRows: number }).affectedRows) throw refused('审批已被使用');
  return async () => { await database().update(approvalRequests).set({ status: 'approved', consumedAt: null, version: sql`${approvalRequests.version} + 1` }).where(and(eq(approvalRequests.id, id), eq(approvalRequests.status, 'consumed'))); };
}

/** High-impact writes by a token need a Web approval: destructive operations, and money above the threshold. */
const ALWAYS = new Set(['voidTransaction', 'createImportReversal', 'archiveAccount', 'createMembership', 'updateMembership', 'deleteMembership']);
const MONEY = new Set(['createTransaction', 'updateTransaction', 'createRefund', 'createBillPayment']);
export async function approvalReason(operationId: string, ledgerId: string | undefined, body: unknown) {
  if (ALWAYS.has(operationId)) return '作废、撤销导入、归档账户与成员变更由 Agent 发起时需要网页端批准';
  if (!MONEY.has(operationId) || !ledgerId) return null;
  const previewId = (body as { previewId?: unknown } | null)?.previewId;
  if (typeof previewId !== 'string') return null;
  const [preview] = await database().select().from(writePreviews).where(and(eq(writePreviews.id, previewId), eq(writePreviews.ledgerId, ledgerId)));
  if (!preview) return null; // the use case itself reports the missing preview
  const [ledger] = await database().select({ base: ledgers.baseCurrency }).from(ledgers).where(eq(ledgers.id, ledgerId));
  const amount = (preview.computed as { main?: { base?: { amount?: string } } })?.main?.base?.amount;
  const limit = process.env.AGENT_APPROVAL_AMOUNT ?? '10000';
  return amount && sum([amount]).abs().greaterThanOrEqualTo(limit) ? `单笔金额达到 ${limit} ${ledger.base}，由 Agent 发起时需要网页端批准` : null;
}

// ---------- operations ----------

/** The result of an earlier write by the same user (looked up by its Idempotency-Key), for retries after a timeout. */
export async function getOperation(ctx: AuthContext, ledgerId: string, operationId: string) {
  await ledgerAccess(database(), ctx, ledgerId, 'viewer');
  const [row] = await database().select().from(idempotencyRecords).where(and(eq(idempotencyRecords.actorId, ctx.userId), eq(idempotencyRecords.idempotencyKey, operationId), like(idempotencyRecords.path, `/api/v1/ledgers/${ledgerId}/%`)))
    .orderBy(asc(idempotencyRecords.createdAt)).limit(1);
  if (!row) throw new DomainError(404, 'OPERATION_NOT_FOUND', '没有找到使用该幂等键的写入：没有写入发生，可以用同一键安全重试');
  const data = JSON.parse(row.responseBody || 'null') as { id?: string } | null, headers = JSON.parse(row.responseHeaders || '{}') as Record<string, string>;
  const collection = row.path.split('/')[5] ?? 'resource';
  const id = data?.id ?? (data as { transaction?: { id?: string } } | null)?.transaction?.id;
  return {
    id: operationId, type: `${row.method.toLowerCase()} ${collection}`, status: row.responseStatus === 0 ? 'running' as const : row.responseStatus < 400 ? 'succeeded' as const : 'failed' as const,
    resource: id ? { type: collection, id, url: headers.Location ?? `${row.path}${row.method === 'POST' ? `/${id}` : ''}` } : null, error: null, createdAt: row.createdAt.toISOString(), completedAt: row.responseStatus ? row.createdAt.toISOString() : null,
  };
}
