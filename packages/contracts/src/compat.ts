// Detects changes to stable operations that would break an existing client of the published v1 contract.
// Request schemas must keep accepting what they accepted; response schemas must not produce anything new.
type Schema = { [key: string]: unknown };
type Doc = { paths: Record<string, Record<string, Schema>>; components?: Record<string, Record<string, Schema>> };
type Direction = 'request' | 'response';
const RANK: Record<string, number> = { viewer: 0, editor: 1, owner: 2 };

function lookup(doc: Doc, ref: string): Schema {
  const [, , group, name] = ref.split('/');
  const found = doc.components?.[group]?.[name];
  if (!found) throw new Error(`Unresolvable $ref ${ref}`);
  return found;
}
function resolve(doc: Doc, schema: unknown): Schema {
  let current = (schema ?? {}) as Schema;
  for (let depth = 0; typeof current.$ref === 'string'; depth++) {
    if (depth > 20) throw new Error('Reference chain too deep');
    const { $ref, ...siblings } = current;
    current = { ...lookup(doc, $ref as string), ...siblings };
  }
  return current;
}
function types(s: Schema): Set<string> | null {
  if (s.type) return new Set([s.type].flat() as string[]);
  if (s.const !== undefined) return new Set([s.const === null ? 'null' : typeof s.const]);
  if (Array.isArray(s.enum)) return new Set(s.enum.map(v => (v === null ? 'null' : typeof v)));
  return null;
}
const values = (s: Schema) => (s.const !== undefined ? [s.const] : Array.isArray(s.enum) ? s.enum : null);
const covers = (wide: Set<string>, t: string) => wide.has(t) || (t === 'integer' && wide.has('number'));
const NARROWING: [string, 'min' | 'max'][] = [['minLength', 'min'], ['maxLength', 'max'], ['minimum', 'min'], ['maximum', 'max'], ['exclusiveMinimum', 'min'], ['exclusiveMaximum', 'max'], ['minItems', 'min'], ['maxItems', 'max']];

