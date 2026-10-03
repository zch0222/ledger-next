import { randomUUID } from 'node:crypto';
import { and, asc, eq, gt, isNull, or } from 'drizzle-orm';
import { CategoryCreate, CategoryUpdate, TagCreate, TagUpdate } from '../../contracts/src/finance';
import { database, type Executor, type Tx } from '../../db/src/index';
import { categories, tags } from '../../db/src/schema';
import { ledgerAccess } from './access';
import { audit } from './audit';
import type { AuthContext, Keyset } from './identity';
import { DomainError, requireVersion } from './policy';

type CategoryRow = typeof categories.$inferSelect;
type TagRow = typeof tags.$inferSelect;
export const presentCategory = (row: CategoryRow) => ({
  id: row.id,
  name: row.name,
  kind: row.kind,
  parentId: row.parentId,
  icon: row.icon,
  archivedAt: row.archivedAt?.toISOString() ?? null,
  version: row.version,
});
export const presentTag = (row: TagRow) => ({
  id: row.id,
  name: row.name,
  archivedAt: row.archivedAt?.toISOString() ?? null,
  version: row.version,
});
const notFound = (what: string) => new DomainError(404, 'NOT_FOUND', `${what}不存在或你没有访问权限`);
const duplicate = (error: unknown) =>
  [error, (error as { cause?: unknown })?.cause].some(e => (e as { code?: string })?.code === 'ER_DUP_ENTRY');

export async function listCategories(
  ctx: AuthContext,
  ledgerId: string,
  filter: { includeArchived: boolean } & Keyset,
) {
  await ledgerAccess(database(), ctx, ledgerId, 'viewer');
  const after =
    filter.after &&
    or(
      gt(categories.createdAt, new Date(filter.after[0])),
      and(eq(categories.createdAt, new Date(filter.after[0])), gt(categories.id, filter.after[1])),
    );
  return database()
    .select()
    .from(categories)
    .where(
      and(eq(categories.ledgerId, ledgerId), filter.includeArchived ? undefined : isNull(categories.archivedAt), after),
    )
    .orderBy(asc(categories.createdAt), asc(categories.id))
    .limit(filter.limit + 1);
}
// Two levels at most: a parent must be a top-level, active category of the same kind, which also rules out cycles.
async function validParent(tx: Tx, ledgerId: string, parentId: string, kind: string, childId?: string) {
  const [parent] = await tx
    .select()
    .from(categories)
    .where(and(eq(categories.ledgerId, ledgerId), eq(categories.id, parentId)));
  if (!parent || parent.archivedAt) throw new DomainError(422, 'INVALID_PARENT', '上级分类不存在或已归档');
  if (parent.kind !== kind) throw new DomainError(422, 'INVALID_PARENT', '上级分类的收支类型不一致');
  if (parent.parentId || parent.id === childId) throw new DomainError(422, 'INVALID_PARENT', '分类最多两级');
  if (childId) {
    const [child] = await tx
      .select({ id: categories.id })
      .from(categories)
      .where(and(eq(categories.ledgerId, ledgerId), eq(categories.parentId, childId)))
      .limit(1);
    if (child) throw new DomainError(422, 'INVALID_PARENT', '已有子分类的分类不能再设上级');
  }
}
async function lockCategory(tx: Tx, ledgerId: string, id: string) {
  const [row] = await tx
    .select()
    .from(categories)
    .where(and(eq(categories.ledgerId, ledgerId), eq(categories.id, id)))
    .for('update');
  if (!row) throw notFound('分类');
  return row;
}
export async function createCategory(ctx: AuthContext, ledgerId: string, input: unknown, db: Executor = database()) {
  const data = CategoryCreate.parse(input);
  return db.transaction(async tx => {
    await ledgerAccess(tx, ctx, ledgerId, 'editor', true);
    if (data.parentId) await validParent(tx, ledgerId, data.parentId, data.kind);
    const now = new Date();
    const row = {
      id: randomUUID(),
      ledgerId,
      name: data.name,
      kind: data.kind,
      parentId: data.parentId ?? null,
      icon: data.icon ?? null,
      archivedAt: null,
      version: 1,
      createdAt: now,
      updatedAt: now,
    };
    await tx.insert(categories).values(row);
    await audit(tx, ctx, ledgerId, 'category.created', row.id);
    return presentCategory(row);
  });
}
export async function updateCategory(
  ctx: AuthContext,
  ledgerId: string,
  id: string,
  input: unknown,
  etag: string | null,
) {
  const data = CategoryUpdate.parse(input);
  return database().transaction(async tx => {
    await ledgerAccess(tx, ctx, ledgerId, 'editor', true);
    const row = await lockCategory(tx, ledgerId, id);
    requireVersion(etag, row.version);
    if (data.parentId) await validParent(tx, ledgerId, data.parentId, row.kind, id);
    const changes = {
      ...(data.name !== undefined ? { name: data.name } : {}),
      ...(data.parentId !== undefined ? { parentId: data.parentId } : {}),
      ...(data.icon !== undefined ? { icon: data.icon } : {}),
      version: row.version + 1,
      updatedAt: new Date(),
    };
    await tx
      .update(categories)
      .set(changes)
      .where(and(eq(categories.ledgerId, ledgerId), eq(categories.id, id)));
    await audit(tx, ctx, ledgerId, 'category.updated', id);
    return presentCategory({ ...row, ...changes });
  });
}
/** Referenced categories are only archived, never deleted; history keeps pointing at them. */
export async function archiveCategory(ctx: AuthContext, ledgerId: string, id: string, etag: string | null) {
  return database().transaction(async tx => {
    await ledgerAccess(tx, ctx, ledgerId, 'editor', true);
    const row = await lockCategory(tx, ledgerId, id);
    if (!etag) requireVersion(etag, row.version);
    if (row.archivedAt) return presentCategory(row);
    requireVersion(etag, row.version);
    const changes = { archivedAt: new Date(), version: row.version + 1, updatedAt: new Date() };
    await tx
      .update(categories)
      .set(changes)
      .where(and(eq(categories.ledgerId, ledgerId), eq(categories.id, id)));
    await audit(tx, ctx, ledgerId, 'category.archived', id);
    return presentCategory({ ...row, ...changes });
  });
}

