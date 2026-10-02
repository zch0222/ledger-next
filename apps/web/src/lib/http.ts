import { randomUUID } from 'node:crypto';
import { ZodError } from 'zod';
import { auth } from './auth';
import { DomainError, requireOrigin } from '../../../../packages/domain/src/policy';

export async function context(headers: Headers) {
  const session = await auth().api.getSession({ headers });
  if (!session) throw new DomainError(401, 'UNAUTHORIZED', '请先登录');
  return { userId: session.user.id, requestId: randomUUID(), user: { name: session.user.name, email: session.user.email } };
}
const noStore = (requestId: string) => ({ 'Cache-Control': 'private, no-store', 'X-Request-Id': requestId });
export function json(data: unknown, requestId: string, status = 200, extra: Record<string, string> = {}, page?: { nextCursor: string | null; hasMore: boolean }) {
  if (status === 204) return new Response(null, { status, headers: { ...noStore(requestId), ...extra } });
  return Response.json({ data, ...(page ? { page } : {}), meta: { requestId } }, { status, headers: { ...noStore(requestId), ...extra } });
}
export function failure(error: unknown, requestId: string) {
  const known = error instanceof DomainError;
  const invalid = error instanceof ZodError;
  const status = known ? error.status : invalid ? 422 : error instanceof SyntaxError ? 400 : 503;
  if (status === 503) console.error(JSON.stringify({ requestId, code: 'SERVICE_UNAVAILABLE', errorType: error instanceof Error ? error.name : 'unknown' }));
  return Response.json({ type: 'about:blank', title: known ? error.message : invalid ? '请检查输入字段' : status === 400 ? '请求格式不正确' : '服务暂不可用，请稍后重试', status, code: known ? error.code : invalid ? 'VALIDATION_ERROR' : status === 400 ? 'BAD_REQUEST' : 'SERVICE_UNAVAILABLE', requestId,
    ...(invalid ? { errors: error.issues.map(i => ({ path: i.path.join('.'), message: i.message })) } : {}),
  }, { status, headers: { 'Content-Type': 'application/problem+json', ...noStore(requestId), ...(known ? error.headers : {}) } });
}
export function writeGuard(request: Request, hasBody: boolean) {
  requireOrigin(request.headers.get('origin'), process.env.APP_URL!);
  if (hasBody && !request.headers.get('content-type')?.startsWith('application/json')) throw new DomainError(415, 'UNSUPPORTED_MEDIA_TYPE', '请使用 application/json');
}
export async function body(request: Request) {
  const text = await request.text();
  if (Buffer.byteLength(text) > 16384) throw new DomainError(413, 'PAYLOAD_TOO_LARGE', '请求内容过大');
  return JSON.parse(text) as unknown;
}
