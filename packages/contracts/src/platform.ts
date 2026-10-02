import { z } from 'zod';
import { LocalDate, LocalTime, Problem, QueryBoolean, ScopeSchema, Timestamp, Timezone, input, output, pageQuery, resource, shared, uuid } from './common';

const version = z.number().int().positive();
const secret = (description: string) => z.string().min(1).max(512).meta({ description, writeOnly: true });

export const ReminderEvent = shared('ReminderEvent', z.enum(['bill_due', 'trial_end', 'cancel_deadline', 'overdue', 'budget_threshold', 'daily_entry', 'weekly_summary', 'monthly_summary', 'fx_threshold', 'delivery_failed']));
const quietHours = z.object({ start: LocalTime, end: LocalTime }).strict();
const reminderFields = {
  eventType: ReminderEvent, subscriptionId: uuid.optional(), budgetId: uuid.optional(),
  leadDays: z.array(z.number().int().min(0).max(30)).max(4).optional().meta({ description: '到期前天数，例如 [7,3,1,0]' }),
  localTime: LocalTime, timezone: Timezone, quietHours: quietHours.optional(), channelIds: z.array(uuid).min(1).max(8),
};
export const ReminderRule = resource('ReminderRule', z.object({
  id: uuid, eventType: ReminderEvent, subscriptionId: uuid.nullable(), budgetId: uuid.nullable(), leadDays: z.array(z.number().int()),
  localTime: z.string(), timezone: z.string(), quietHours: z.object({ start: z.string(), end: z.string() }).nullable(),
  channelIds: z.array(uuid), enabled: z.boolean(), templateVersion: z.number().int(), version,
}), '执行前再次检查规则版本、支付与取消状态');
export const ReminderPreviewCreate = input('ReminderPreviewCreate', z.object(reminderFields).strict());
export const ReminderPreview = resource('ReminderPreview', z.object({
  previewId: uuid, expiresAt: Timestamp,
  nextFireTimes: z.array(z.object({ scheduledAt: Timestamp, localDate: LocalDate, localTime: z.string(), deferredByQuietHours: z.boolean() })).max(3),
  warnings: z.array(z.object({ code: z.string(), message: z.string() })),
}));
export const ReminderRuleUpdate = input('ReminderRuleUpdate', z.object({ enabled: z.boolean().optional(), leadDays: reminderFields.leadDays, localTime: LocalTime.optional(), quietHours: quietHours.nullable().optional(), channelIds: reminderFields.channelIds.optional() }).strict());

