import { randomUUID } from 'node:crypto';
import { uuid } from '../../../../../packages/contracts/src/common';
import { matchOperation, pathParams, type StableOperationId } from '../../../../../packages/contracts/src/operations';
import { validateIdempotencyKey } from '../../../../../packages/domain/src/idempotency';
import { withIdempotency } from '../../../../../packages/domain/src/idempotent';
import { DomainError } from '../../../../../packages/domain/src/policy';
import { body, context, failure, json, writeGuard } from '../http';
import { handlers } from './handlers';

// REST order (TECHNICAL_DESIGN §3): authenticate → match the contract → validate → use case → DTO.
// Every path and method comes from the OpenAPI registry; planned operations answer 501 until implemented.
export async function handle(request: Request, route: { params: Promise<{ segments: string[] }> }) {
  let requestId = randomUUID();
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
    if (request.method !== 'GET') writeGuard(request, Boolean(operation.body));
    if (operation.stability !== 'stable') throw new DomainError(501, 'NOT_IMPLEMENTED', `该接口已在契约中发布，计划于 ${operation.milestone} 实现`);
    const query = operation.query ? operation.query.parse(Object.fromEntries(new URL(request.url).searchParams)) : {};
    const input = { ctx, params, query, request, operationId: operation.id, body: operation.body ? await body(request) : undefined };
    const handler = handlers[operation.id as StableOperationId];
    const key = operation.idempotency ? validateIdempotencyKey(request.headers.get('idempotency-key'), operation.idempotency) : null;
    if (key) {
      const result = await withIdempotency({ actorId: ctx.userId, method: request.method, path: `/api/v1${path}`, key, body: input.body }, async db => {
        const response = await handler(input, db);
        return { ...response, headers: response.headers ?? {} };
      });
      return json(result.data, requestId, result.status, { ...result.headers, ...(result.replayed ? { 'Idempotent-Replayed': 'true' } : {}) });
    }
    const result = await handler(input);
    return json(result.data, requestId, result.status, result.headers, result.page);
  } catch (error) { return failure(error, requestId); }
}
