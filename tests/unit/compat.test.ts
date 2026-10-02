import { describe, expect, it } from 'vitest';
import { breakingChanges } from '../../packages/contracts/src/compat';
import { buildOpenApi } from '../../packages/contracts/src/openapi';

type Doc = Parameters<typeof breakingChanges>[0] & { components: { schemas: Record<string, Record<string, unknown>> } };
const base = () => JSON.parse(JSON.stringify(buildOpenApi())) as Doc & { paths: Record<string, Record<string, Record<string, unknown>>> };
const op = (doc: ReturnType<typeof base>, path: string, method: string) => doc.paths[path][method] as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const changes = (mutate: (doc: ReturnType<typeof base>) => void) => { const head = base(); mutate(head); return breakingChanges(base(), head); };

describe('compatible evolution', () => {
  it('accepts an identical contract', () => expect(breakingChanges(base(), base())).toEqual([]));
  it('allows additive changes', () => {
    expect(changes(doc => {
      const ledger = doc.components.schemas.Ledger as { properties: Record<string, unknown> };
      ledger.properties.color = { type: 'string' };                       // new response field
      const create = doc.components.schemas.LedgerCreate as { properties: Record<string, unknown> };
      create.properties.note = { type: 'string' };                        // new optional request field
      (doc.components.schemas.Currency as { enum: string[] }).enum.push('GBP'); // request accepts more (also a response enum addition, see below)
      op(doc, '/ledgers', 'get').parameters.push({ name: 'q', in: 'query', required: false, schema: { type: 'string' } });
      doc.paths['/ledgers/{ledgerId}/widgets'] = { get: { 'x-stability': 'stable', responses: {} } };
    }).filter(issue => !issue.includes('响应新增取值'))).toEqual([]);
  });
  it('ignores planned operations', () => {
    expect(changes(doc => { delete doc.paths['/ledgers/{ledgerId}/accounts']; (doc.components.schemas.AccountCreate as { required: string[] }).required.push('note'); })).toEqual([]);
  });
});

describe('breaking changes to stable operations', () => {
  const cases: [string, (doc: ReturnType<typeof base>) => void, RegExp][] = [
    ['removed operation', doc => { delete doc.paths['/ledgers'].get; }, /GET \/ledgers: 操作被删除/],
    ['downgraded stability', doc => { op(doc, '/ledgers', 'get')['x-stability'] = 'planned'; }, /降级/],
    ['new required request field', doc => { (doc.components.schemas.LedgerCreate as { required: string[] }).required.push('extra'); (doc.components.schemas.LedgerCreate as { properties: Record<string, unknown> }).properties.extra = { type: 'string' }; }, /新增必填字段/],
    ['removed request field from a strict schema', doc => { delete (doc.components.schemas.LedgerUpdate as { properties: Record<string, unknown> }).properties.name; }, /字段被删除/],
    ['tightened request constraint', doc => { ((doc.components.schemas.LedgerCreate as { properties: Record<string, { maxLength?: number }> }).properties.name).maxLength = 40; }, /maxLength 收紧/],
    ['removed enum value', doc => { (doc.components.schemas.Currency as { enum: string[] }).enum.pop(); }, /不再接受取值/],
    ['added response enum value', doc => { (doc.components.schemas.Role as { enum: string[] }).enum.push('auditor'); }, /响应新增取值/],
    ['removed response field', doc => { delete (doc.components.schemas.Ledger as { properties: Record<string, unknown> }).properties.version; }, /响应字段被删除/],
    ['response field became optional', doc => { const s = doc.components.schemas.Membership as { required: string[] }; s.required = s.required.filter(r => r !== 'email'); }, /响应字段变为可选/],
    ['changed response type', doc => { (doc.components.schemas.Ledger as { properties: Record<string, unknown> }).properties.version = { type: 'string' }; }, /响应类型变化/],
    ['nullable response field', doc => { (doc.components.schemas.Ledger as { properties: Record<string, unknown> }).properties.name = { anyOf: [{ type: 'string' }, { type: 'null' }] }; }, /响应出现原契约没有的形式/],
    ['new required parameter', doc => { op(doc, '/ledgers', 'get').parameters.push({ name: 'owner', in: 'query', required: true, schema: { type: 'string' } }); }, /新增必填参数 query:owner/],
    ['removed parameter', doc => { op(doc, '/ledgers', 'get').parameters = op(doc, '/ledgers', 'get').parameters.filter((p: { name?: string }) => p.name !== 'cursor'); }, /参数 query:cursor 被删除/],
    ['removed success status', doc => { const r = op(doc, '/ledgers', 'post').responses; r['200'] = r['201']; delete r['201']; }, /成功状态码 201 被删除/],
    ['removed response header', doc => { delete op(doc, '/ledgers', 'post').responses['201'].headers.Location; }, /响应头 Location 被删除/],
    ['raised role', doc => { op(doc, '/ledgers/{ledgerId}', 'get')['x-ledger-role'] = 'owner'; }, /所需角色提高/],
    ['new PAT scope', doc => { op(doc, '/ledgers', 'get').security = [{ session: [] }, { pat: ['ledgers:read', 'audit:read'] }]; }, /作用域变化/],
    ['dropped session auth', doc => { op(doc, '/me', 'get').security = [{ pat: [] }]; }, /不再接受 Web Session/],
  ];
  it.each(cases)('%s', (_, mutate, expected) => {
    expect(changes(mutate).join('\n')).toMatch(expected);
  });
  it('fails loudly on unresolvable references', () => {
    expect(() => changes(doc => { op(doc, '/ledgers', 'post').requestBody.content['application/json'].schema = { $ref: '#/components/schemas/Missing' }; })).toThrow(/Unresolvable/);
  });
});

