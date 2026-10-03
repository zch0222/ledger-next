import { createHmac } from 'node:crypto';
import { allowlistFrom, checkOutboundUrl, guardedRequest, type Allowlist, type HttpResult } from './net-guard';

/**
 * Channel adapters (TECHNICAL_DESIGN §6.2). Each speaks the provider's public HTTP protocol and classifies the answer
 * into an outcome the delivery engine acts on:
 * - accepted: the platform took the message (not "read"); delivered: the endpoint itself is the receiver (webhook);
 * - retry: 429 (honouring Retry-After) / 5xx / network failure before the request was sent;
 * - unknown: the request may have reached the provider but no answer came back (never retried automatically);
 * - failed: permanent (bad request, recipient refused); credential errors also pause the channel.
 *
 * Provider hosts can be pointed at local mocks with CHANNEL_ENDPOINT_OVERRIDES
 * ("https://api.telegram.org=http://mock-services:4010/telegram,…"); overridden targets count as allowlisted.
 */
export type ChannelType = 'telegram' | 'feishu' | 'wecom_bot' | 'wecom_app' | 'pushplus_wechat' | 'email' | 'webhook' | 'in_app';
export type ResponseClass = 'ok' | 'rate_limited' | 'server_error' | 'client_error' | 'credential_error' | 'timeout' | 'network';
export type Outcome = 'accepted' | 'delivered' | 'retry' | 'failed' | 'unknown';
export type SendResult = { outcome: Outcome; responseClass: ResponseClass; httpStatus?: number; providerMessageId?: string; retryAfterMs?: number; error?: string };
export type Message = { eventId: string; eventType: string; title: string; body: string; link: string | null; createdAt: string };
export type ChannelConfig =
  | { type: 'telegram'; botToken: string; chatId: string }
  | { type: 'feishu'; webhookUrl: string; signingSecret?: string }
  | { type: 'wecom_bot'; webhookUrl: string }
  | { type: 'wecom_app'; corpId: string; agentId: string; secret: string; toUser: string }
  | { type: 'pushplus_wechat'; token: string; includeDetails?: boolean }
  | { type: 'email'; address: string }
  | { type: 'webhook'; url: string; secret?: string }
  | { type: 'in_app' };

export const OFFICIAL = { telegram: 'https://api.telegram.org', feishu: 'https://open.feishu.cn', lark: 'https://open.larksuite.com', wecom: 'https://qyapi.weixin.qq.com', pushplus: 'https://www.pushplus.plus' } as const;

function overrides(): Map<string, string> {
  return new Map((process.env.CHANNEL_ENDPOINT_OVERRIDES ?? '').split(',').map(s => s.trim()).filter(Boolean).map(pair => {
    const at = pair.indexOf('=');
    return [pair.slice(0, at).replace(/\/$/, ''), pair.slice(at + 1).replace(/\/$/, '')] as [string, string];
  }));
}
/** Rewrites an official provider URL to its configured local mock (tests / development only). */
export function resolveEndpoint(url: string) {
  const parsed = new URL(url), map = overrides(), target = map.get(parsed.origin);
  return target ? `${target}${parsed.pathname}${parsed.search}` : url;
}
function allowlist(): Allowlist {
  const fromOverrides = [...overrides().values()].map(v => new URL(v).host.toLowerCase());
  return [...allowlistFrom(process.env.WEBHOOK_ALLOWLIST), ...fromOverrides];
}

/** Validates a provider webhook URL at configuration time: it must be the provider's own HTTPS endpoint. */
export function checkProviderWebhook(type: 'feishu' | 'wecom_bot', raw: string) {
  const fail = (message: string): never => { throw Object.assign(new Error(message), { field: 'config.webhookUrl' }); };
  let url: URL;
  try { url = new URL(raw); } catch { return fail('不是有效的 URL'); }
  if (type === 'feishu' && !([OFFICIAL.feishu, OFFICIAL.lark] as string[]).includes(url.origin)) fail('请填写飞书自定义机器人的官方 Webhook 地址（open.feishu.cn）');
  if (type === 'feishu' && !url.pathname.startsWith('/open-apis/bot/v2/hook/')) fail('飞书 Webhook 路径应为 /open-apis/bot/v2/hook/…');
  if (type === 'wecom_bot' && (url.origin !== OFFICIAL.wecom || url.pathname !== '/cgi-bin/webhook/send' || !url.searchParams.get('key'))) fail('请填写企业微信群机器人的官方 Webhook 地址（qyapi.weixin.qq.com/cgi-bin/webhook/send?key=…）');
}
export function checkWebhookUrl(raw: string) { return checkOutboundUrl(raw, allowlistFrom(process.env.WEBHOOK_ALLOWLIST), 'config.url'); }