export async function listTags(ctx: AuthContext, ledgerId: string, filter: { includeArchived: boolean } & Keyset) {
  await ledgerAccess(database(), ctx, ledgerId, 'viewer');
  const after =
    filter.after &&
    or(
      gt(tags.createdAt, new Date(filter.after[0])),
      and(eq(tags.createdAt, new Date(filter.after[0])), gt(tags.id, filter.after[1])),
    );
  return database()
    .select()
    .from(tags)
    .where(and(eq(tags.ledgerId, ledgerId), filter.includeArchived ? undefined : isNull(tags.archivedAt), after))
    .orderBy(asc(tags.createdAt), asc(tags.id))
    .limit(filter.limit + 1);
}
async function lockTag(tx: Tx, ledgerId: string, id: string) {
  const [row] = await tx
    .select()
    .from(tags)
    .where(and(eq(tags.ledgerId, ledgerId), eq(tags.id, id)))
    .for('update');
  if (!row) throw notFound('标签');
  return row;
}
const tagExists = () => new DomainError(409, 'TAG_EXISTS', '该账本已有同名标签');
export async function createTag(ctx: AuthContext, ledgerId: string, input: unknown, db: Executor = database()) {
  const data = TagCreate.parse(input);
  try {
    return await db.transaction(async tx => {
      await ledgerAccess(tx, ctx, ledgerId, 'editor', true);
      const now = new Date();
      const row = {
        id: randomUUID(),
        ledgerId,
        name: data.name,
        archivedAt: null,
        version: 1,
        createdAt: now,
        updatedAt: now,
      };
      await tx.insert(tags).values(row);
      await audit(tx, ctx, ledgerId, 'tag.created', row.id);
      return presentTag(row);
    });
  } catch (error) {
    throw duplicate(error) ? tagExists() : error;
  }
}
export async function updateTag(ctx: AuthContext, ledgerId: string, id: string, input: unknown, etag: string | null) {
  const data = TagUpdate.parse(input);
  try {
    return await database().transaction(async tx => {
      await ledgerAccess(tx, ctx, ledgerId, 'editor', true);
      const row = await lockTag(tx, ledgerId, id);
      requireVersion(etag, row.version);
      const changes = { name: data.name, version: row.version + 1, updatedAt: new Date() };
      await tx
        .update(tags)
        .set(changes)
        .where(and(eq(tags.ledgerId, ledgerId), eq(tags.id, id)));
      await audit(tx, ctx, ledgerId, 'tag.updated', id);
      return presentTag({ ...row, ...changes });
    });
  } catch (error) {
    throw duplicate(error) ? tagExists() : error;
  }
}
export async function archiveTag(ctx: AuthContext, ledgerId: string, id: string, etag: string | null) {
  return database().transaction(async tx => {
    await ledgerAccess(tx, ctx, ledgerId, 'editor', true);
    const row = await lockTag(tx, ledgerId, id);
    if (!etag) requireVersion(etag, row.version);
    if (row.archivedAt) return presentTag(row);
    requireVersion(etag, row.version);
    const changes = { archivedAt: new Date(), version: row.version + 1, updatedAt: new Date() };
    await tx
      .update(tags)
      .set(changes)
      .where(and(eq(tags.ledgerId, ledgerId), eq(tags.id, id)));
    await audit(tx, ctx, ledgerId, 'tag.archived', id);
    return presentTag({ ...row, ...changes });
  });
}
