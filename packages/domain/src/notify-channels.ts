import { createHash, randomInt, randomUUID } from 'node:crypto';
import { and, asc, eq, gt, isNotNull, isNull, or, sql } from 'drizzle-orm';
import { ChannelVerificationCreate, NotificationChannelCreate, NotificationChannelUpdate, TestDeliveryCreate } from '../../contracts/src/platform';
import { database, type Executor } from '../../db/src/index';
import { notificationChannels, notificationDeliveries } from '../../db/src/schema';
import { checkProviderWebhook, checkWebhookUrl, type ChannelConfig } from './channels';
import type { AuthContext, Keyset } from './identity';
import { cancelQueued, channelAad, ensureInApp, insertDelivery, presentDelivery, type ChannelRow } from './notify-store';
import { DomainError, requireVersion } from './policy';
import { keyIdOf, keyring, mask, rewrap, seal, type Keyring } from './secrets';

// P08 渠道: personal notification channels. Credentials are sealed (envelope encryption) and never returned; the API
// shows a masked summary. A channel is "active" only after a real test delivery was accepted (email: after the
// recipient typed the code from the test mail) — accepted by a platform never means read by a person.
const notFound = () => new DomainError(404, 'NOT_FOUND', '渠道不存在或你没有访问权限');
const field = (path: string, message: string) => new DomainError(422, 'VALIDATION_ERROR', '请检查输入字段', {}, [{ path, message }]);
const CODE_TTL_MS = 30 * 60 * 1000, CODE_ATTEMPTS = 5;
const hashCode = (channelId: string, code: string) => createHash('sha256').update(`${channelId}:${code}`).digest('hex');

function summary(config: ChannelConfig): Record<string, string> {
  switch (config.type) {
    case 'telegram': return { chatId: config.chatId, botToken: mask(config.botToken) };
    case 'feishu': return { webhook: `${new URL(config.webhookUrl).host}/…${config.webhookUrl.slice(-4)}`, signed: config.signingSecret ? '已启用签名' : '未启用签名' };
    case 'wecom_bot': return { webhook: `${new URL(config.webhookUrl).host} · key ${mask(new URL(config.webhookUrl).searchParams.get('key') ?? '')}` };
    case 'wecom_app': return { corpId: config.corpId, agentId: config.agentId, toUser: config.toUser, secret: mask(config.secret) };
    case 'pushplus_wechat': return { token: mask(config.token), details: config.includeDetails ? '含金额与备注' : '仅标题、日期与链接' };
    case 'email': return { address: config.address };
    case 'webhook': { const url = new URL(config.url); return { url: `${url.origin}${url.pathname}`, signed: config.secret ? 'HMAC-SHA256' : '未签名' }; }
    default: return {};
  }
}
function validate(config: ChannelConfig) {
  if (config.type === 'telegram' && !/^(-?\d{1,20}|@[A-Za-z][A-Za-z0-9_]{4,31})$/.test(config.chatId)) throw field('config.chatId', 'chat_id 应为数字 ID 或 @频道名');
  if (config.type === 'telegram' && !/^\d{4,12}:[A-Za-z0-9_-]{20,64}$/.test(config.botToken)) throw field('config.botToken', 'Bot token 格式应为 123456:ABC…');
  if (config.type === 'feishu' || config.type === 'wecom_bot') { try { checkProviderWebhook(config.type, config.webhookUrl); } catch (e) { throw field('config.webhookUrl', (e as Error).message); } }
  if (config.type === 'wecom_app' && !/^\d{1,10}$/.test(config.agentId)) throw field('config.agentId', 'AgentId 应为数字');
  if (config.type === 'webhook') checkWebhookUrl(config.url);
}
export function presentChannel(row: ChannelRow) {
  return { id: row.id, type: row.type, name: row.name, enabled: row.enabled, status: row.status, configSummary: row.configSummary as Record<string, string>,
    lastVerifiedAt: row.lastVerifiedAt?.toISOString() ?? null, lastError: row.lastError, createdAt: row.createdAt.toISOString(), version: row.version };
}
async function own(db: Executor, ctx: AuthContext, id: string, lock = false) {
  const query = db.select().from(notificationChannels).where(and(eq(notificationChannels.id, id), eq(notificationChannels.userId, ctx.userId), isNull(notificationChannels.deletedAt)));
  const [row] = lock ? await query.for('update') : await query;
  if (!row) throw notFound();
  return row;
}