const text = (m: Message, detail = true) => [m.title, detail ? m.body : '', m.link ?? ''].filter(Boolean).join('\n');
const json = (body: string) => { try { return JSON.parse(body) as Record<string, unknown>; } catch { return null; } };
const retryAfter = (r: HttpResult, seconds?: unknown) => {
  const header = Number(r.headers['retry-after']);
  const s = Number.isFinite(Number(seconds)) && Number(seconds) > 0 ? Number(seconds) : Number.isFinite(header) && header > 0 ? header : 30;
  return Math.min(s, 3600) * 1000;
};
/** HTTP-level classification shared by every provider; null means "look at the body". */
function byStatus(r: HttpResult): SendResult | null {
  if (r.status === 429) return { outcome: 'retry', responseClass: 'rate_limited', httpStatus: 429, retryAfterMs: retryAfter(r), error: 'rate limited' };
  if (r.status >= 500) return { outcome: 'retry', responseClass: 'server_error', httpStatus: r.status, error: `HTTP ${r.status}` };
  if (r.status >= 300 && r.status < 400) return { outcome: 'failed', responseClass: 'client_error', httpStatus: r.status, error: 'redirect refused' };
  return null;
}
/** Errors thrown before any response: retry unless the request may already have been received. */
export function classifyError(error: unknown): SendResult {
  const e = error as { code?: string; sent?: boolean; message?: string };
  if (e.code === 'EBLOCKEDADDRESS') return { outcome: 'failed', responseClass: 'client_error', error: 'destination address not allowed' };
  if (e.sent) return { outcome: 'unknown', responseClass: 'timeout', error: 'no response after sending; the provider may have accepted it' };
  return { outcome: 'retry', responseClass: 'network', error: e.code ?? 'network error' };
}

type Sender = (config: never, message: Message, options: { timeoutMs: number }) => Promise<SendResult>;
const post = (url: string, body: unknown, timeoutMs: number, headers: Record<string, string> = {}) =>
  guardedRequest(resolveEndpoint(url), { method: 'POST', body: JSON.stringify(body), headers: { 'Content-Type': 'application/json; charset=utf-8', 'User-Agent': 'LedgerNext/1', ...headers }, timeoutMs, allow: allowlist() });

// Telegram Bot API sendMessage (https://core.telegram.org/bots/api#sendmessage).
const telegram: Sender = async (config: Extract<ChannelConfig, { type: 'telegram' }>, message, { timeoutMs }) => {
  const r = await post(`${OFFICIAL.telegram}/bot${config.botToken}/sendMessage`, { chat_id: config.chatId, text: text(message), disable_web_page_preview: true }, timeoutMs);
  const body = json(r.body) as { ok?: boolean; result?: { message_id?: number }; error_code?: number; description?: string; parameters?: { retry_after?: number } } | null;
  if (r.status === 429) return { outcome: 'retry', responseClass: 'rate_limited', httpStatus: 429, retryAfterMs: retryAfter(r, body?.parameters?.retry_after), error: body?.description ?? 'rate limited' };
  const generic = byStatus(r);
  if (generic) return generic;
  if (r.status === 200 && body?.ok) return { outcome: 'accepted', responseClass: 'ok', httpStatus: 200, providerMessageId: String(body.result?.message_id ?? '') };
  const description = body?.description ?? `HTTP ${r.status}`;
  // 401 / 404: bad token; 403: the user blocked the bot or it was removed from the group — the channel needs attention.
  if (r.status === 401 || r.status === 404 || r.status === 403) return { outcome: 'failed', responseClass: 'credential_error', httpStatus: r.status, error: description };
  return { outcome: 'failed', responseClass: 'client_error', httpStatus: r.status, error: description };
};

