import { z } from 'zod';
import { SCOPES, requests, responses } from './common';
import { operations, pathParams, requiresIfMatch, type OperationDef } from './operations';

type Json = Record<string, unknown>;
const schemaRef = (id: string) => ({ $ref: `#/components/schemas/${id}` });
const FORMATS_WITH_REDUNDANT_PATTERN = new Set(['date-time', 'date', 'uuid', 'email', 'uri']);

// Zod adds verbose regexes next to standard formats; validators check the format itself.
function tidy(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(tidy);
  if (!value || typeof value !== 'object') return value;
  const result: Json = {};
  for (const [key, child] of Object.entries(value)) {
    if (key === '$schema' || key === '$id') continue;
    if (key === 'pattern' && FORMATS_WITH_REDUNDANT_PATTERN.has((value as Json).format as string)) continue;
    result[key] = tidy(child);
  }
  return result;
}
function convert(registry: typeof requests, io: 'input' | 'output') {
  const { schemas } = z.toJSONSchema(registry, { target: 'draft-2020-12', io, uri: id => `#/components/schemas/${id}` });
  return tidy(schemas) as Record<string, Json>;
}
function componentSchemas() {
  const merged = convert(requests, 'input');
  for (const [id, schema] of Object.entries(convert(responses, 'output'))) {
    if (merged[id] && JSON.stringify(merged[id]) !== JSON.stringify(schema)) throw new Error(`Schema ${id} differs between request and response use`);
    merged[id] = schema;
  }
  return Object.fromEntries(Object.entries(merged).sort(([a], [b]) => a.localeCompare(b)));
}
function idOf(schema: z.ZodType, registry: typeof requests, operation: string) {
  const id = registry.get(schema)?.id;
  if (!id) throw new Error(`${operation}: schema must be a registered component`);
  return id;
}

const PROBLEMS: Record<number, [string, string]> = {
  400: ['BadRequest', '请求格式错误：JSON 无法解析、cursor 无效或 Idempotency-Key 缺失 / 格式错误'],
  401: ['Unauthorized', '未登录、会话已撤销或令牌无效'],
  403: ['Forbidden', '角色或作用域不足；写请求 Origin 校验失败'],
  404: ['NotFound', '资源不存在或无权访问（不区分两者）'],
  409: ['Conflict', '业务冲突，或同一 Idempotency-Key 用于不同请求体'],
  412: ['PreconditionFailed', 'If-Match 与当前版本不符，请重新读取'],
  413: ['PayloadTooLarge', '请求体超过限制'],
  415: ['UnsupportedMediaType', '请使用 application/json'],
  422: ['ValidationFailed', '字段校验失败；errors 列出路径与原因'],
  428: ['PreconditionRequired', '缺少 If-Match'],
  429: ['TooManyRequests', '超过速率限制；参考 Retry-After'],
  501: ['NotImplemented', '契约已发布、尚未实现（x-stability: planned）'],
  503: ['ServiceUnavailable', '依赖暂不可用，可稍后重试'],
};
function errorStatuses(o: OperationDef) {
  const statuses = new Set([401, 429, 503]);
  if (o.path.includes('{')) statuses.add(404);
  if (o.role || o.scopes?.length || o.method !== 'get') statuses.add(403);
  if (o.method !== 'get' && o.method !== 'delete') statuses.add(415);
  if (o.body) [400, 413, 422].forEach(s => statuses.add(s));
  if (o.query) { statuses.add(422); if ('cursor' in o.query.shape) statuses.add(400); }
  if (requiresIfMatch(o)) [412, 428].forEach(s => statuses.add(s));
  if (o.idempotency) [400, 409].forEach(s => statuses.add(s));
  if (o.conflict) statuses.add(409);
  if (o.stability === 'planned') statuses.add(501);
  return [...statuses].sort();
}
function queryParameters(o: OperationDef) {
  if (!o.query) return [];
  const schema = tidy(z.toJSONSchema(o.query, { target: 'draft-2020-12', io: 'input' })) as { properties: Record<string, Json>; required?: string[] };
  return Object.entries(schema.properties).map(([name, property]) => {
    const { description, ...rest } = property;
    return { name, in: 'query', required: schema.required?.includes(name) ?? false, ...(description ? { description } : {}), schema: rest };
  });
}
function operationObject(o: OperationDef) {
  const parameters: Json[] = pathParams(o.path).map(name => ({ name, in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }));
  if (requiresIfMatch(o)) parameters.push({ $ref: '#/components/parameters/IfMatch' });
  if (o.idempotency) parameters.push({ $ref: `#/components/parameters/${o.idempotency === 'required' ? 'IdempotencyKeyRequired' : 'IdempotencyKey'}` });
  parameters.push(...queryParameters(o));
  const headers: Json = { 'X-Request-Id': { $ref: '#/components/headers/X-Request-Id' } };
  for (const name of o.headers ?? []) headers[name] = { $ref: `#/components/headers/${name}` };
  if (o.idempotency) headers['Idempotent-Replayed'] = { $ref: '#/components/headers/Idempotent-Replayed' };
  const success: Json = { description: o.summary, headers };
  if (o.response) success.content = { 'application/json': { schema: schemaRef(idOf(o.response, responses, o.id)) } };
  const result: Json = {
    operationId: o.id, tags: [o.tag], summary: o.summary,
    description: [o.description, o.stability === 'planned' ? `计划于 ${o.milestone} 实现；当前返回 501。` : null, o.conflict ? `业务冲突码：${o.conflict}。` : null].filter(Boolean).join('\n\n') || undefined,
    security: o.scopes === null ? [{ session: [] }] : [{ session: [] }, { pat: [...o.scopes] }],
    'x-stability': o.stability, 'x-milestone': o.milestone,
    ...(o.role ? { 'x-ledger-role': o.role } : {}),
    ...(o.idempotency ? { 'x-idempotency': o.idempotency } : {}),
    ...(parameters.length ? { parameters } : {}),
    ...(o.body ? { requestBody: { required: true, content: { [o.bodyType ?? 'application/json']: { schema: schemaRef(idOf(o.body, requests, o.id)) } } } } : {}),
    responses: { [o.status]: success, ...Object.fromEntries(errorStatuses(o).map(s => [s, { $ref: `#/components/responses/${PROBLEMS[s][0]}` }])) },
  };
  if (!result.description) delete result.description;
  return result;
}