export const ChannelType = shared('ChannelType', z.enum(['telegram', 'feishu', 'wecom_bot', 'wecom_app', 'pushplus_wechat', 'email', 'webhook', 'in_app']));
export const NotificationChannel = resource('NotificationChannel', z.object({
  id: uuid, type: ChannelType, name: z.string(), enabled: z.boolean(),
  status: z.enum(['unconfigured', 'verifying', 'active', 'degraded', 'disabled']),
  configSummary: z.record(z.string(), z.string()).meta({ description: '脱敏摘要；永不返回明文凭据' }),
  lastVerifiedAt: Timestamp.nullable(), version,
}));
const channelConfig = z.discriminatedUnion('type', [
  z.object({ type: z.literal('telegram'), botToken: secret('Bot token'), chatId: z.string().max(64) }).strict(),
  z.object({ type: z.literal('feishu'), webhookUrl: z.url().max(512), signingSecret: secret('签名校验密钥').optional() }).strict(),
  z.object({ type: z.literal('wecom_bot'), webhookUrl: z.url().max(512) }).strict(),
  z.object({ type: z.literal('wecom_app'), corpId: z.string().max(64), agentId: z.string().max(32), secret: secret('应用 Secret'), toUser: z.string().max(256) }).strict(),
  z.object({ type: z.literal('pushplus_wechat'), token: secret('pushplus 消息 token') }).strict(),
  z.object({ type: z.literal('email'), address: z.email().max(255) }).strict(),
  z.object({ type: z.literal('webhook'), url: z.url().max(512).meta({ description: '仅 HTTPS；拒绝内网 / metadata 地址' }), secret: secret('HMAC 签名密钥').optional() }).strict(),
  z.object({ type: z.literal('in_app') }).strict(),
]);
export const NotificationChannelCreate = input('NotificationChannelCreate', z.object({ name: z.string().trim().min(1).max(60), config: channelConfig }).strict(), '凭据信封加密保存；个人微信经 pushplus 第三方转发');
export const NotificationChannelUpdate = input('NotificationChannelUpdate', z.object({ name: z.string().trim().min(1).max(60).optional(), enabled: z.boolean().optional(), config: channelConfig.optional() }).strict());
export const DeliveryStatus = output('DeliveryStatus', z.enum(['queued', 'sending', 'accepted', 'delivered', 'failed', 'delivery_unknown', 'expired', 'cancelled']), 'accepted 只表示平台已受理，不代表用户已读');
export const NotificationDelivery = resource('NotificationDelivery', z.object({
  id: uuid, channelId: uuid, channelType: ChannelType, eventType: ReminderEvent.or(z.literal('test')), eventId: z.string(),
  status: DeliveryStatus, scheduledAt: Timestamp, attempts: z.number().int().min(0), lastAttemptAt: Timestamp.nullable(),
  responseClass: z.enum(['ok', 'rate_limited', 'server_error', 'client_error', 'credential_error', 'timeout', 'network']).nullable(), createdAt: Timestamp,
}));
export const TestDeliveryCreate = input('TestDeliveryCreate', z.object({ message: z.string().max(200).optional() }).strict());
export const DeliveryQuery = z.object({ status: DeliveryStatus.optional(), channelId: uuid.optional(), dateFrom: LocalDate.optional(), dateTo: LocalDate.optional(), ...pageQuery }).strict();
export const Notification = resource('Notification', z.object({ id: uuid, eventType: ReminderEvent, title: z.string(), body: z.string(), link: z.string().nullable(), readAt: Timestamp.nullable(), createdAt: Timestamp, version }), '站内通知，作为其他渠道故障时的兜底');
export const NotificationQuery = z.object({ unreadOnly: QueryBoolean, ...pageQuery }).strict();
export const NotificationUpdate = input('NotificationUpdate', z.object({ read: z.boolean() }).strict());

const importError = z.object({ row: z.number().int().min(1), column: z.string().nullable(), code: z.string(), message: z.string() });
export const ImportJob = resource('ImportJob', z.object({
  id: uuid, status: z.enum(['validating', 'validated', 'committing', 'committed', 'failed', 'reverting', 'reverted']),
  fileName: z.string(), fileSha256: z.string(), rowCount: z.number().int().min(0), validRows: z.number().int().min(0), errorRows: z.number().int().min(0),
  errors: z.array(importError).max(100).meta({ description: '最多返回前 100 条行级错误，带行号' }), createdAt: Timestamp, committedAt: Timestamp.nullable(), revertedAt: Timestamp.nullable(),
}), '文件 / 行指纹去重；提交与撤销为异步任务');
export const ImportJobCreate = input('ImportJobCreate', z.object({
  file: z.string().meta({ format: 'binary', description: 'UTF-8 CSV，最大 5 MB' }),
  mapping: z.string().max(4096).meta({ description: 'JSON：CSV 列到 date/amount/currency/account/category/note 的映射' }),
}).strict());
export const ExportJob = resource('ExportJob', z.object({
  id: uuid, status: z.enum(['queued', 'running', 'ready', 'failed', 'expired']), format: z.literal('csv'),
  rowCount: z.number().int().nullable(), downloadUrl: z.string().nullable().meta({ description: '短期有效、需同一用户鉴权的下载地址' }), expiresAt: Timestamp.nullable(), createdAt: Timestamp,
}), 'CSV 输出对 = + - @ 开头单元格转义，防公式注入');
export const ExportJobCreate = input('ExportJobCreate', z.object({ format: z.literal('csv'), dateFrom: LocalDate.optional(), dateTo: LocalDate.optional(), accountId: uuid.optional(), categoryId: uuid.optional() }).strict());