// Feishu custom bot (https://open.feishu.cn/document/client-docs/bot-v3/add-custom-bot): optional signature
// sign = base64(HMAC-SHA256(key = "timestamp\nsecret", message = "")).
export function feishuSign(timestamp: number, secret: string) { return createHmac('sha256', `${timestamp}\n${secret}`).update('').digest('base64'); }
const feishu: Sender = async (config: Extract<ChannelConfig, { type: 'feishu' }>, message, { timeoutMs }) => {
  const timestamp = Math.floor(Date.now() / 1000);
  const r = await post(config.webhookUrl, { msg_type: 'text', content: { text: text(message) }, ...(config.signingSecret ? { timestamp: String(timestamp), sign: feishuSign(timestamp, config.signingSecret) } : {}) }, timeoutMs);
  const generic = byStatus(r);
  if (generic) return generic;
  const body = json(r.body) as { code?: number; msg?: string; StatusCode?: number; StatusMessage?: string } | null;
  const code = body?.code ?? body?.StatusCode, msg = body?.msg ?? body?.StatusMessage ?? `HTTP ${r.status}`;
  if (r.status === 200 && code === 0) return { outcome: 'accepted', responseClass: 'ok', httpStatus: 200 };
  if (code === 9499 || code === 11232) return { outcome: 'retry', responseClass: 'rate_limited', httpStatus: r.status, retryAfterMs: 60_000, error: msg };
  if (code === 19021 || code === 19022 || code === 19024 || code === 19001) return { outcome: 'failed', responseClass: 'credential_error', httpStatus: r.status, error: msg };
  return { outcome: 'failed', responseClass: 'client_error', httpStatus: r.status, error: msg };
};

// WeCom group robot (https://developer.work.weixin.qq.com/document/path/91770).
const wecomCodes = (errcode: number | undefined, errmsg: string, status: number): SendResult => {
  if (errcode === 0) return { outcome: 'accepted', responseClass: 'ok', httpStatus: status };
  if (errcode === 45009 || errcode === 45033) return { outcome: 'retry', responseClass: 'rate_limited', httpStatus: status, retryAfterMs: 60_000, error: errmsg };
  if (errcode === -1) return { outcome: 'retry', responseClass: 'server_error', httpStatus: status, error: errmsg };
  if ([93000, 40001, 40013, 40014, 40056, 40091, 42001, 60020, 48002].includes(errcode ?? NaN)) return { outcome: 'failed', responseClass: 'credential_error', httpStatus: status, error: errmsg };
  return { outcome: 'failed', responseClass: 'client_error', httpStatus: status, error: errmsg };
};
const wecomBot: Sender = async (config: Extract<ChannelConfig, { type: 'wecom_bot' }>, message, { timeoutMs }) => {
  const r = await post(config.webhookUrl, { msgtype: 'text', text: { content: text(message) } }, timeoutMs);
  const generic = byStatus(r);
  if (generic) return generic;
  const body = json(r.body) as { errcode?: number; errmsg?: string } | null;
  return wecomCodes(body?.errcode, body?.errmsg ?? `HTTP ${r.status}`, r.status);
};

