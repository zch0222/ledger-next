import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildOpenApi } from '../../packages/contracts/src/openapi';
import { matchOperation, operations, pathParams } from '../../packages/contracts/src/operations';

const doc = buildOpenApi() as unknown as { paths: Record<string, Record<string, Record<string, unknown>>>; components: Record<string, Record<string, unknown>> };
const ops = Object.entries(doc.paths).flatMap(([path, methods]) => Object.entries(methods).map(([method, o]) => ({ path, method, o })));

describe('OpenAPI document', () => {
  it('is the committed artifact', () => {
    expect(JSON.parse(readFileSync('packages/contracts/openapi.json', 'utf8'))).toEqual(JSON.parse(JSON.stringify(doc)));
  });
  it('covers every planned resource with unique operation ids', () => {
    expect(ops).toHaveLength(operations.length);
    expect(new Set(ops.map(x => x.o.operationId)).size).toBe(ops.length);
    // Resource table of API_AGENT_CONTRACT §2.
    for (const path of ['/me', '/me/preferences', '/ledgers', '/ledgers/{ledgerId}/memberships/{membershipId}', '/ledgers/{ledgerId}/accounts/{accountId}', '/ledgers/{ledgerId}/categories/{categoryId}', '/ledgers/{ledgerId}/tags/{tagId}', '/ledgers/{ledgerId}/transaction-previews', '/ledgers/{ledgerId}/transactions/{transactionId}/refunds', '/ledgers/{ledgerId}/subscription-previews', '/ledgers/{ledgerId}/bill-occurrences/{occurrenceId}/payments', '/ledgers/{ledgerId}/budgets/{budgetId}', '/ledgers/{ledgerId}/reports/summary', '/ledgers/{ledgerId}/reports/cash-flow', '/ledgers/{ledgerId}/reports/category-breakdown', '/ledgers/{ledgerId}/reports/account-balances', '/exchange-rates', '/ledgers/{ledgerId}/manual-rate-records', '/exchange-rate-refresh-jobs', '/ledgers/{ledgerId}/reminder-previews', '/ledgers/{ledgerId}/reminder-rules/{ruleId}', '/notification-channels/{channelId}/test-deliveries', '/ledgers/{ledgerId}/notification-deliveries/{deliveryId}', '/ledgers/{ledgerId}/notifications/{notificationId}', '/ledgers/{ledgerId}/import-jobs/{importJobId}/commits', '/ledgers/{ledgerId}/import-jobs/{importJobId}/reversals', '/ledgers/{ledgerId}/export-jobs/{exportJobId}', '/api-tokens/{tokenId}', '/ledgers/{ledgerId}/audit-events', '/ledgers/{ledgerId}/approval-requests/{approvalId}', '/ledgers/{ledgerId}/operations/{operationId}'])
      expect(doc.paths, path).toHaveProperty([path]);
  });
  it('gives every operation security, error responses and declared path parameters', () => {
    for (const { path, method, o } of ops) {
      const where = `${method} ${path}`;
      expect(o.security, where).toEqual(expect.arrayContaining([{ session: [] }]));
      const responses = Object.keys(o.responses as object);
      for (const status of ['401', '429', '503']) expect(responses, where).toContain(status);
      if (path.includes('{')) expect(responses, where).toContain('404');
      if (method === 'patch' || method === 'delete') expect(responses.includes('412') || path === '/api-tokens/{tokenId}', where).toBe(true);
      if (o['x-idempotency']) expect(responses, where).toContain('409');
      if (o['x-stability'] === 'planned') expect(responses, where).toContain('501');
      const declared = ((o.parameters ?? []) as { in?: string; name?: string }[]).filter(p => p.in === 'path').map(p => p.name);
      expect(declared, where).toEqual(pathParams(path));
    }
  });
  it('requires Idempotency-Key for money / delivery creates and If-Match for versioned writes', () => {
    for (const id of ['createTransaction', 'createRefund', 'createSubscription', 'createBillPayment', 'createTestDelivery', 'createImportJob', 'createImportCommit'])
      expect(ops.find(x => x.o.operationId === id)?.o['x-idempotency'], id).toBe('required');
    const patchLedger = doc.paths['/ledgers/{ledgerId}'].patch.parameters as { $ref?: string }[];
    expect(patchLedger).toContainEqual({ $ref: '#/components/parameters/IfMatch' });
  });
  it('resolves every $ref', () => {
    const refs = JSON.stringify(doc).match(/"\$ref":"[^"]+"/g)!.map(r => r.slice(8, -1));
    for (const ref of new Set(refs)) {
      const [, , group, name] = ref.split('/');
      expect(doc.components[group], ref).toHaveProperty([name]);
    }
  });
  it('marks exactly the implemented M1 operations stable', () => {
    expect(ops.filter(x => x.o['x-stability'] === 'stable').map(x => x.o.operationId).sort()).toEqual(['createLedger', 'createMembership', 'deleteMembership', 'getLedger', 'getMe', 'listAuditEvents', 'listLedgers', 'listMemberships', 'updateLedger', 'updateMembership']);
  });
});

describe('operation matching', () => {
  const id = '7a1c3a52-5b0e-4e0e-9f43-8d2d0c7f1e11';
  it('matches templates, literals win over method mismatches', () => {
    expect(matchOperation('GET', '/ledgers')).toMatchObject({ kind: 'match', operation: { id: 'listLedgers' } });
    expect(matchOperation('patch', `/ledgers/${id}/memberships/${id}`)).toMatchObject({ kind: 'match', operation: { id: 'updateMembership' }, params: { ledgerId: id, membershipId: id } });
    expect(matchOperation('GET', `/ledgers/${id}/reports/summary`)).toMatchObject({ kind: 'match', operation: { id: 'getReportSummary', stability: 'planned' } });
    expect(matchOperation('GET', '/me/preferences')).toMatchObject({ kind: 'match', operation: { id: 'getPreferences' } });
  });
  it('reports allowed methods and unknown paths', () => {
    expect(matchOperation('PUT', '/ledgers')).toEqual({ kind: 'method', allow: ['GET', 'POST'] });
    expect(matchOperation('DELETE', `/ledgers/${id}`)).toEqual({ kind: 'method', allow: ['GET', 'PATCH'] });
    for (const path of ['/', '/nope', `/ledgers/${id}/unknown`, `/ledgers/${id}/memberships/${id}/extra`]) expect(matchOperation('GET', path)).toEqual({ kind: 'none' });
  });
  it('decodes parameters and refuses malformed escapes', () => {
    expect(matchOperation('GET', '/ledgers/a%2Fb')).toMatchObject({ kind: 'match', params: { ledgerId: 'a/b' } });
    expect(matchOperation('GET', '/ledgers/%E0%A4%A')).toEqual({ kind: 'none' });
  });
});
