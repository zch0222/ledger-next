import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { describe, expect, it } from 'vitest';
import { guardMcpRequest, MCP_MAX_BODY, rpcError } from '../../packages/mcp/src/http';
import { restClient, type Rest, type RestResult } from '../../packages/mcp/src/rest';
import { createLedgerMcpServer, DATA_NOTICE, TOOL_NAMES } from '../../packages/mcp/src/server';

const LEDGER = '0f8fad5b-d9cb-469f-a165-70867728950e';
const ACCOUNT = '7c9e6679-7425-40de-944b-e07fc1f90ae7';
const KEY = '9b2b4d9c-2f6e-4a39-9a3b-0d6a4bd0d0a1';
const TOKEN = `lnp_${'A'.repeat(43)}`;
type Call = {
  method: string;
  path: string;
  query?: Record<string, unknown>;
  body?: unknown;
  headers?: Record<string, string>;
};
const headers = (h: Record<string, string> = {}) => new Headers(h);
const good = (data: unknown, extra: Partial<Extract<RestResult, { ok: true }>> = {}): RestResult => ({
  ok: true,
  status: 200,
  data,
  requestId: 'req-1',
  headers: headers(),
  ...extra,
});
const bad = (status: number, code: string, extra: Record<string, unknown> = {}): RestResult => ({
  ok: false,
  status,
  problem: { status, code, title: `t-${code}`, requestId: 'req-x', ...extra },
});
const me = {
  name: '小明',
  defaultLedgerId: LEDGER,
  ledgers: [{ id: LEDGER, name: '家', baseCurrency: 'CNY', timezone: 'Asia/Hong_Kong', role: 'owner' }],
  auth: { type: 'token', scopes: ['categories:read', 'transactions:read'] },
};

/** An MCP client wired in memory to the server, over a scripted REST double that records every call. */
async function harness(answer: (call: Call) => RestResult | undefined) {
  const calls: Call[] = [];
  const rest: Rest = async (method, path, options = {}) => {
    const call = { method, path, ...options };
    calls.push(call);
    return (answer(call) ?? bad(500, 'UNSCRIPTED')) as never;
  };
  const server = createLedgerMcpServer(rest, { apiBase: 'https://ledger.example/api/v1' });
  const [a, b] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'unit', version: '0' });
  await Promise.all([server.connect(a), client.connect(b)]);
  const call = async (name: string, args: Record<string, unknown>) =>
    (await client.callTool({ name, arguments: args })) as CallToolResult & {
      structuredContent: Record<string, unknown>;
    };
  return { client, calls, call };
}
const text = (r: CallToolResult) => r.content.map(c => (c.type === 'text' ? c.text : '')).join('\n');

describe('MCP front door', () => {
  const req = (init: { method?: string; headers?: Record<string, string> } = {}) =>
    new Request('https://ledger.example/mcp', {
      method: init.method ?? 'POST',
      headers: { host: 'ledger.example', authorization: `Bearer ${TOKEN}`, ...init.headers },
    });
  const options = {
    appUrl: 'https://ledger.example',
    allowedHosts: 'mcp.internal:8080, other.example',
    allowedOrigins: 'https://ide.example',
  };
  const status = (r: ReturnType<typeof guardMcpRequest>) => ('response' in r ? r.response.status : 'ok');
  it('checks method, Host, Origin, size and Bearer before anything else', async () => {
    expect(guardMcpRequest(req(), options)).toEqual({ token: TOKEN });
    expect(status(guardMcpRequest(req({ method: 'GET' }), options))).toBe(405);
    expect(status(guardMcpRequest(req({ headers: { host: 'evil.example' } }), options))).toBe(421);
    expect(status(guardMcpRequest(req({ headers: { host: 'MCP.internal:8080' } }), options))).toBe('ok');
    expect(status(guardMcpRequest(req({ headers: { origin: 'https://evil.example' } }), options))).toBe(403);
    expect(status(guardMcpRequest(req({ headers: { origin: 'https://ide.example' } }), options))).toBe('ok');
    expect(
      status(
        guardMcpRequest(req({ headers: { origin: 'https://ledger.example' } }), { appUrl: 'https://ledger.example' }),
      ),
    ).toBe('ok');
    expect(status(guardMcpRequest(req({ headers: { 'content-length': String(MCP_MAX_BODY + 1) } }), options))).toBe(
      413,
    );
    const missing = guardMcpRequest(
      new Request('https://ledger.example/mcp', { method: 'POST', headers: { host: 'ledger.example' } }),
      options,
    ) as { response: Response };
    expect(missing.response.status).toBe(401);
    expect(missing.response.headers.get('www-authenticate')).toBe('Bearer realm="ledger"');
    const malformed = guardMcpRequest(req({ headers: { authorization: 'Bearer abc' } }), options) as {
      response: Response;
    };
    expect(malformed.response.headers.get('www-authenticate')).toContain('invalid_token');
    expect(await await rpcError(500, 'x').json()).toMatchObject({ jsonrpc: '2.0', error: { code: -32000 }, id: null });
    expect(await await rpcError(403, 'x').json()).toMatchObject({ error: { code: -32001 } });
  });
});