// WeCom application message: gettoken (cached until shortly before expiry) then message/send. The provider's
// duplicate check (same content within 30 minutes) is enabled, so a retried send does not show twice.
const tokens = new Map<string, { token: string; until: number }>();
async function wecomToken(config: Extract<ChannelConfig, { type: 'wecom_app' }>, timeoutMs: number, fresh = false) {
  const key = `${config.corpId}:${createHmac('sha256', 'wecom').update(config.secret).digest('hex')}`, cached = tokens.get(key);
  if (!fresh && cached && cached.until > Date.now()) return { token: cached.token };
  const url = `${OFFICIAL.wecom}/cgi-bin/gettoken?corpid=${encodeURIComponent(config.corpId)}&corpsecret=${encodeURIComponent(config.secret)}`;
  const r = await guardedRequest(resolveEndpoint(url), { method: 'GET', timeoutMs, allow: allowlist() });
  const generic = byStatus(r);
  if (generic) return { failure: generic };
  const body = json(r.body) as { errcode?: number; errmsg?: string; access_token?: string; expires_in?: number } | null;
  if (body?.errcode !== 0 || !body.access_token) return { failure: wecomCodes(body?.errcode ?? -2, body?.errmsg ?? 'gettoken failed', r.status) };
  tokens.set(key, { token: body.access_token, until: Date.now() + Math.max(60, (body.expires_in ?? 7200) - 300) * 1000 });
  return { token: body.access_token };
}
const wecomApp: Sender = async (config: Extract<ChannelConfig, { type: 'wecom_app' }>, message, { timeoutMs }) => {
  for (const fresh of [false, true]) {
    const got = await wecomToken(config, timeoutMs, fresh);
    if ('failure' in got) return got.failure!;
    const r = await post(`${OFFICIAL.wecom}/cgi-bin/message/send?access_token=${encodeURIComponent(got.token!)}`, { touser: config.toUser, msgtype: 'text', agentid: Number(config.agentId), text: { content: text(message) }, enable_duplicate_check: 1, duplicate_check_interval: 1800 }, timeoutMs);
    const generic = byStatus(r);
    if (generic) return generic;
    const body = json(r.body) as { errcode?: number; errmsg?: string; msgid?: string; invaliduser?: string } | null;
    if ((body?.errcode === 40014 || body?.errcode === 42001) && !fresh) continue; // token expired early: refresh once
    if (body?.errcode === 0 && body.invaliduser) return { outcome: 'failed', responseClass: 'client_error', httpStatus: r.status, error: `接收人无效：${body.invaliduser}` };
    const result = wecomCodes(body?.errcode, body?.errmsg ?? `HTTP ${r.status}`, r.status);
    return body?.msgid ? { ...result, providerMessageId: body.msgid } : result;
  }
  return { outcome: 'failed', responseClass: 'credential_error', error: 'access_token rejected' };
};

// pushplus wechat channel (https://www.pushplus.plus/doc/guide/api.html). By default only the title, the date and
// a link leave the system; amounts and notes only with includeDetails (TECHNICAL_DESIGN §6.2).
const pushplus: Sender = async (config: Extract<ChannelConfig, { type: 'pushplus_wechat' }>, message, { timeoutMs }) => {
  const r = await post(`${OFFICIAL.pushplus}/send`, { token: config.token, title: message.title, content: text(message, Boolean(config.includeDetails)), template: 'txt', channel: 'wechat' }, timeoutMs);
  const generic = byStatus(r);
  if (generic) return generic;
  const body = json(r.body) as { code?: number; msg?: string; data?: unknown } | null;
  const msg = body?.msg ?? `HTTP ${r.status}`;
  if (body?.code === 200) return { outcome: 'accepted', responseClass: 'ok', httpStatus: r.status, providerMessageId: typeof body.data === 'string' ? body.data : undefined };
  if ([401, 403, 903, 905].includes(body?.code ?? NaN)) return { outcome: 'failed', responseClass: 'credential_error', httpStatus: r.status, error: msg };
  if (body?.code === 500 || body?.code === 999) return { outcome: 'retry', responseClass: 'server_error', httpStatus: r.status, error: msg };
  return { outcome: 'failed', responseClass: 'client_error', httpStatus: r.status, error: msg };
};

// Generic webhook: fixed schema, event id for consumer-side dedupe, HMAC over "timestamp.body".
export function webhookSignature(secret: string, timestamp: string, body: string) { return `v1=${createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex')}`; }
const webhook: Sender = async (config: Extract<ChannelConfig, { type: 'webhook' }>, message, { timeoutMs }) => {
  const payload = JSON.stringify({ id: message.eventId, type: message.eventType, createdAt: message.createdAt, data: { title: message.title, body: message.body, link: message.link } });
  const timestamp = String(Math.floor(Date.now() / 1000));
  const r = await guardedRequest(config.url, { method: 'POST', body: payload, timeoutMs, allow: allowlist(), headers: {
    'Content-Type': 'application/json; charset=utf-8', 'User-Agent': 'LedgerNext-Webhook/1', 'X-Ledger-Event-Id': message.eventId, 'X-Ledger-Timestamp': timestamp,
    ...(config.secret ? { 'X-Ledger-Signature': webhookSignature(config.secret, timestamp, payload) } : {}),
  } });
  const generic = byStatus(r);
  if (generic) return generic;
  if (r.status >= 200 && r.status < 300) return { outcome: 'delivered', responseClass: 'ok', httpStatus: r.status };
  if (r.status === 401 || r.status === 403 || r.status === 410) return { outcome: 'failed', responseClass: 'credential_error', httpStatus: r.status, error: `HTTP ${r.status}` };
  return { outcome: 'failed', responseClass: 'client_error', httpStatus: r.status, error: `HTTP ${r.status}` };
};

