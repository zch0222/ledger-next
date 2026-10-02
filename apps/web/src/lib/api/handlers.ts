import { z } from 'zod';
import { SCOPES } from '../../../../../packages/contracts/src/common';
import type { StableOperationId } from '../../../../../packages/contracts/src/operations';
import type { Executor } from '../../../../../packages/db/src/index';
import { cursorCodec, pageOf, type Position } from '../../../../../packages/domain/src/cursor';
import { DomainError } from '../../../../../packages/domain/src/policy';
import { addMember, changeMember, createLedger, getLedger, listAuditEvents, listLedgers, listMembers, updateLedger, type AuthContext, type Keyset } from '../../../../../packages/domain/src/identity';

export type ApiContext = AuthContext & { user: { name: string; email: string } };
export type ApiResult = { status: 200 | 201 | 204; data?: unknown; headers?: Record<string, string>; page?: { nextCursor: string | null; hasMore: boolean } };
type Input = { ctx: ApiContext; params: Record<string, string>; query: Record<string, unknown>; body: unknown; request: Request; operationId: string };
type Handler = (input: Input, db?: Executor) => Promise<ApiResult>;

const etag = (version: number) => ({ ETag: `"v${version}"` });
const position = z.tuple([z.iso.datetime(), z.uuid()]);
const keysetOf = <T extends { id: string; createdAt: Date }>(row: T): Position => [row.createdAt.toISOString(), row.id];
const omitCreatedAt = <T extends { createdAt: Date }>({ createdAt, ...rest }: T) => { void createdAt; return rest; };

// Cursors bind user, operation, ledger and every filter except paging itself.
async function paged<T extends { id: string; createdAt: Date }, R>(input: Input, fetch: (keyset: Keyset) => Promise<T[]>, present: (row: T) => R): Promise<ApiResult> {
  const { limit, cursor, ...filters } = input.query as { limit: number; cursor?: string };
  const codec = cursorCodec(process.env.BETTER_AUTH_SECRET!);
  const scope = JSON.stringify([input.ctx.userId, input.operationId, input.params.ledgerId ?? null, filters]);
  let after: Keyset['after'];
  if (cursor) {
    const decoded = position.safeParse(codec.decode(scope, cursor));
    if (!decoded.success) throw new DomainError(400, 'INVALID_CURSOR', '分页游标无效或与当前筛选条件不符，请从第一页重新读取');
    after = decoded.data;
  }
  const { data, page } = pageOf(await fetch({ limit, after }), limit, keysetOf, p => codec.encode(scope, p));
  return { status: 200, data: data.map(present), page };
}

// Typed as a complete record: a stable operation without a handler (or a handler for a planned one) fails to compile.
export const handlers: Record<StableOperationId, Handler> = {
  async getMe({ ctx }) {
    const ledgers = (await listLedgers(ctx)).map(omitCreatedAt);
    return { status: 200, data: { id: ctx.userId, ...ctx.user, defaultLedgerId: ledgers[0]?.id ?? null, ledgers, auth: { type: 'session', scopes: [...SCOPES] } } };
  },
  listLedgers: input => paged(input, keyset => listLedgers(input.ctx, keyset), omitCreatedAt),
  async createLedger({ ctx, body }, db) {
    const ledger = await createLedger(ctx, body, db);
    return { status: 201, data: ledger, headers: { Location: `/api/v1/ledgers/${ledger.id}`, ...etag(ledger.version) } };
  },
  async getLedger({ ctx, params }) {
    const ledger = await getLedger(ctx, params.ledgerId);
    return { status: 200, data: ledger, headers: etag(ledger.version) };
  },
  async updateLedger({ ctx, params, body, request }) {
    const ledger = await updateLedger(ctx, params.ledgerId, body, request.headers.get('if-match'));
    return { status: 200, data: ledger, headers: etag(ledger.version) };
  },
  listMemberships: input => paged(input, keyset => listMembers(input.ctx, input.params.ledgerId, keyset), omitCreatedAt),
  async createMembership({ ctx, params, body }, db) {
    const member = await addMember(ctx, params.ledgerId, body, db);
    return { status: 201, data: member, headers: etag(member.version) };
  },
  async updateMembership({ ctx, params, body, request }) {
    const member = (await changeMember(ctx, params.ledgerId, params.membershipId, body, request.headers.get('if-match')))!;
    return { status: 200, data: member, headers: etag(member.version) };
  },
  async deleteMembership({ ctx, params, request }) {
    await changeMember(ctx, params.ledgerId, params.membershipId, null, request.headers.get('if-match'));
    return { status: 204 };
  },
  listAuditEvents: input => paged(input, keyset => listAuditEvents(input.ctx, input.params.ledgerId, { action: input.query.action as string | undefined, ...keyset }), event => ({ ...event, createdAt: event.createdAt.toISOString() })),
};