describe('REST client', () => {
  it('sends the token, drops empty query values, unwraps data / page / requestId and keeps problems', async () => {
    const seen: Request[] = [];
    const fake = (async (input: URL, init: RequestInit) => {
      seen.push(new Request(input, init));
      const url = new URL(input);
      if (url.pathname.endsWith('/empty')) {
        return new Response(null, { status: 204, headers: { 'x-request-id': 'r204' } });
      }
      if (url.pathname.endsWith('/bad')) {
        return Response.json(
          { status: 409, code: 'PREVIEW_CONSUMED', title: '已提交', requestId: 'r409', approval: { id: 'a' } },
          { status: 409 },
        );
      }
      if (url.pathname.endsWith('/html')) return new Response('<html>', { status: 502, statusText: 'Bad Gateway' });
      return Response.json({ data: [1], page: { nextCursor: 'c', hasMore: true }, meta: { requestId: 'r200' } });
    }) as unknown as typeof fetch;
    const rest = restClient('https://ledger.example/api/v1/', TOKEN, fake);
    const okResult = await rest('GET', '/list', { query: { a: 1, b: undefined, c: null, d: '', e: false } });
    expect(okResult).toMatchObject({ ok: true, status: 200, data: [1], page: { hasMore: true }, requestId: 'r200' });
    expect(seen[0].url).toBe('https://ledger.example/api/v1/list?a=1&e=false');
    expect(seen[0].headers.get('authorization')).toBe(`Bearer ${TOKEN}`);
    expect(seen[0].headers.get('content-type')).toBeNull();
    await rest('POST', '/write', { body: { x: 1 }, headers: { 'Idempotency-Key': KEY } });
    expect(seen[1].headers.get('content-type')).toBe('application/json');
    expect(seen[1].headers.get('idempotency-key')).toBe(KEY);
    expect(await seen[1].json()).toEqual({ x: 1 });
    expect(await rest('DELETE', '/empty')).toMatchObject({ ok: true, status: 204, data: null, requestId: 'r204' });
    expect(await rest('POST', '/bad', { body: {} })).toMatchObject({
      ok: false,
      problem: { status: 409, code: 'PREVIEW_CONSUMED', requestId: 'r409', approval: { id: 'a' } },
    });
    expect(await rest('GET', '/html')).toMatchObject({
      ok: false,
      problem: { status: 502, code: 'HTTP_502', title: 'Bad Gateway' },
    });
  });
  it('turns a timeout into "may have happened — look it up", and other failures into NETWORK_ERROR', async () => {
    const hang = ((_: URL, init: RequestInit) =>
      new Promise((_, reject) =>
        init.signal!.addEventListener('abort', () => reject(init.signal!.reason)),
      )) as unknown as typeof fetch;
    const timedOut = await restClient('https://x/api/v1', TOKEN, hang)('POST', '/t', { body: {}, timeoutMs: 20 });
    expect(timedOut).toMatchObject({ ok: false, status: 0, problem: { code: 'TIMEOUT' } });
    expect((timedOut as { problem: { title: string } }).problem.title).toContain('同一幂等键');
    const down = (async () => {
      throw new TypeError('fetch failed');
    }) as unknown as typeof fetch;
    expect(await restClient('https://x/api/v1', TOKEN, down)('GET', '/t')).toMatchObject({
      ok: false,
      problem: { code: 'NETWORK_ERROR' },
    });
  });
});