describe('schema rules on minimal documents', () => {
  type S = Record<string, unknown>;
  const mini = (request: S | null, response: S | null, extra: S = {}) => ({
    paths: { '/things': { post: {
      'x-stability': 'stable', security: [{ session: [] }],
      ...(request ? { requestBody: { required: true, content: { 'application/json': { schema: request } } } } : {}),
      responses: { 201: response ? { content: { 'application/json': { schema: response } } } : {} }, ...extra,
    } } },
    components: { schemas: { Loop: { $ref: '#/components/schemas/Loop' } } },
  });
  const diff = (a: ReturnType<typeof mini>, b: ReturnType<typeof mini>) => breakingChanges(a, b).join('\n');
  const obj = (properties: S, more: S = {}) => ({ type: 'object', properties, ...more });
  it('flags request narrowing', () => {
    expect(diff(mini(obj({ a: { type: 'string' } }), null), mini(obj({ a: { type: 'integer' } }), null))).toMatch(/输入类型收窄/);
    expect(diff(mini(obj({ a: {} }), null), mini(obj({ a: { type: 'string' } }), null))).toMatch(/输入类型收窄（any → string）/);
    expect(diff(mini(obj({ a: { type: 'string' } }), null), mini(obj({ a: { anyOf: [{ type: 'integer' }] } }), null))).toMatch(/不再接受原有的输入形式/);
    expect(diff(mini(obj({ a: { type: 'string' } }), null), mini(obj({ a: { type: 'string', pattern: '^x' } }), null))).toMatch(/pattern 变化/);
    expect(diff(mini(obj({ a: { type: 'string' } }), null), mini(obj({ a: { type: 'string', format: 'email' } }), null))).toMatch(/format 变化为 email/);
    expect(diff(mini(obj({ a: { type: 'number', minimum: 0 } }), null), mini(obj({ a: { type: 'number', minimum: 1 } }), null))).toMatch(/minimum 收紧为 1/);
    expect(diff(mini(obj({ a: { type: 'array', items: { type: 'string' } } }), null), mini(obj({ a: { type: 'array', items: { enum: ['x'] } } }), null))).toMatch(/\.a\[\]: 不再接受取值 "any"/);
    expect(diff(mini(obj({}), null), mini(obj({}, { additionalProperties: false }), null))).toMatch(/不再接受额外字段/);
    expect(diff(mini(null, null), mini(obj({}), null))).toMatch(/新增必填请求体/);
    expect(diff(mini(obj({}), null), mini(null, null))).toMatch(/不再接受 application\/json 请求体/);
  });
  it('allows request widening', () => {
    expect(diff(mini(obj({ a: { type: 'integer', maximum: 5 } }), null), mini(obj({ a: { type: 'number', maximum: 9 } }), null))).toBe('');
    expect(diff(mini(obj({ a: { anyOf: [{ type: 'string' }] } }), null), mini(obj({ a: { anyOf: [{ type: 'string' }, { type: 'null' }] } }), null))).toBe('');
  });
  it('flags response loosening', () => {
    expect(diff(mini(null, obj({ a: { type: 'string' } })), mini(null, obj({ a: {} })))).toMatch(/响应类型变化（string → any）/);
    expect(diff(mini(null, obj({ a: { enum: ['x'] } })), mini(null, obj({ a: { type: 'string' } })))).toMatch(/响应新增取值 "any"/);
    expect(diff(mini(null, obj({ a: { const: 'x' } })), mini(null, obj({ a: { const: null } })))).toMatch(/响应类型变化/);
    expect(diff(mini(null, obj({})), mini(null, null))).toMatch(/不再返回 application\/json/);
  });
  it('stops on reference cycles', () => {
    expect(() => diff(mini(null, { $ref: '#/components/schemas/Loop' }), mini(null, { $ref: '#/components/schemas/Loop' }))).toThrow(/too deep/);
  });
});