export function breakingChanges(base: Doc, head: Doc): string[] {
  const issues: string[] = [];
  function compare(b0: unknown, h0: unknown, dir: Direction, at: string, out: string[], depth = 0) {
    if (depth > 40) return;
    const b = resolve(base, b0), h = resolve(head, h0);
    const ub = (b.anyOf ?? b.oneOf) as unknown[] | undefined, uh = (h.anyOf ?? h.oneOf) as unknown[] | undefined;
    if (ub || uh) {
      const vb = ub ?? [b], vh = uh ?? [h];
      const fits = (x: unknown, y: unknown) => { const probe: string[] = []; compare(x, y, dir, at, probe, depth + 1); return probe.length === 0; };
      if (dir === 'request') { if (!vb.every(x => vh.some(y => fits(x, y)))) out.push(`${at}: 不再接受原有的输入形式`); }
      else if (!vh.every(y => vb.some(x => fits(x, y)))) out.push(`${at}: 响应出现原契约没有的形式`);
      return;
    }
    const tb = types(b), th = types(h);
    if (dir === 'request' && th && (!tb || ![...tb].every(t => covers(th, t)))) out.push(`${at}: 输入类型收窄（${[...(tb ?? ['any'])].join('|')} → ${[...th].join('|')}）`);
    if (dir === 'response' && tb && (!th || ![...th].every(t => covers(tb, t)))) out.push(`${at}: 响应类型变化（${[...tb].join('|')} → ${[...(th ?? ['any'])].join('|')}）`);
    const eb = values(b), eh = values(h);
    if (dir === 'request' && eh && (!eb || eb.some(v => !eh.includes(v)))) out.push(`${at}: 不再接受取值 ${JSON.stringify(eb ? eb.filter(v => !eh.includes(v)) : 'any')}`);
    if (dir === 'response' && eb && (!eh || eh.some(v => !eb.includes(v)))) out.push(`${at}: 响应新增取值 ${JSON.stringify(eh ? eh.filter(v => !eb.includes(v)) : 'any')}`);
    if (dir === 'request') {
      for (const [key, kind] of NARROWING) {
        const before = b[key] as number | undefined, after = h[key] as number | undefined;
        if (after !== undefined && (before === undefined || (kind === 'min' ? after > before : after < before))) out.push(`${at}: ${key} 收紧为 ${after}`);
      }
      if (h.pattern !== undefined && h.pattern !== b.pattern) out.push(`${at}: pattern 变化`);
      if (h.format !== undefined && h.format !== b.format) out.push(`${at}: format 变化为 ${String(h.format)}`);
    }
    if (b.properties || h.properties) {
      const pb = (b.properties ?? {}) as Record<string, unknown>, ph = (h.properties ?? {}) as Record<string, unknown>;
      const rb = new Set((b.required ?? []) as string[]), rh = new Set((h.required ?? []) as string[]);
      if (dir === 'request') {
        for (const name of rh) if (!rb.has(name)) out.push(`${at}.${name}: 新增必填字段`);
        for (const name of Object.keys(pb)) if (!(name in ph) && h.additionalProperties === false) out.push(`${at}.${name}: 字段被删除，旧客户端提交会被拒绝`);
        if (b.additionalProperties !== false && h.additionalProperties === false) out.push(`${at}: 不再接受额外字段`);
      } else {
        for (const name of Object.keys(pb)) if (!(name in ph)) out.push(`${at}.${name}: 响应字段被删除`);
        for (const name of rb) if (!rh.has(name)) out.push(`${at}.${name}: 响应字段变为可选`);
      }
      for (const name of Object.keys(pb)) if (name in ph) compare(pb[name], ph[name], dir, `${at}.${name}`, out, depth + 1);
    }
    if (b.items && h.items) compare(b.items, h.items, dir, `${at}[]`, out, depth + 1);
  }

  const params = (doc: Doc, o: Schema) => new Map(((o.parameters ?? []) as unknown[]).map(p => resolve(doc, p)).map(p => [`${p.in}:${p.name}`, p]));
  const pat = (o: Schema) => ((o.security ?? []) as Record<string, string[]>[]).find(s => 'pat' in s)?.pat;
  const session = (o: Schema) => ((o.security ?? []) as Record<string, string[]>[]).some(s => 'session' in s);
  for (const [path, methods] of Object.entries(base.paths)) for (const [method, b] of Object.entries(methods)) {
    if (b['x-stability'] !== 'stable') continue;
    const where = `${method.toUpperCase()} ${path}`;
    const h = head.paths[path]?.[method];
    if (!h) { issues.push(`${where}: 操作被删除`); continue; }
    if (h['x-stability'] !== 'stable') issues.push(`${where}: 从 stable 降级为 ${String(h['x-stability'])}`);
    if (RANK[h['x-ledger-role'] as string] > RANK[b['x-ledger-role'] as string]) issues.push(`${where}: 所需角色提高为 ${String(h['x-ledger-role'])}`);
    if (session(b) && !session(h)) issues.push(`${where}: 不再接受 Web Session`);
    const pb = pat(b), ph = pat(h);
    if (pb && (!ph || ph.some(scope => !pb.includes(scope)))) issues.push(`${where}: PAT 所需作用域变化`);
    const before = params(base, b), after = params(head, h);
    for (const [key, p] of after) if (p.required && !before.get(key)?.required) issues.push(`${where}: 新增必填参数 ${key}`);
    for (const [key, p] of before) {
      const next = after.get(key);
      if (!next) issues.push(`${where}: 参数 ${key} 被删除`);
      else compare(p.schema, next.schema, 'request', `${where} 参数 ${key}`, issues);
    }
    const bodyB = b.requestBody as Schema | undefined, bodyH = h.requestBody as Schema | undefined;
    if (bodyH?.required && !bodyB) issues.push(`${where}: 新增必填请求体`);
    for (const [type, media] of Object.entries((bodyB?.content ?? {}) as Record<string, Schema>)) {
      const next = (bodyH?.content as Record<string, Schema> | undefined)?.[type];
      if (!next) issues.push(`${where}: 不再接受 ${type} 请求体`);
      else compare(media.schema, next.schema, 'request', `${where} 请求体`, issues);
    }
    for (const [status, r0] of Object.entries(b.responses as Record<string, Schema>)) {
      if (!status.startsWith('2')) continue;
      const r1 = (h.responses as Record<string, Schema>)[status];
      if (!r1) { issues.push(`${where}: 成功状态码 ${status} 被删除`); continue; }
      const rb = resolve(base, r0), rh = resolve(head, r1);
      for (const name of Object.keys((rb.headers ?? {}) as object)) if (!(name in ((rh.headers ?? {}) as object))) issues.push(`${where} ${status}: 响应头 ${name} 被删除`);
      for (const [type, media] of Object.entries((rb.content ?? {}) as Record<string, Schema>)) {
        const next = (rh.content as Record<string, Schema> | undefined)?.[type];
        if (!next) issues.push(`${where} ${status}: 不再返回 ${type}`);
        else compare(media.schema, next.schema, 'response', `${where} ${status} 响应`, issues);
      }
    }
  }
  return issues;
}
