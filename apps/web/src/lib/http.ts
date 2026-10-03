import { randomUUID } from 'node:crypto';
import { ZodError } from 'zod';
import { auth } from './auth';
import { DomainError, requireOrigin } from '../../../../packages/domain/src/policy';
import { resolveToken, type Auth } from '../../../../packages/domain/src/agents';

/**
 * Caller identity: a Bearer personal access token (Agents, MCP) or the Web session cookie. A token acts as its user,
 * narrowed to its scopes and ledgers; it carries no cookie, so the CSRF origin check applies to sessions only.
 */
export async function context(
  headers: Headers,
): Promise<{ userId: string; requestId: string; user: { name: string; email: string }; auth: Auth }> {
  const authorization = headers.get('authorization');
  if (authorization && /^bearer\s+/i.test(authorization)) {
    const token = await resolveToken(authorization.replace(/^bearer\s+/i, '').trim());
    return { userId: token.userId, requestId: randomUUID(), user: token.user, auth: token.auth };
  }
  const session = await auth().api.getSession({ headers });
  if (!session) throw new DomainError(401, 'UNAUTHORIZED', '请先登录');
  return {
    userId: session.user.id,
    requestId: randomUUID(),
    user: { name: session.user.name, email: session.user.email },
    auth: { type: 'session', sessionCreatedAt: new Date(session.session.createdAt) },
  };
}
const noStore = (requestId: string) => ({ 'Cache-Control': 'private, no-store', 'X-Request-Id': requestId });
export function json(
  data: unknown,
  requestId: string,
  status = 200,
  extra: Record<string, string> = {},
  page?: { nextCursor: string | null; hasMore: boolean },
) {
  if (status === 204) return new Response(null, { status, headers: { ...noStore(requestId), ...extra } });
  return Response.json(
    { data, ...(page ? { page } : {}), meta: { requestId } },
    { status, headers: { ...noStore(requestId), ...extra } },
  );
}
export function failure(error: unknown, requestId: string) {
  const known = error instanceof DomainError;
  const invalid = error instanceof ZodError;
  const status = known ? error.status : invalid ? 422 : error instanceof SyntaxError ? 400 : 503;
  if (status === 503) {
    console.error(
      JSON.stringify({
        requestId,
        code: 'SERVICE_UNAVAILABLE',
        errorType: error instanceof Error ? error.name : 'unknown',
      }),
    );
  }
  return Response.json(
    {
      type: 'about:blank',
      title: known
        ? error.message
        : invalid
          ? '请检查输入字段'
          : status === 400
            ? '请求格式不正确'
            : '服务暂不可用，请稍后重试',
      status,
      code: known ? error.code : invalid ? 'VALIDATION_ERROR' : status === 400 ? 'BAD_REQUEST' : 'SERVICE_UNAVAILABLE',
      requestId,
      ...(invalid
        ? { errors: error.issues.map(i => ({ path: i.path.join('.'), message: i.message })) }
        : known && error.errors
          ? { errors: error.errors }
          : {}),
      ...(known && error.extra ? error.extra : {}),
    },
    {
      status,
      headers: { 'Content-Type': 'application/problem+json', ...noStore(requestId), ...(known ? error.headers : {}) },
    },
  );
}
export function writeGuard(
  request: Request,
  bodyType: 'application/json' | 'multipart/form-data' | null,
  cookieAuth = true,
) {
  if (cookieAuth) requireOrigin(request.headers.get('origin'), process.env.APP_URL!);
  if (bodyType && !request.headers.get('content-type')?.startsWith(bodyType)) {
    throw new DomainError(415, 'UNSUPPORTED_MEDIA_TYPE', `请使用 ${bodyType}`);
  }
}
/** multipart/form-data with a file field: size-checked before and after parsing. */
export async function upload(request: Request, maxBytes: number) {
  const length = Number(request.headers.get('content-length') ?? 0);
  if (length > maxBytes + 64 * 1024) throw new DomainError(413, 'PAYLOAD_TOO_LARGE', '文件过大');
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    throw new DomainError(400, 'BAD_REQUEST', '无法解析上传内容');
  }
  const file = form.get('file');
  const mapping = form.get('mapping');
  if (!(file instanceof File)) {
    throw new DomainError(422, 'VALIDATION_ERROR', '缺少文件', {}, [{ path: 'file', message: '请选择 CSV 文件' }]);
  }
  if (typeof mapping !== 'string') {
    throw new DomainError(422, 'VALIDATION_ERROR', '缺少列映射', {}, [{ path: 'mapping', message: '请提供列映射' }]);
  }
  if (file.size > maxBytes) throw new DomainError(413, 'PAYLOAD_TOO_LARGE', '文件超过大小上限');
  const bytes = Buffer.from(await file.arrayBuffer());
  return { fileName: file.name, content: new TextDecoder('utf-8', { fatal: false }).decode(bytes), mapping };
}
/** A file response (CSV download); never cached. */
export function attachment(content: string, fileName: string, contentType: string, requestId: string) {
  return new Response(content, {
    status: 200,
    headers: {
      'Content-Type': `${contentType}; charset=utf-8`,
      'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(fileName)}`,
      'Cache-Control': 'private, no-store',
      'X-Request-Id': requestId,
      'X-Content-Type-Options': 'nosniff',
    },
  });
}
export async function body(request: Request) {
  const text = await request.text();
  if (Buffer.byteLength(text) > 16384) throw new DomainError(413, 'PAYLOAD_TOO_LARGE', '请求内容过大');
  return JSON.parse(text) as unknown;
}
