import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { database, databasePool } from '../../packages/db/src/index';
import { closeRedis } from '../../packages/db/src/redis';
import { apiTokens, approvalRequests, memberships } from '../../packages/db/src/schema';
import { createAccount } from '../../packages/domain/src/accounts';
import {
  approvalReason,
  bodyHash,
  canonical,
  consumeApproval,
  createApproval,
  createToken,
  decideApproval,
  getApproval,
  getOperation,
  listTokens,
  resolveToken,
  revokeToken,
} from '../../packages/domain/src/agents';
import type { AuthContext } from '../../packages/domain/src/identity';
import { withIdempotency } from '../../packages/domain/src/idempotent';
import { createPreview, createTransaction } from '../../packages/domain/src/transactions';
import { seedLedger, seedUser } from './db';

// M6-SERVER: personal access tokens, approvals bound to one exact request, and operation lookup after a timeout.
let owner: AuthContext;
let editor: AuthContext;
let ledger: string;
let other: string;
let cash: string;
const fresh = (ctx: AuthContext) => ({ ...ctx, auth: { type: 'session' as const, sessionCreatedAt: new Date() } });

beforeAll(async () => {
  owner = { userId: await seedUser(), requestId: randomUUID() };
  editor = { userId: await seedUser(), requestId: randomUUID() };
  ledger = await seedLedger(owner.userId, 'CNY');
  other = await seedLedger(owner.userId, 'CNY');
  await database()
    .insert(memberships)
    .values({ id: randomUUID(), ledgerId: ledger, userId: editor.userId, role: 'editor', createdAt: new Date() });
  cash = (await createAccount(owner, ledger, { name: '现金', type: 'cash', currency: 'CNY', openingBalance: '100000' }))
    .id;
});
afterAll(async () => {
  await closeRedis();
  await databasePool().end();
});

describe('personal access tokens', () => {
  it('are shown once, stored only as a hash, limited to the caller’s ledgers and need a recent sign-in', async () => {
    const created = await createToken(fresh(owner), {
      name: 'Claude Code',
      scopes: ['transactions:read', 'ledgers:read'],
      ledgerIds: [ledger],
      expiresInDays: 30,
    });
    expect(created.token).toMatch(/^lnp_[A-Za-z0-9_-]{43}$/);
    expect(created.prefix).toBe(created.token.slice(0, 12));
    const [stored] = await database().select().from(apiTokens).where(eq(apiTokens.id, created.id));
    expect(JSON.stringify(stored)).not.toContain(created.token);
    expect((await listTokens(owner, { limit: 10 })).map(t => t.id)).toContain(created.id);
    await expect(
      createToken(
        { ...owner, auth: { type: 'session', sessionCreatedAt: new Date(Date.now() - 20 * 60_000) } },
        { name: 'x', scopes: ['ledgers:read'], ledgerIds: [ledger], expiresInDays: 1 },
      ),
    ).rejects.toMatchObject({ code: 'REAUTH_REQUIRED' });
    await expect(
      createToken(
        { ...owner, auth: { type: 'token', tokenId: created.id, scopes: [], ledgerIds: [] } },
        { name: 'x', scopes: ['ledgers:read'], ledgerIds: [ledger], expiresInDays: 1 },
      ),
    ).rejects.toMatchObject({ code: 'SESSION_REQUIRED' });
    await expect(
      createToken(fresh(editor), { name: 'x', scopes: ['ledgers:read'], ledgerIds: [other], expiresInDays: 1 }),
    ).rejects.toMatchObject({ status: 422 });

    const resolved = await resolveToken(created.token);
    expect(resolved).toMatchObject({
      userId: owner.userId,
      auth: { type: 'token', tokenId: created.id, scopes: ['ledgers:read', 'transactions:read'], ledgerIds: [ledger] },
    });
    await expect(resolveToken(`${created.token}x`)).rejects.toMatchObject({ status: 401, code: 'INVALID_TOKEN' });
    await expect(resolveToken('not-a-token')).rejects.toMatchObject({ status: 401 });
    await revokeToken(owner, created.id);
    await expect(resolveToken(created.token)).rejects.toMatchObject({ status: 401 }); // effective on the very next request
    await expect(revokeToken(editor, created.id)).rejects.toMatchObject({ status: 404 });

    const expiring = await createToken(fresh(owner), {
      name: 'short',
      scopes: ['ledgers:read'],
      ledgerIds: [ledger],
      expiresInDays: 1,
    });
    await database()
      .update(apiTokens)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(apiTokens.id, expiring.id));
    await expect(resolveToken(expiring.token)).rejects.toMatchObject({ status: 401 });
  });
});