export async function listChannels(ctx: AuthContext, page: Keyset) {
  await ensureInApp(database(), ctx.userId);
  const after = page.after && or(gt(notificationChannels.createdAt, new Date(page.after[0])), and(eq(notificationChannels.createdAt, new Date(page.after[0])), gt(notificationChannels.id, page.after[1])));
  return database().select().from(notificationChannels).where(and(eq(notificationChannels.userId, ctx.userId), isNull(notificationChannels.deletedAt), after))
    .orderBy(asc(notificationChannels.createdAt), asc(notificationChannels.id)).limit(page.limit + 1);
}
export async function getChannel(ctx: AuthContext, id: string) { return own(database(), ctx, id); }

/** Seals the configuration for this row and returns the stored columns. */
function stored(row: { id: string; userId: string }, config: ChannelConfig) {
  if (config.type === 'in_app') return { sealedConfig: null, keyId: null, configSummary: {} };
  const sealedConfig = seal(config, channelAad(row));
  return { sealedConfig, keyId: keyIdOf(sealedConfig), configSummary: summary(config) };
}

export async function createChannel(ctx: AuthContext, body: unknown, db: Executor = database(), now = new Date()) {
  const input = NotificationChannelCreate.parse(body);
  const config = input.config as ChannelConfig;
  validate(config);
  if (config.type === 'in_app') return ensureInApp(db, ctx.userId, now);
  const row = { id: randomUUID(), userId: ctx.userId };
  const values: ChannelRow = { ...row, type: config.type, name: input.name, enabled: true, status: 'verifying', ...stored(row, config),
    verificationHash: null, verificationExpiresAt: null, verificationAttempts: 0, lastVerifiedAt: null, lastError: null, consecutiveFailures: 0, version: 1, createdAt: now, updatedAt: now, deletedAt: null };
  await db.insert(notificationChannels).values(values);
  return values;
}

export async function updateChannel(ctx: AuthContext, id: string, body: unknown, etag: string | null, now = new Date()) {
  const input = NotificationChannelUpdate.parse(body);
  return database().transaction(async tx => {
    const row = await own(tx, ctx, id, true);
    requireVersion(etag, row.version);
    const next: Partial<ChannelRow> = { version: row.version + 1, updatedAt: now };
    if (input.name !== undefined) next.name = input.name;
    if (input.enabled !== undefined) { next.enabled = input.enabled; if (!input.enabled) await cancelQueued(tx, eq(notificationDeliveries.channelId, id), '渠道已停用', now); }
    if (input.config) {
      const config = input.config as ChannelConfig;
      if (config.type !== row.type) throw field('config.type', '渠道类型不能修改，请新建渠道');
      validate(config);
      Object.assign(next, stored(row, config), { status: row.type === 'in_app' ? 'active' : 'verifying', lastError: null, consecutiveFailures: 0, verificationHash: null, verificationExpiresAt: null, verificationAttempts: 0 });
    } else if (input.enabled === true && row.status === 'disabled') {
      // Re-enabling after a credential error needs a fresh verification.
      next.status = 'verifying';
    }
    await tx.update(notificationChannels).set(next).where(eq(notificationChannels.id, id));
    return { ...row, ...next } as ChannelRow;
  });
}

/** Removes the configuration (credentials are wiped at once); pending deliveries are cancelled, history stays. */
export async function deleteChannel(ctx: AuthContext, id: string, etag: string | null, now = new Date()) {
  await database().transaction(async tx => {
    const row = await own(tx, ctx, id, true);
    requireVersion(etag, row.version);
    if (row.type === 'in_app') throw new DomainError(409, 'IN_APP_REQUIRED', '站内通知是兜底渠道，不能删除');
    await cancelQueued(tx, eq(notificationDeliveries.channelId, id), '渠道已删除', now);
    await tx.update(notificationChannels).set({ deletedAt: now, sealedConfig: null, enabled: false, status: 'disabled', version: row.version + 1, updatedAt: now }).where(eq(notificationChannels.id, id));
  });
}

