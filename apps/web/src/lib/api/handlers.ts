import { z } from 'zod';
import { SCOPES } from '../../../../../packages/contracts/src/common';
import type { StableOperationId } from '../../../../../packages/contracts/src/operations';
import type { Executor } from '../../../../../packages/db/src/index';
import { cursorCodec, pageOf, type Position } from '../../../../../packages/domain/src/cursor';
import { DomainError } from '../../../../../packages/domain/src/policy';
import { addMember, changeMember, createLedger, getLedger, listAuditEvents, listLedgers, listMembers, updateLedger, type AuthContext, type Keyset } from '../../../../../packages/domain/src/identity';
import { archiveAccount, createAccount, getAccount, listAccounts, presentAccount, updateAccount } from '../../../../../packages/domain/src/accounts';
import { archiveCategory, archiveTag, createCategory, createTag, listCategories, listTags, presentCategory, presentTag, updateCategory, updateTag } from '../../../../../packages/domain/src/catalog';
import { correctTransaction, createPreview, createRefund, createTransaction, getTransaction, listTransactions, voidTransaction } from '../../../../../packages/domain/src/transactions';

export type ApiContext = AuthContext & { user: { name: string; email: string } };
export type ApiResult = { status: 200 | 201 | 204; data?: unknown; headers?: Record<string, string>; page?: { nextCursor: string | null; hasMore: boolean } };
type Input = { ctx: ApiContext; params: Record<string, string>; query: Record<string, unknown>; body: unknown; request: Request; operationId: string };
type Handler = (input: Input, db?: Executor) => Promise<ApiResult>;

const etag = (version: number) => ({ ETag: `"v${version}"` });
const ifMatch = (request: Request) => request.headers.get('if-match');
const location = (ledgerId: string, collection: string, id: string) => ({ Location: `/api/v1/ledgers/${ledgerId}/${collection}/${id}` });
const createdPosition = z.tuple([z.iso.datetime(), z.uuid()]);
const keysetOf = <T extends { id: string; createdAt: Date }>(row: T): Position => [row.createdAt.toISOString(), row.id];
const omitCreatedAt = <T extends { createdAt: Date }>({ createdAt, ...rest }: T) => { void createdAt; return rest; };

// Cursors bind user, operation, ledger and every filter except paging itself.
async function pagedBy<T>(input: Input, options: { fetch: (keyset: Keyset) => Promise<T[]>; position: (row: T) => Position; schema: z.ZodType<[string, string]>; present: (rows: T[]) => unknown[] | Promise<unknown[]> }): Promise<ApiResult> {
  const { limit, cursor, ...filters } = input.query as { limit: number; cursor?: string };
  const codec = cursorCodec(process.env.BETTER_AUTH_SECRET!);
  const scope = JSON.stringify([input.ctx.userId, input.operationId, input.params.ledgerId ?? null, filters]);
  let after: Keyset['after'];
  if (cursor) {
    const decoded = options.schema.safeParse(codec.decode(scope, cursor));
    if (!decoded.success) throw new DomainError(400, 'INVALID_CURSOR', '分页游标无效或与当前筛选条件不符，请从第一页重新读取');
    after = decoded.data;
  }
  const { data, page } = pageOf(await options.fetch({ limit, after }), limit, options.position, p => codec.encode(scope, p));
  return { status: 200, data: await options.present(data), page };
}
const paged = <T extends { id: string; createdAt: Date }, R>(input: Input, fetch: (keyset: Keyset) => Promise<T[]>, present: (row: T) => R) =>
  pagedBy(input, { fetch, position: keysetOf, schema: createdPosition, present: rows => rows.map(present) });