export const ApiToken = resource('ApiToken', z.object({
  id: uuid, name: z.string(), prefix: z.string().meta({ description: '用于辨认的前缀，非完整令牌' }), scopes: z.array(ScopeSchema), ledgerIds: z.array(uuid),
  expiresAt: Timestamp, lastUsedAt: Timestamp.nullable(), revokedAt: Timestamp.nullable(), createdAt: Timestamp,
}), '数据库只存哈希');
export const ApiTokenCreate = input('ApiTokenCreate', z.object({ name: z.string().trim().min(1).max(60), scopes: z.array(ScopeSchema).min(1), ledgerIds: z.array(uuid).min(1).max(20), expiresInDays: z.number().int().min(1).max(365) }).strict(), '默认只读；签发需最近重新认证');
export const ApiTokenCreated = output('ApiTokenCreatedResponse', z.object({ data: ApiToken.schema.extend({ token: z.string().meta({ description: '只在本次响应中出现一次' }) }), meta: z.object({ requestId: uuid }) }));

export const ApprovalRequest = resource('ApprovalRequest', z.object({
  id: uuid, status: z.enum(['pending', 'approved', 'rejected', 'expired', 'consumed']),
  operation: z.object({ method: z.enum(['POST', 'PATCH', 'DELETE']), path: z.string(), bodyHash: z.string() }),
  summary: z.string(), reason: z.string().nullable(), requestedBy: z.object({ id: uuid, name: z.string(), via: z.enum(['session', 'token']) }),
  decidedBy: uuid.nullable(), decidedAt: Timestamp.nullable(), expiresAt: Timestamp, approvalUrl: z.string(), version, createdAt: Timestamp,
}), '批准绑定请求哈希、actor、范围和到期时间；只能由 Web 登录用户批准');
export const ApprovalRequestCreate = input('ApprovalRequestCreate', z.object({
  method: z.enum(['POST', 'PATCH', 'DELETE']), path: z.string().startsWith('/api/v1/ledgers/').max(255), body: z.record(z.string(), z.unknown()).nullable(),
  summary: z.string().trim().min(1).max(500), reason: z.string().max(500).optional(),
}).strict());
export const ApprovalRequestUpdate = input('ApprovalRequestUpdate', z.object({ decision: z.enum(['approved', 'rejected']), note: z.string().max(500).optional() }).strict());
export const ApprovalQuery = z.object({ status: z.enum(['pending', 'approved', 'rejected', 'expired', 'consumed']).optional(), ...pageQuery }).strict();

export const Operation = resource('Operation', z.object({
  id: uuid, type: z.string(), status: z.enum(['pending', 'running', 'succeeded', 'failed']),
  resource: z.object({ type: z.string(), id: uuid, url: z.string() }).nullable(), error: Problem.nullable(), createdAt: Timestamp, completedAt: Timestamp.nullable(),
}), 'Agent 写入超时后用于查询既有结果，避免重复写入');

const accent = z.discriminatedUnion('type', [z.object({ type: z.literal('preset'), value: z.enum(['teal', 'ocean', 'indigo', 'violet', 'rose', 'forest', 'graphite']) }).strict(), z.object({ type: z.literal('custom'), value: z.string().regex(/^#[0-9a-fA-F]{6}$/) }).strict()]);
const paletteMode = z.object({ accent: z.string(), onAccent: z.string(), minContrast: z.string(), adjusted: z.boolean() });
export const Preferences = resource('Preferences', z.object({
  appearance: z.object({ themeMode: z.enum(['system', 'light', 'dark']), accent, palette: z.object({ version: z.number().int(), light: paletteMode, dark: paletteMode }) }), version,
}), '未保存时返回 system + teal；色板由服务端生成器计算');
export const PreferencesUpdate = input('PreferencesUpdate', z.object({ appearance: z.object({ themeMode: z.enum(['system', 'light', 'dark']).optional(), accent: accent.optional() }).strict() }).strict(), '同时刷新 ln_appearance Cookie；非法颜色或未知预设返回 422');