/** A real message through the channel; email test mails carry the verification code. */
export async function createTestDelivery(ctx: AuthContext, channelId: string, body: unknown, db: Executor = database(), now = new Date()) {
  const input = TestDeliveryCreate.parse(body ?? {});
  const row = await own(db, ctx, channelId);
  if (!row.enabled || row.status === 'disabled') throw new DomainError(409, 'CHANNEL_DISABLED', '渠道已停用，请先修改配置后再测试');
  let code: string | undefined;
  if (row.type === 'email') {
    code = String(randomInt(0, 1_000_000)).padStart(6, '0');
    await db.update(notificationChannels).set({ verificationHash: hashCode(row.id, code), verificationExpiresAt: new Date(now.getTime() + CODE_TTL_MS), verificationAttempts: 0, updatedAt: now })
      .where(eq(notificationChannels.id, row.id));
  }
  const eventId = `test:${randomUUID()}`;
  const { row: delivery } = await insertDelivery(db, {
    ledgerId: null, userId: ctx.userId, channelId: row.id, channelType: row.type, ruleId: null, ruleVersion: null, eventType: 'test', eventId, subjectId: null,
    dedupeKey: `test/${eventId}/${row.id}`, templateVersion: 1, scheduledAt: now, expiresAt: new Date(now.getTime() + 60 * 60 * 1000), deferredByQuietHours: false,
    payload: { title: 'Ledger Next 测试消息', kind: 'test', ...(input.message ? { message: input.message } : {}), ...(code ? { code } : {}) },
  }, now);
  return presentDelivery(delivery);
}
export async function getTestDelivery(ctx: AuthContext, channelId: string, deliveryId: string) {
  await own(database(), ctx, channelId);
  const [row] = await database().select().from(notificationDeliveries).where(and(eq(notificationDeliveries.id, deliveryId), eq(notificationDeliveries.channelId, channelId), eq(notificationDeliveries.userId, ctx.userId)));
  if (!row) throw new DomainError(404, 'NOT_FOUND', '投递不存在或你没有访问权限');
  return presentDelivery(row);
}

/** Email: the code from the test mail proves the address receives mail. Five wrong codes invalidate it. */
export async function verifyChannel(ctx: AuthContext, channelId: string, body: unknown, now = new Date()) {
  const { code } = ChannelVerificationCreate.parse(body);
  return database().transaction(async tx => {
    const row = await own(tx, ctx, channelId, true);
    if (row.type !== 'email') throw new DomainError(409, 'NOT_VERIFIABLE', '只有邮件渠道使用验证码；其他渠道在测试消息被平台受理后启用');
    if (!row.verificationHash || !row.verificationExpiresAt || row.verificationExpiresAt <= now || row.verificationAttempts >= CODE_ATTEMPTS)
      throw new DomainError(409, 'CODE_EXPIRED', '验证码已失效，请重新发送测试邮件');
    if (row.verificationHash !== hashCode(row.id, code)) {
      await tx.update(notificationChannels).set({ verificationAttempts: sql`${notificationChannels.verificationAttempts} + 1`, updatedAt: now }).where(eq(notificationChannels.id, row.id));
      throw new DomainError(422, 'CODE_MISMATCH', '验证码不正确', {}, [{ path: 'code', message: '验证码不正确' }]);
    }
    const next = { status: 'active' as const, lastVerifiedAt: now, verificationHash: null, verificationExpiresAt: null, verificationAttempts: 0, lastError: null, version: row.version + 1, updatedAt: now };
    await tx.update(notificationChannels).set(next).where(eq(notificationChannels.id, row.id));
    return { ...row, ...next };
  });
}

/**
 * Key rotation: after prepending a new master key to LEDGER_ENCRYPTION_KEYS, re-wraps every stored data key with it.
 * Plaintext credentials are never re-encrypted or exposed; a row changed concurrently is left for the next run.
 */
export async function rewrapChannelKeys(ring: Keyring = keyring(), only?: { userId: string }) {
  const rows = await database().select({ id: notificationChannels.id, userId: notificationChannels.userId, sealedConfig: notificationChannels.sealedConfig }).from(notificationChannels)
    .where(and(isNotNull(notificationChannels.sealedConfig), only ? eq(notificationChannels.userId, only.userId) : undefined));
  let moved = 0;
  for (const row of rows) {
    const next = rewrap(row.sealedConfig!, channelAad(row), ring);
    if (!next) continue;
    const [result] = await database().update(notificationChannels).set({ sealedConfig: next, keyId: keyIdOf(next) }).where(and(eq(notificationChannels.id, row.id), eq(notificationChannels.sealedConfig, row.sealedConfig!)));
    moved += (result as { affectedRows: number }).affectedRows;
  }
  return { total: rows.length, moved, current: ring.current };
}