export function buildOpenApi() {
  const paths: Record<string, Json> = {};
  for (const o of operations as readonly OperationDef[]) (paths[o.path] ??= {})[o.method] = operationObject(o);
  const problem = (description: string, extra: Json = {}) => ({ description, headers: { 'X-Request-Id': { $ref: '#/components/headers/X-Request-Id' }, ...extra }, content: { 'application/problem+json': { schema: schemaRef('Problem') } } });
  return {
    openapi: '3.1.1',
    info: {
      title: 'Ledger Next REST API', version: '1.0.0',
      description: '由 packages/contracts 的 Zod 契约生成，请勿手改。x-stability: stable 的操作已实现并受破坏性变更门禁保护；planned 为已发布契约、尚未实现（返回 501）。金额 / 汇率为十进制字符串；时间 RFC 3339 UTC；列表 {data, page, meta}。',
    },
    servers: [{ url: '/api/v1' }],
    tags: [...new Set(operations.map(o => o.tag))].map(name => ({ name })),
    paths,
    components: {
      schemas: componentSchemas(),
      securitySchemes: {
        session: { type: 'apiKey', in: 'cookie', name: 'better-auth.session_token', description: 'Web 数据库 Session；HTTPS 部署时名为 __Secure-better-auth.session_token。写请求必须携带同源 Origin。' },
        pat: { type: 'http', scheme: 'bearer', description: `Personal Access Token（M6-SERVER 实现前不可用）。作用域：${SCOPES.join(', ')}` },
      },
      parameters: {
        IfMatch: { name: 'If-Match', in: 'header', required: true, description: '上次读取到的 ETag，例如 "v3"', schema: { type: 'string', pattern: '^"v[1-9][0-9]*"$' } },
        IdempotencyKey: { name: 'Idempotency-Key', in: 'header', required: false, description: '同一 key + 同一请求体返回原结果；不同请求体返回 409。保留 7 天', schema: { type: 'string', pattern: '^[A-Za-z0-9._:-]{8,128}$' } },
        IdempotencyKeyRequired: { name: 'Idempotency-Key', in: 'header', required: true, description: '资金 / 投递类创建必须提供；同一 key + 同一请求体返回原结果', schema: { type: 'string', pattern: '^[A-Za-z0-9._:-]{8,128}$' } },
      },
      headers: {
        'X-Request-Id': { description: '请求追踪 ID，同时出现在错误体 requestId', schema: { type: 'string' } },
        ETag: { description: '资源版本，例如 "v2"', schema: { type: 'string' } },
        Location: { description: '新资源或任务地址', schema: { type: 'string' } },
        'Retry-After': { description: '秒', schema: { type: 'integer' } },
        'Idempotent-Replayed': { description: 'true 表示返回的是同一 Idempotency-Key 首次请求的结果', schema: { type: 'string', enum: ['true'] } },
      },
      responses: Object.fromEntries(Object.entries(PROBLEMS).map(([status, [name, description]]) => [name, problem(description, status === '429' ? { 'Retry-After': { $ref: '#/components/headers/Retry-After' } } : {})])),
    },
  };
}