describe('approvals', () => {
  const tokenCtx = (ctx: AuthContext) => ({
    ...ctx,
    auth: { type: 'token' as const, tokenId: randomUUID(), scopes: ['approvals:write'], ledgerIds: [ledger] },
  });
  it('hash the exact request; only an owner decides; one use; never for another body', async () => {
    expect(canonical({ b: 1, a: [2, { d: 3, c: 4 }] })).toBe('{"a":[2,{"c":4,"d":3}],"b":1}');
    expect(bodyHash({ previewId: 'x', a: 1 })).toBe(bodyHash({ a: 1, previewId: 'x' }));
    const path = `/api/v1/ledgers/${ledger}/transactions/${randomUUID()}`;
    const approval = await createApproval(tokenCtx(editor), ledger, {
      method: 'DELETE',
      path,
      body: null,
      summary: '作废一笔重复记录',
      reason: '高影响',
    });
    expect(approval).toMatchObject({
      status: 'pending',
      operation: { method: 'DELETE', path },
      requestedBy: { id: editor.userId, via: 'token' },
    });
    expect(approval.approvalUrl).toContain(`/ledgers/${ledger}/agents?approval=${approval.id}`);
    await expect(
      createApproval(editor, ledger, {
        method: 'POST',
        path: `/api/v1/ledgers/${other}/transactions`,
        body: {},
        summary: 'x',
      }),
    ).rejects.toMatchObject({ status: 422 });
    await expect(
      createApproval(editor, ledger, {
        method: 'POST',
        path: `/api/v1/ledgers/${ledger}/nothing`,
        body: {},
        summary: 'x',
      }),
    ).rejects.toMatchObject({ status: 422 });

    await expect(
      consumeApproval(editor, ledger, approval.id, { method: 'DELETE', path, body: null }),
    ).rejects.toMatchObject({ code: 'APPROVAL_INVALID' }); // not yet approved
    await expect(decideApproval(editor, ledger, approval.id, { decision: 'approved' }, '"v1"')).rejects.toMatchObject({
      status: 403,
    }); // editors cannot approve
    const decided = await decideApproval(owner, ledger, approval.id, { decision: 'approved' }, '"v1"');
    expect(decided).toMatchObject({ status: 'approved', decidedBy: owner.userId });
    await expect(decideApproval(owner, ledger, approval.id, { decision: 'rejected' }, '"v2"')).rejects.toMatchObject({
      code: 'APPROVAL_CLOSED',
    });
    expect((await getApproval(editor, ledger, approval.id)).status).toBe('approved');

    await expect(
      consumeApproval(editor, ledger, approval.id, { method: 'DELETE', path: `${path}x`, body: null }),
    ).rejects.toMatchObject({ code: 'APPROVAL_INVALID' });
    await expect(
      consumeApproval(owner, ledger, approval.id, { method: 'DELETE', path, body: null }),
    ).rejects.toMatchObject({ code: 'APPROVAL_INVALID' }); // other actor
    const undo = await consumeApproval(editor, ledger, approval.id, { method: 'DELETE', path, body: null });
    await expect(
      consumeApproval(editor, ledger, approval.id, { method: 'DELETE', path, body: null }),
    ).rejects.toMatchObject({ code: 'APPROVAL_INVALID' });
    await undo(); // the write failed: the approval can be used once more
    await consumeApproval(editor, ledger, approval.id, { method: 'DELETE', path, body: null });
    const [stored] = await database().select().from(approvalRequests).where(eq(approvalRequests.id, approval.id));
    expect(stored.status).toBe('consumed');
  });

  it('require approval for destructive operations and large amounts only', async () => {
    expect(await approvalReason('voidTransaction', ledger, null)).toMatch(/网页端批准/);
    expect(await approvalReason('listTransactions', ledger, null)).toBeNull();
    const small = await createPreview(owner, ledger, {
      kind: 'expense',
      accountId: cash,
      settlement: { amount: '99.00', currency: 'CNY' },
      occurredAt: new Date().toISOString(),
      timezone: 'Asia/Hong_Kong',
    });
    const large = await createPreview(owner, ledger, {
      kind: 'expense',
      accountId: cash,
      settlement: { amount: '12000.00', currency: 'CNY' },
      occurredAt: new Date().toISOString(),
      timezone: 'Asia/Hong_Kong',
    });
    expect(await approvalReason('createTransaction', ledger, { previewId: small.previewId })).toBeNull();
    expect(await approvalReason('createTransaction', ledger, { previewId: large.previewId })).toBe(
      '支出 12000.00 CNY：单笔金额达到 10000 CNY，由 Agent 发起时需要网页端批准',
    );
  });
});

describe('operations', () => {
  it('report a completed write by its Idempotency-Key, and say clearly when nothing was written', async () => {
    const key = randomUUID();
    const path = `/api/v1/ledgers/${ledger}/transactions`;
    const preview = await createPreview(owner, ledger, {
      kind: 'expense',
      accountId: cash,
      settlement: { amount: '12.00', currency: 'CNY' },
      occurredAt: new Date().toISOString(),
      timezone: 'Asia/Hong_Kong',
    });
    const result = await withIdempotency(
      { actorId: owner.userId, method: 'POST', path, key, body: { previewId: preview.previewId } },
      async db => {
        const transaction = await createTransaction(owner, ledger, { previewId: preview.previewId }, db);
        return { status: 201, data: transaction, headers: { Location: `${path}/${transaction.id}` } };
      },
    );
    const operation = await getOperation(owner, ledger, key);
    expect(operation).toMatchObject({
      id: key,
      status: 'succeeded',
      type: 'post transactions',
      resource: {
        type: 'transactions',
        id: (result.data as { id: string }).id,
        url: `${path}/${(result.data as { id: string }).id}`,
      },
    });
    await expect(getOperation(editor, ledger, key)).rejects.toMatchObject({ code: 'OPERATION_NOT_FOUND' }); // only the original actor
    await expect(getOperation(owner, other, key)).rejects.toMatchObject({ code: 'OPERATION_NOT_FOUND' });
    await expect(getOperation(owner, ledger, randomUUID())).rejects.toMatchObject({ status: 404 });
  });
});
