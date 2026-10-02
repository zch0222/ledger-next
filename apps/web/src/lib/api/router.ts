import { createHash, randomUUID } from 'node:crypto';
import { uuid } from '../../../../../packages/contracts/src/common';
import { matchOperation, pathParams, type StableOperationId } from '../../../../../packages/contracts/src/operations';
import { validateIdempotencyKey } from '../../../../../packages/domain/src/idempotency';
import { hasIdempotencyRecord, withIdempotency } from '../../../../../packages/domain/src/idempotent';
import { approvalReason, consumeApproval, createApproval } from '../../../../../packages/domain/src/agents';
import { DomainError } from '../../../../../packages/domain/src/policy';
import { IMPORT_MAX_BYTES } from '../../../../../packages/domain/src/imports';
import { attachment, body, context, failure, json, upload, writeGuard } from '../http';
import { handlers } from './handlers';

// REST order (TECHNICAL_DESIGN §3): authenticate → match the contract → validate → use case → DTO.
// Every path and method comes from the OpenAPI registry; planned operations answer 501 until implemented.
export async function handle(request: Request, route: { params: Promise<{ segments: string[] }> }) {
  let requestId: string = randomUUID();
  try {
    const ctx = await context(request.headers);
    requestId = ctx.requestId;
    const path = `/${(await route.params).segments.join('/')}`;
    const match = matchOperation(request.method, path);
    if (match.kind === 'none') throw new DomainError(404, 'NOT_FOUND', '资源不存在');
    if (match.kind === 'method') throw new DomainError(405, 'METHOD_NOT_ALLOWED', '该资源不支持此请求方法', { Allow: match.allow.join(', ') });
    const { operation, params } = match;
    // Malformed IDs are indistinguishable from resources the caller cannot see.
    if (pathParams(operation.path).some(name => !uuid.safeParse(params[name]).success)) throw new DomainError(404, 'NOT_FOUND', '资源不存在');
    // Tokens: session-only operations are refused, scopes must cover the operation, other ledgers do not exist.
    if (ctx.auth.type === 'token') {
      if (operation.scopes === null) throw new DomainError(403, 'SESSION_REQUIRED', '该操作只能在网页登录后进行');
      const missing = operation.scopes.filter(scope => !(ctx.auth as { scopes: string[] }).scopes.includes(scope));
      if (missing.length) throw new DomainError(403, 'INSUFFICIENT_SCOPE', `令牌缺少作用域：${missing.join(', ')}`, { 'WWW-Authenticate': `Bearer error="insufficient_scope", scope="${operation.scopes.join(' ')}"` });
      if (params.ledgerId && !ctx.auth.ledgerIds.includes(params.ledgerId)) throw new DomainError(404, 'NOT_FOUND', '资源不存在');
    }
    if (request.method !== 'GET') writeGuard(request, operation.body ? operation.bodyType ?? 'application/json' : null, ctx.auth.type === 'session');
    if (operation.stability !== 'stable') throw new DomainError(501, 'NOT_IMPLEMENTED', `该接口已在契约中发布，计划于 ${operation.milestone} 实现`);
    const query = operation.query ? operation.query.parse(Object.fromEntries(new URL(request.url).searchParams)) : {};
    const payload = !operation.body ? undefined : operation.bodyType === 'multipart/form-data' ? await upload(request, IMPORT_MAX_BYTES) : await body(request);
    const input = { ctx, params, query, request, operationId: operation.id, body: payload };
    const handler = handlers[operation.id as StableOperationId];
    const key = operation.idempotency ? validateIdempotencyKey(request.headers.get('idempotency-key'), operation.idempotency) : null;
    const undo = await approvalGate(ctx, operation.id, operation.summary, params.ledgerId, request, `/api/v1${path}`, operation.bodyType === 'multipart/form-data' ? null : payload, key);
    try { return await run(); } catch (error) { await undo?.(); throw error; }
    async function run() {
    if (key) {
      // An upload is fingerprinted by its file digest, not its bytes.
      const fingerprint = operation.bodyType === 'multipart/form-data' && payload ? { ...(payload as { fileName: string; content: string; mapping: string }), content: createHash('sha256').update((payload as { content: string }).content).digest('hex') } : input.body;
      const result = await withIdempotency({ actorId: ctx.userId, method: request.method, path: `/api/v1${path}`, key, body: fingerprint }, async db => {
        const response = await handler(input, db);
        return { ...response, headers: response.headers ?? {} };
      });
      return json(result.data, requestId, result.status, { ...result.headers, ...(result.replayed ? { 'Idempotent-Replayed': 'true' } : {}) });
    }
    const result = await handler(input);
    if (result.file) return attachment(result.file.content, result.file.name, result.file.type, requestId);
    return json(result.data, requestId, result.status, result.headers, result.page);
    }
  } catch (error) { return failure(error, requestId); }
}

/**
 * High-impact writes made with a token need a Web approval (TECHNICAL_DESIGN §8, API_AGENT_CONTRACT §4.3). Without
 * X-Approval-Id the request is refused and — if the token may request approvals — an approval bound to this exact
 * request is created and returned. With it, the approval is consumed (undone if the write then fails). A retry of
 * an already completed write (same Idempotency-Key) is replayed without a second approval.
 */
async function approvalGate(ctx: Awaited<ReturnType<typeof context>>, operationId: string, summary: string, ledgerId: string | undefined, request: Request, path: string, payload: unknown, key: string | null) {
  if (ctx.auth.type !== 'token' || request.method === 'GET' || !ledgerId) return null;
  const reason = await approvalReason(operationId, ledgerId, payload);
  if (!reason) return null;
  if (key && await hasIdempotencyRecord({ actorId: ctx.userId, method: request.method, path, key })) return null;
  const approvalId = request.headers.get('x-approval-id');
  if (!approvalId) {
    const approval = ctx.auth.scopes.includes('approvals:write')
      ? await createApproval(ctx, ledgerId, { method: request.method, path, body: (payload ?? null) as Record<string, unknown> | null, summary: `${summary}（由令牌发起）`, reason })
      : null;
    throw new DomainError(403, 'APPROVAL_REQUIRED', `${reason}${approval ? '：已创建审批，请账本所有者在网页端批准后携带 X-Approval-Id 重试' : '：令牌没有 approvals:write，无法发起审批'}`, {}, undefined,
      approval ? { approval: { id: approval.id, approvalUrl: approval.approvalUrl, expiresAt: approval.expiresAt } } : undefined);
  }
  return consumeApproval(ctx, ledgerId, approvalId, { method: request.method, path, body: payload ?? null });
}