describe('MCP tools over a scripted REST', () => {
  it('lists the 15 contract tools with strict schemas and correct hints, plus the two resources', async () => {
    const { client } = await harness(c => (c.path === '/me' ? good(me) : undefined));
    const { tools } = await client.listTools();
    expect(tools.map(t => t.name).sort()).toEqual([...TOOL_NAMES].sort());
    for (const tool of tools) expect(tool.inputSchema).toMatchObject({ type: 'object', additionalProperties: false });
    const transaction = tools.find(t => t.name === 'ledger_preview_transaction')!.inputSchema.properties!
      .transaction as { anyOf?: unknown[]; oneOf?: unknown[] };
    expect((transaction.anyOf ?? transaction.oneOf)!.length).toBe(3); // expense/income, transfer, refund
    expect(tools.find(t => t.name === 'ledger_get_operation')!.annotations).toMatchObject({ readOnlyHint: true });
    const { resources } = await client.listResources();
    expect(resources.map(r => r.uri)).toEqual([`ledger://${LEDGER}/context`, `ledger://${LEDGER}/categories`]);
    const templates = await client.listResourceTemplates();
    expect(templates.resourceTemplates.map(t => t.uriTemplate).sort()).toEqual([
      'ledger://{ledgerId}/categories',
      'ledger://{ledgerId}/context',
    ]);
  });

  it('context: chooses the only / default ledger, asks to choose otherwise, includes categories when allowed', async () => {
    const two = {
      ...me,
      defaultLedgerId: null,
      ledgers: [...me.ledgers, { ...me.ledgers[0], id: ACCOUNT, name: '公司' }],
    };
    let current: Omit<typeof me, 'defaultLedgerId'> & { defaultLedgerId: string | null } = me;
    const { call, calls } = await harness(c =>
      c.path === '/me'
        ? good(current)
        : c.path.endsWith('/categories')
          ? good([{ id: KEY, name: '餐饮', kind: 'expense', parentId: null, icon: 'x' }])
          : undefined,
    );
    const single = await call('ledger_get_context', {});
    expect(single.structuredContent).toMatchObject({
      ledger: { id: LEDGER, baseCurrency: 'CNY', today: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/) },
      categories: [{ id: KEY, name: '餐饮', kind: 'expense', parentId: null }],
      needsLedgerChoice: false,
    });
    expect(text(single)).toContain('基准币 CNY');
    expect(text(single)).toContain(DATA_NOTICE);
    current = two;
    const choose = await call('ledger_get_context', {});
    expect(choose.structuredContent).toMatchObject({ ledger: null, needsLedgerChoice: true, categories: null });
    expect(text(choose)).toContain('请让用户选择');
    expect((await call('ledger_get_context', { ledgerId: ACCOUNT })).structuredContent).toMatchObject({
      ledger: { name: '公司' },
    });
    expect(await call('ledger_get_context', { ledgerId: KEY })).toMatchObject({
      isError: true,
      structuredContent: { error: { status: 404 } },
    });
    current = { ...me, auth: { type: 'token', scopes: [] } };
    expect((await call('ledger_get_context', {})).structuredContent.categories).toBeNull();
    expect(calls.filter(c => c.path.endsWith('/categories'))).toHaveLength(2); // not when no ledger is chosen or the scope is missing
  });

  it('context and resources surface a REST failure as an error, never as empty success', async () => {
    const { call, client } = await harness(c =>
      c.path === '/me'
        ? bad(401, 'INVALID_TOKEN')
        : c.path.endsWith('/categories')
          ? bad(403, 'INSUFFICIENT_SCOPE')
          : undefined,
    );
    const result = await call('ledger_get_context', {});
    expect(result).toMatchObject({
      isError: true,
      structuredContent: { error: { code: 'INVALID_TOKEN', requestId: 'req-x' } },
    });
    expect(text(result)).toContain('重新签发令牌');
    expect((await client.listResources()).resources).toEqual([]);
    await expect(client.readResource({ uri: `ledger://${LEDGER}/categories` })).rejects.toThrow(/INSUFFICIENT_SCOPE/);
    await expect(client.readResource({ uri: `ledger://${LEDGER}/context` })).rejects.toThrow(/INVALID_TOKEN/);
  });

  it('reads map to REST with the right query, pages, spans and a resource URL', async () => {
    const page = { nextCursor: 'n1', hasMore: true };
    const { call, calls } = await harness(c => {
      if (
        c.path.endsWith('/accounts') ||
        c.path.endsWith('/transactions') ||
        c.path.endsWith('/subscriptions') ||
        c.path.endsWith('/reminder-rules') ||
        c.path.endsWith('/notification-deliveries')
      ) {
        return good([{ id: 'x' }], { page });
      }
      if (c.path.endsWith('/bill-occurrences')) return good([{ name: '会员' }]);
      if (c.path === '/notification-channels') {
        return good([
          { id: 'c1', type: 'in_app', name: '站内', status: 'active', enabled: true },
          { id: 'c2', type: 'telegram', name: 'TG', status: 'verifying', enabled: true },
        ]);
      }
      if (c.path.endsWith('/reports/summary')) {
        return good({
          income: '0',
          expense: '10.00',
          refunds: '0',
          net: '-10.00',
          currency: 'USD',
          valuationMode: 'current',
          partial: true,
          excludedCount: 2,
          sourceAt: null,
        });
      }
      if (c.path === '/exchange-rates') {
        return good({
          base: 'USD',
          asOf: 'now',
          rates: [
            { quote: 'CNY', value: '7.1', sourceAt: '2026-10-02T00:00:00Z', freshness: 'fresh' },
            { quote: 'HKD', value: null, sourceAt: null, freshness: 'missing' },
          ],
        });
      }
      return undefined;
    });
    const accounts = await call('ledger_list_accounts', { ledgerId: LEDGER, includeArchived: true, limit: 5 });
    expect(accounts.structuredContent).toMatchObject({
      items: [{ id: 'x' }],
      nextCursor: 'n1',
      hasMore: true,
      resourceUrl: `https://ledger.example/api/v1/ledgers/${LEDGER}/accounts?includeArchived=true&limit=5`,
    });
    expect(text(accounts)).toContain('还有更多');
    await call('ledger_list_transactions', {
      ledgerId: LEDGER,
      dateFrom: '2026-01-01',
      dateTo: '2026-02-01',
      kind: 'expense',
      q: '午餐',
    });
    expect(calls.at(-1)).toMatchObject({
      method: 'GET',
      path: `/ledgers/${LEDGER}/transactions`,
      query: { dateFrom: '2026-01-01', dateTo: '2026-02-01', kind: 'expense', q: '午餐' },
    });
    expect(
      await call('ledger_list_transactions', { ledgerId: LEDGER, dateFrom: '2024-01-01', dateTo: '2026-01-01' }),
    ).toMatchObject({
      isError: true,
      structuredContent: { error: { code: 'VALIDATION_ERROR', errors: [{ path: 'dateTo' }] } },
    });
    const summary = await call('ledger_get_summary', {
      ledgerId: LEDGER,
      dateFrom: '2026-09-01',
      dateTo: '2026-10-01',
      currency: 'USD',
      valuationMode: 'current',
    });
    expect(text(summary)).toContain('当前汇率重估口径');
    expect(text(summary)).toContain('有 2 笔因缺汇率未计入');
    expect(
      await call('ledger_get_summary', { ledgerId: LEDGER, dateFrom: '2020-01-01', dateTo: '2026-01-01' }),
    ).toMatchObject({ isError: true });
    const rates = await call('ledger_get_exchange_rates', { base: 'USD', quotes: ['CNY', 'HKD'] });
    expect(calls.at(-1)).toMatchObject({ path: '/exchange-rates', query: { base: 'USD', quotes: 'CNY,HKD' } });
    expect(text(rates)).toContain('实时（2 分钟内）');
    expect(text(rates)).toContain('缺失');
    expect(text(rates)).toContain('不要称为实时汇率');
    const past = await call('ledger_get_exchange_rates', {
      base: 'USD',
      quotes: ['CNY'],
      asOf: '2026-01-05T00:00:00Z',
    });
    expect(text(past)).toContain('当时的历史报价');
    expect(text(past)).not.toContain('实时（2 分钟内）');
    expect(past.structuredContent).toMatchObject({ historical: true });
    const subs = await call('ledger_list_subscriptions', {
      ledgerId: LEDGER,
      dueFrom: '2026-10-05',
      dueTo: '2026-10-12',
      billStatus: 'scheduled',
    });
    expect(subs.structuredContent).toMatchObject({ items: [{ id: 'x' }], bills: [{ name: '会员' }] });
    expect(calls.at(-1)).toMatchObject({
      path: `/ledgers/${LEDGER}/bill-occurrences`,
      query: { dateFrom: '2026-10-05', dateTo: '2026-10-12', status: 'scheduled', limit: 100 },
    });
    expect((await call('ledger_list_subscriptions', { ledgerId: LEDGER })).structuredContent.bills).toBeNull();
    expect(await call('ledger_list_subscriptions', { ledgerId: LEDGER, dueFrom: '2026-10-05' })).toMatchObject({
      isError: true,
      structuredContent: { error: { errors: [{ path: 'dueTo' }] } },
    });
    expect(await call('ledger_list_subscriptions', { ledgerId: LEDGER, dueTo: '2026-10-05' })).toMatchObject({
      isError: true,
      structuredContent: { error: { errors: [{ path: 'dueFrom' }] } },
    });
    expect(
      await call('ledger_list_subscriptions', { ledgerId: LEDGER, dueFrom: '2020-01-01', dueTo: '2026-10-05' }),
    ).toMatchObject({ isError: true });
    const reminders = await call('ledger_list_reminders', {
      ledgerId: LEDGER,
      deliveriesFrom: '2026-10-01',
      deliveryStatus: 'failed',
    });
    expect(reminders.structuredContent).toMatchObject({
      channels: [{ id: 'c1', type: 'in_app' }],
      deliveries: [{ id: 'x' }],
    }); // only active channels are offered
    expect(text(reminders)).toContain('accepted 只表示平台已受理');
    expect((await call('ledger_list_reminders', { ledgerId: LEDGER })).structuredContent.deliveries).toBeNull();
    expect(
      await call('ledger_list_reminders', {
        ledgerId: LEDGER,
        deliveriesFrom: '2020-01-01',
        deliveriesTo: '2026-01-01',
      }),
    ).toMatchObject({ isError: true });
  });

  it('read failures keep code and requestId; channel listing failure only hides channels', async () => {
    const { call } = await harness(c => {
      if (c.path === '/notification-channels') return bad(403, 'INSUFFICIENT_SCOPE');
      if (c.path.endsWith('/reminder-rules')) return good([]);
      if (c.path.endsWith('/notification-deliveries')) return bad(400, 'INVALID_CURSOR');
      if (c.path.endsWith('/bill-occurrences')) return bad(422, 'INVALID_RANGE');
      if (c.path.endsWith('/subscriptions')) return good([]);
      return bad(404, 'NOT_FOUND');
    });
    expect((await call('ledger_list_reminders', { ledgerId: LEDGER })).structuredContent).toMatchObject({
      channels: null,
    });
    expect(text(await call('ledger_list_reminders', { ledgerId: LEDGER }))).toContain('可用渠道 未知');
    expect(await call('ledger_list_reminders', { ledgerId: LEDGER, deliveryStatus: 'failed' })).toMatchObject({
      isError: true,
      structuredContent: { error: { code: 'INVALID_CURSOR' } },
    });
    expect(
      await call('ledger_list_subscriptions', { ledgerId: LEDGER, dueFrom: '2026-01-01', dueTo: '2026-01-05' }),
    ).toMatchObject({ isError: true, structuredContent: { error: { code: 'INVALID_RANGE' } } });
    for (const [name, args] of [
      ['ledger_list_accounts', {}],
      ['ledger_list_transactions', {}],
      ['ledger_get_summary', { dateFrom: '2026-01-01', dateTo: '2026-02-01' }],
      ['ledger_list_subscriptions', {}],
    ] as const) {
      const result = await call(name, { ledgerId: LEDGER, ...args });
      if (name === 'ledger_list_subscriptions') {
        expect(result.isError).toBeFalsy();
        continue;
      }
      expect(result).toMatchObject({
        isError: true,
        structuredContent: { error: { code: 'NOT_FOUND', requestId: 'req-x' } },
      });
      expect(text(result)).toContain('当前令牌无权访问该账本');
    }
    expect(await call('ledger_get_exchange_rates', { base: 'USD', quotes: ['CNY'] })).toMatchObject({ isError: true });
    expect((await call('ledger_list_reminders', { ledgerId: KEY })).isError).toBeFalsy();
  });

  it('previews never write money; creates pass Idempotency-Key / X-Approval-Id / If-Match and report replays', async () => {
    const replay = headers({ 'idempotent-replayed': 'true' });
    let replayNext = false;
    const { call, calls } = await harness(c => {
      if (c.path.endsWith('/transaction-previews')) {
        return good({
          previewId: KEY,
          expiresAt: 'soon',
          kind: 'expense',
          settlement: { amount: '28.00', currency: 'HKD' },
          base: { amount: '25.70', currency: 'CNY' },
          exchangeRate: {
            value: '0.918',
            base: 'HKD',
            quote: 'CNY',
            freshness: 'stale',
            sourceAt: '2026-10-01T00:00:00Z',
          },
          warnings: [{ code: 'FX_STALE', message: '汇率已过期' }],
        });
      }
      if (c.path.endsWith('/subscription-previews')) {
        return good({
          previewId: KEY,
          expiresAt: 'soon',
          nextOccurrences: ['2026-11-05', '2026-12-05', '2027-01-05'],
          monthlyEquivalent: { amount: '20.00', currency: 'USD' },
          warnings: [],
        });
      }
      if (c.path.endsWith('/reminder-previews')) {
        return good({
          previewId: KEY,
          expiresAt: 'soon',
          nextFireTimes:
            (c.body as { eventType: string }).eventType === 'budget_threshold'
              ? []
              : [{ scheduledAt: 'x', localDate: '2026-11-04', localTime: '09:00', deferredByQuietHours: true }],
          warnings: [],
        });
      }
      const transaction = {
        id: ACCOUNT,
        kind: 'refund',
        settlement: { amount: '5.00', currency: 'CNY' },
        base: { amount: '5.00', currency: 'CNY' },
        version: 1,
        localDate: '2026-10-02',
      };
      if (c.method === 'POST' && /\/transactions(\/[^/]+\/refunds)?$/.test(c.path)) {
        const r = good(transaction, { status: 201, headers: replayNext ? replay : headers() });
        replayNext = true;
        return r;
      }
      if (c.method === 'PATCH') return good({ ...transaction, kind: 'expense', version: 1 }, { headers: replay });
      if (c.path.endsWith('/subscriptions')) {
        return good({ id: KEY, name: '视频', amount: { amount: '20.00', currency: 'USD' } }, { status: 201 });
      }
      if (c.path.endsWith('/reminder-rules')) {
        return good({ id: KEY, eventType: 'bill_due', nextFireTimes: [] }, { status: 201, headers: replay });
      }
      return undefined;
    });
    const preview = await call('ledger_preview_transaction', {
      ledgerId: LEDGER,
      transaction: {
        kind: 'expense',
        accountId: ACCOUNT,
        settlement: { amount: '28.00', currency: 'HKD' },
        occurredAt: '2026-10-02T04:00:00Z',
        timezone: 'Asia/Hong_Kong',
      },
    });
    expect(text(preview)).toContain('尚未入账');
    expect(text(preview)).toContain('过期');
    expect(text(preview)).toContain('汇率已过期');
    expect(calls.at(-1)).toMatchObject({ method: 'POST', body: { kind: 'expense', fxPolicy: 'fresh-only' } });
    const same = await call('ledger_preview_transaction', {
      ledgerId: LEDGER,
      transaction: {
        kind: 'transfer',
        sourceAccountId: ACCOUNT,
        targetAccountId: KEY,
        sourceAmount: { amount: '1.00', currency: 'CNY' },
        targetAmount: { amount: '1.00', currency: 'CNY' },
        occurredAt: '2026-10-02T04:00:00Z',
        timezone: 'Asia/Hong_Kong',
      },
    });
    expect(same.isError).toBeFalsy();

    const created = await call('ledger_create_transaction', {
      ledgerId: LEDGER,
      previewId: KEY,
      idempotencyKey: KEY,
      refundOf: ACCOUNT,
      approvalId: KEY,
    });
    expect(calls.at(-1)).toMatchObject({
      method: 'POST',
      path: `/ledgers/${LEDGER}/transactions/${ACCOUNT}/refunds`,
      body: { previewId: KEY },
      headers: { 'Idempotency-Key': KEY, 'X-Approval-Id': KEY },
    });
    expect(created.structuredContent).toMatchObject({
      replayed: false,
      operationId: KEY,
      resourceUrl: `https://ledger.example/api/v1/ledgers/${LEDGER}/transactions/${ACCOUNT}`,
    });
    expect(text(created)).toMatch(/^已入账。退款 5.00 CNY/);
    const again = await call('ledger_create_transaction', { ledgerId: LEDGER, previewId: KEY, idempotencyKey: KEY });
    expect(calls.at(-1)!.headers).toEqual({ 'Idempotency-Key': KEY });
    expect(text(again)).toContain('没有重复写入');
    const updated = await call('ledger_update_transaction', {
      ledgerId: LEDGER,
      transactionId: ACCOUNT,
      previewId: KEY,
      expectedVersion: 3,
      idempotencyKey: KEY,
    });
    expect(calls.at(-1)).toMatchObject({ method: 'PATCH', headers: { 'If-Match': '"v3"', 'Idempotency-Key': KEY } });
    expect(updated.structuredContent).toMatchObject({ replaced: ACCOUNT, replayed: true });

    const sub = await call('ledger_preview_subscription', {
      ledgerId: LEDGER,
      name: '视频',
      amount: { amount: '20.00', currency: 'USD' },
      cycle: { unit: 'month', count: 1 },
      anchorDate: '2026-11-05',
      timezone: 'Asia/Hong_Kong',
    });
    expect(text(sub)).toContain('2026-11-05、2026-12-05、2027-01-05');
    expect(calls.at(-1)!.body).not.toHaveProperty('ledgerId');
    expect(
      text(await call('ledger_create_subscription', { ledgerId: LEDGER, previewId: KEY, idempotencyKey: KEY })),
    ).toContain('订阅已保存');
    const reminder = await call('ledger_preview_reminder', {
      ledgerId: LEDGER,
      eventType: 'bill_due',
      leadDays: [1],
      localTime: '09:00',
      timezone: 'Asia/Hong_Kong',
      channelIds: [KEY],
    });
    expect(text(reminder)).toContain('因免打扰顺延');
    expect(
      text(
        await call('ledger_preview_reminder', {
          ledgerId: LEDGER,
          eventType: 'budget_threshold',
          localTime: '09:00',
          timezone: 'Asia/Hong_Kong',
          channelIds: [KEY],
        }),
      ),
    ).toContain('事件触发');
    expect(
      text(await call('ledger_create_reminder', { ledgerId: LEDGER, previewId: KEY, idempotencyKey: KEY })),
    ).toContain('规则此前已保存');
    // Bad input never reaches REST.
    const before = calls.length;
    for (const args of [
      { ledgerId: LEDGER, previewId: KEY, idempotencyKey: 'not-a-uuid' },
      { ledgerId: LEDGER, previewId: KEY, idempotencyKey: KEY, extra: 1 },
    ]) {
      expect((await call('ledger_create_transaction', args)).isError).toBe(true);
    }
    expect(calls.length).toBe(before);
  });

  it('write failures carry the advice for that code and the approval link; the operation lookup distinguishes "never written"', async () => {
    const approval = {
      id: KEY,
      approvalUrl: `https://ledger.example/ledgers/${LEDGER}/agents?approval=${KEY}`,
      expiresAt: '2026-10-03T00:00:00Z',
    };
    const queue: RestResult[] = [
      bad(403, 'APPROVAL_REQUIRED', { approval }),
      bad(0, 'TIMEOUT'),
      bad(409, 'PREVIEW_STALE'),
      bad(422, 'VALIDATION_ERROR', {
        errors: [
          { path: '', message: '整体错误' },
          { path: 'settlement.amount', message: '精度过高' },
        ],
      }),
      bad(503, 'SERVICE_UNAVAILABLE'),
      bad(418, 'TEAPOT'),
      bad(412, 'VERSION_CONFLICT'),
      bad(403, 'INSUFFICIENT_SCOPE'),
      bad(422, 'FX_RATE_STALE'),
    ];
    const { call } = await harness(c => {
      if (c.path.includes('/operations/')) {
        return c.path.endsWith(KEY)
          ? good({ status: 'succeeded', resource: { type: 'transactions', id: ACCOUNT, url: '/x' } })
          : c.path.endsWith(ACCOUNT)
            ? bad(404, 'OPERATION_NOT_FOUND')
            : c.path.endsWith(LEDGER)
              ? good({ status: 'running', resource: null })
              : bad(403, 'INSUFFICIENT_SCOPE');
      }
      return queue.shift();
    });
    const args = { ledgerId: LEDGER, previewId: KEY, idempotencyKey: KEY };
    const needs = await call('ledger_create_transaction', args);
    expect(needs).toMatchObject({
      isError: true,
      structuredContent: { error: { code: 'APPROVAL_REQUIRED', approval } },
    });
    expect(text(needs)).toContain(approval.approvalUrl);
    expect(text(needs)).toContain('不要自行批准');
    expect(text(await call('ledger_create_transaction', args))).toContain(
      '用 ledger_get_operation 查询同一个 idempotencyKey',
    );
    expect(
      text(await call('ledger_update_transaction', { ...args, transactionId: ACCOUNT, expectedVersion: 1 })),
    ).toContain('请重新预览');
    expect(text(await call('ledger_create_subscription', args))).toContain(
      '(整体) 整体错误；settlement.amount 精度过高',
    );
    expect(text(await call('ledger_create_reminder', args))).toContain('服务暂不可用');
    const unknown = await call('ledger_preview_transaction', {
      ledgerId: LEDGER,
      transaction: {
        kind: 'refund',
        originalTransactionId: KEY,
        accountId: ACCOUNT,
        settlement: { amount: '1.00', currency: 'CNY' },
        occurredAt: '2026-10-02T04:00:00Z',
        timezone: 'Asia/Hong_Kong',
      },
    });
    expect(text(unknown)).toBe('失败，未完成：t-TEAPOT（TEAPOT，HTTP 418，requestId req-x）');
    expect(
      await call('ledger_preview_subscription', {
        ledgerId: LEDGER,
        name: 'x',
        amount: { amount: '1.00', currency: 'CNY' },
        cycle: { unit: 'day', count: 1 },
        anchorDate: '2026-11-05',
        timezone: 'Asia/Hong_Kong',
      }),
    ).toMatchObject({ structuredContent: { error: { code: 'VERSION_CONFLICT' } } });
    expect(
      await call('ledger_preview_reminder', {
        ledgerId: LEDGER,
        eventType: 'bill_due',
        localTime: '09:00',
        timezone: 'Asia/Hong_Kong',
        channelIds: [KEY],
      }),
    ).toMatchObject({ structuredContent: { error: { code: 'INSUFFICIENT_SCOPE' } } });
    expect(
      text(
        await call('ledger_preview_transaction', {
          ledgerId: LEDGER,
          transaction: {
            kind: 'income',
            accountId: ACCOUNT,
            settlement: { amount: '1.00', currency: 'USD' },
            occurredAt: '2026-10-02T04:00:00Z',
            timezone: 'Asia/Hong_Kong',
          },
        }),
      ),
    ).toContain('fxPolicy=accept-stale');

    expect(text(await call('ledger_get_operation', { ledgerId: LEDGER, operationId: KEY }))).toContain('不要重复提交');
    expect(
      (await call('ledger_get_operation', { ledgerId: LEDGER, operationId: ACCOUNT })).structuredContent,
    ).toMatchObject({ status: 'not_found', requestId: 'req-x' });
    expect(text(await call('ledger_get_operation', { ledgerId: LEDGER, operationId: LEDGER }))).toMatch(
      /^写入状态：running。\n/,
    );
    expect(
      await call('ledger_get_operation', { ledgerId: LEDGER, operationId: '1b4e28ba-2fa1-41d2-883f-0016d3cca427' }),
    ).toMatchObject({ isError: true });
  });

  it('resources: context JSON for a ledger, categories with the data notice', async () => {
    const { client } = await harness(c =>
      c.path === '/me'
        ? good(me)
        : c.path.endsWith('/categories')
          ? good([{ id: KEY, name: '餐饮' }], { page: { nextCursor: null, hasMore: false } })
          : undefined,
    );
    const context = await client.readResource({ uri: `ledger://${LEDGER}/context` });
    expect(JSON.parse((context.contents[0] as { text: string }).text)).toMatchObject({ ledger: { id: LEDGER } });
    const categories = await client.readResource({ uri: `ledger://${LEDGER}/categories` });
    expect(JSON.parse((categories.contents[0] as { text: string }).text)).toEqual({
      items: [{ id: KEY, name: '餐饮' }],
      hasMore: false,
      notice: DATA_NOTICE,
    });
  });
});