const includeArchived = (input: Input) => ({ includeArchived: input.query.includeArchived as boolean });

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
  listAccounts: input => paged(input, keyset => listAccounts(input.ctx, input.params.ledgerId, { ...includeArchived(input), ...keyset }), presentAccount),
  async createAccount({ ctx, params, body }, db) {
    const account = await createAccount(ctx, params.ledgerId, body, db);
    return { status: 201, data: account, headers: { ...location(params.ledgerId, 'accounts', account.id), ...etag(account.version) } };
  },
  async getAccount({ ctx, params }) { const account = await getAccount(ctx, params.ledgerId, params.accountId); return { status: 200, data: account, headers: etag(account.version) }; },
  async updateAccount({ ctx, params, body, request }) { const account = await updateAccount(ctx, params.ledgerId, params.accountId, body, ifMatch(request)); return { status: 200, data: account, headers: etag(account.version) }; },
  async archiveAccount({ ctx, params, request }) { const account = await archiveAccount(ctx, params.ledgerId, params.accountId, ifMatch(request)); return { status: 200, data: account, headers: etag(account.version) }; },
  listCategories: input => paged(input, keyset => listCategories(input.ctx, input.params.ledgerId, { ...includeArchived(input), ...keyset }), presentCategory),
  async createCategory({ ctx, params, body }, db) {
    const category = await createCategory(ctx, params.ledgerId, body, db);
    return { status: 201, data: category, headers: { ...location(params.ledgerId, 'categories', category.id), ...etag(category.version) } };
  },
  async updateCategory({ ctx, params, body, request }) { const category = await updateCategory(ctx, params.ledgerId, params.categoryId, body, ifMatch(request)); return { status: 200, data: category, headers: etag(category.version) }; },
  async archiveCategory({ ctx, params, request }) { const category = await archiveCategory(ctx, params.ledgerId, params.categoryId, ifMatch(request)); return { status: 200, data: category, headers: etag(category.version) }; },
  listTags: input => paged(input, keyset => listTags(input.ctx, input.params.ledgerId, { ...includeArchived(input), ...keyset }), presentTag),
  async createTag({ ctx, params, body }, db) {
    const tag = await createTag(ctx, params.ledgerId, body, db);
    return { status: 201, data: tag, headers: { ...location(params.ledgerId, 'tags', tag.id), ...etag(tag.version) } };
  },
  async updateTag({ ctx, params, body, request }) { const tag = await updateTag(ctx, params.ledgerId, params.tagId, body, ifMatch(request)); return { status: 200, data: tag, headers: etag(tag.version) }; },
  async archiveTag({ ctx, params, request }) { const tag = await archiveTag(ctx, params.ledgerId, params.tagId, ifMatch(request)); return { status: 200, data: tag, headers: etag(tag.version) }; },
  async listTransactions(input) {
    const { limit: _limit, cursor: _cursor, ...filters } = input.query as Parameters<typeof listTransactions>[2] & { cursor?: string };
    void _limit; void _cursor;
    let present: (ids: string[]) => Promise<unknown[]> = async () => [];
    return pagedBy(input, {
      fetch: async keyset => {
        const result = await listTransactions(input.ctx, input.params.ledgerId, { ...filters, ...keyset });
        present = result.present;
        return result.rows.map(row => ({ id: row.id, position: result.position(row) }));
      },
      position: row => row.position, schema: z.tuple([z.string().max(40), z.uuid()]), present: rows => present(rows.map(row => row.id)),
    });
  },
  async createTransactionPreview({ ctx, params, body }) { return { status: 201, data: await createPreview(ctx, params.ledgerId, body) }; },
  async createTransaction({ ctx, params, body }, db) {
    const transaction = await createTransaction(ctx, params.ledgerId, body, db);
    return { status: 201, data: transaction, headers: { ...location(params.ledgerId, 'transactions', transaction.id), ...etag(transaction.version) } };
  },
  async getTransaction({ ctx, params }) { const transaction = await getTransaction(ctx, params.ledgerId, params.transactionId); return { status: 200, data: transaction, headers: etag(transaction.version) }; },
  async updateTransaction({ ctx, params, body, request }, db) { const transaction = await correctTransaction(ctx, params.ledgerId, params.transactionId, body, ifMatch(request), db); return { status: 200, data: transaction, headers: etag(transaction.version) }; },
  async voidTransaction({ ctx, params, request }) { const transaction = await voidTransaction(ctx, params.ledgerId, params.transactionId, ifMatch(request)); return { status: 200, data: transaction, headers: etag(transaction.version) }; },
  async createRefund({ ctx, params, body }, db) {
    const refund = await createRefund(ctx, params.ledgerId, params.transactionId, body, db);
    return { status: 201, data: refund, headers: { ...location(params.ledgerId, 'transactions', refund.id), ...etag(refund.version) } };
  },
  listAuditEvents: input => paged(input, keyset => listAuditEvents(input.ctx, input.params.ledgerId, { action: input.query.action as string | undefined, ...keyset }), event => ({ ...event, createdAt: event.createdAt.toISOString() })),
};