// Email over SMTP (system mail server, SMTP_URL). A 250 after DATA means the server accepted it, not that it was read.
type Mailer = { sendMail: (mail: Record<string, unknown>) => Promise<{ messageId?: string; response?: string }> };
let mailer: { url: string; transport: Mailer } | null = null;
async function transport() {
  const url = process.env.SMTP_URL;
  if (!url) return null;
  if (mailer?.url !== url) {
    const mod = await import('nodemailer');
    const createTransport = mod.createTransport ?? (mod as unknown as { default: typeof mod }).default.createTransport;
    const timeout = Number(process.env.CHANNEL_TIMEOUT_MS || 10_000);
    // Timeouts belong to the transport options; a second argument would only be message defaults (and be ignored).
    mailer = { url, transport: createTransport({ url, connectionTimeout: timeout, greetingTimeout: timeout, socketTimeout: timeout } as Parameters<typeof createTransport>[0]) as unknown as Mailer };
  }
  return mailer.transport;
}
const email: Sender = async (config: Extract<ChannelConfig, { type: 'email' }>, message) => {
  const smtp = await transport();
  if (!smtp) return { outcome: 'failed', responseClass: 'credential_error', error: 'SMTP is not configured on this server' };
  try {
    const sent = await smtp.sendMail({ from: process.env.SMTP_FROM ?? 'Ledger Next <no-reply@localhost>', to: config.address, subject: message.title, text: text(message), headers: { 'X-Ledger-Event-Id': message.eventId } });
    return { outcome: 'accepted', responseClass: 'ok', providerMessageId: sent.messageId };
  } catch (error) {
    const e = error as { code?: string; responseCode?: number; command?: string; response?: string };
    if (e.code === 'EAUTH') return { outcome: 'failed', responseClass: 'credential_error', error: 'SMTP authentication failed' };
    if (e.responseCode && e.responseCode >= 500) return { outcome: 'failed', responseClass: 'client_error', httpStatus: e.responseCode, error: (e.response ?? `SMTP ${e.responseCode}`).slice(0, 200) };
    if (e.responseCode && e.responseCode >= 400) return { outcome: 'retry', responseClass: 'server_error', httpStatus: e.responseCode, error: (e.response ?? `SMTP ${e.responseCode}`).slice(0, 200) };
    // The connection dropped after DATA was sent: the server may have queued the mail.
    if (e.command === 'DATA' || (e.code === 'ETIMEDOUT' && e.command !== 'CONN')) return { outcome: 'unknown', responseClass: 'timeout', error: 'no answer after the message was sent' };
    return { outcome: 'retry', responseClass: 'network', error: e.code ?? 'SMTP connection failed' };
  }
};

const SENDERS: Record<Exclude<ChannelType, 'in_app'>, Sender> = { telegram, feishu, wecom_bot: wecomBot, wecom_app: wecomApp, pushplus_wechat: pushplus, webhook, email };
/** Sends one message; never throws. Secrets from the configuration are scrubbed from the error text. */
export async function sendMessage(config: Exclude<ChannelConfig, { type: 'in_app' }>, message: Message, timeoutMs = 10_000): Promise<SendResult> {
  let result: SendResult;
  try { result = await SENDERS[config.type](config as never, message, { timeoutMs }); } catch (error) { result = classifyError(error); }
  return result.error ? { ...result, error: scrub(result.error, config) } : result;
}
/** Removes every credential value (and URL keys / tokens) from a provider message before it is stored or logged. */
export function scrub(textValue: string, config: ChannelConfig) {
  let out = textValue;
  for (const [key, value] of Object.entries(config)) {
    if (typeof value !== 'string' || key === 'type' || value.length < 4) continue;
    out = out.split(value).join('••••');
  }
  return out.replace(/(key|token|access_token|corpsecret|secret)=[^&\s"]+/gi, '$1=••••').replace(/bot\d+:[\w-]+/g, 'bot••••').slice(0, 300);
}
