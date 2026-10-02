import { createHmac, randomUUID } from 'node:crypto';
import { createServer, type Socket } from 'node:net';
import { json, route, send } from './server';

// Notification provider mocks (local only; nothing is forwarded to a real provider). Each speaks the public request
// format of its provider and records what it accepted in an inbox, which tests read as independent evidence of
// receipt. Fault injection: POST /__control/channels {service, mode, failNext, failMode, delayMs}.
type Service = 'telegram' | 'feishu' | 'wecom_bot' | 'wecom_app' | 'pushplus' | 'webhook' | 'smtp';
type Mode = 'ok' | 'rate_limited' | 'server_error' | 'timeout' | 'drop' | 'credential' | 'reject';
type State = { mode: Mode; failNext: number; failMode: Mode; delayMs: number; requests: number };
const SERVICES: Service[] = ['telegram', 'feishu', 'wecom_bot', 'wecom_app', 'pushplus', 'webhook', 'smtp'];
const fresh = (): State => ({ mode: 'ok', failNext: 0, failMode: 'server_error', delayMs: 0, requests: 0 });
const state = Object.fromEntries(SERVICES.map(s => [s, fresh()])) as Record<Service, State>;
const inbox: Record<Service, Record<string, unknown>[]> = Object.fromEntries(SERVICES.map(s => [s, []])) as never;
const FEISHU_SECRET = process.env.MOCK_FEISHU_SECRET || 'mock-feishu-signing-secret';
const wecomTokens = new Set<string>();
const wecomRecent = new Map<string, number>();

export function resetChannels() {
  for (const s of SERVICES) { state[s] = fresh(); inbox[s] = []; }
  wecomTokens.clear(); wecomRecent.clear();
}
/** Mode for this request: failNext requests use failMode, then the configured mode applies. */
function modeOf(service: Service): Mode {
  const s = state[service];
  s.requests++;
  if (s.failNext > 0) { s.failNext--; return s.failMode; }
  return s.mode;
}
const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
type Res = Parameters<Parameters<typeof route>[2]>[1];
type Req = Parameters<Parameters<typeof route>[2]>[0];
/** Transport-level faults shared by every HTTP provider; returns true when the request was answered. */
async function transport(service: Service, mode: Mode, _request: Req, response: Res) {
  if (state[service].delayMs) await wait(state[service].delayMs);
  if (mode === 'timeout') return true; // read the request, never answer
  if (mode === 'server_error') { send(response, 503, { error: 'service unavailable' }); return true; }
  return false;
}
/** Success answer, or — in "drop" mode — the provider accepted the message but the answer is lost on the way back. */
function accept(mode: Mode, request: Req, response: Res, status: number, body: unknown) {
  if (mode === 'drop') { request.socket.destroy(); return; }
  send(response, status, body);
}
const record = (service: Service, entry: Record<string, unknown>) => { const item = { id: randomUUID(), at: new Date().toISOString(), ...entry }; inbox[service].push(item); return item; };

// Telegram Bot API: POST /telegram/bot<token>/sendMessage
route('POST', /^\/telegram\/bot([^/]+)\/sendMessage$/, async (request, response, match) => {
  const mode = modeOf('telegram');
  if (await transport('telegram', mode, request, response)) return;
  const token = decodeURIComponent(match[1]), body = json(request.body) ?? {};
  if (mode === 'rate_limited') return send(response, 429, { ok: false, error_code: 429, description: 'Too Many Requests: retry after 2', parameters: { retry_after: 2 } });
  if (mode === 'credential' || token.includes('invalid')) return send(response, 401, { ok: false, error_code: 401, description: 'Unauthorized' });
  if (mode === 'reject' || String(body.chat_id) === '-1') return send(response, 400, { ok: false, error_code: 400, description: 'Bad Request: chat not found' });
  const item = record('telegram', { tokenTail: token.slice(-4), chatId: String(body.chat_id), text: body.text });
  accept(mode, request, response, 200, { ok: true, result: { message_id: inbox.telegram.length, date: Math.floor(Date.now() / 1000), chat: { id: body.chat_id }, text: body.text, mock_id: item.id } });
});

// Feishu custom bot: POST /feishu/open-apis/bot/v2/hook/<id>, optional timestamp + sign (HMAC-SHA256 of "" keyed by "ts\nsecret").
route('POST', /^\/feishu\/open-apis\/bot\/v2\/hook\/([^/]+)$/, async (request, response, match) => {
  const mode = modeOf('feishu');
  if (await transport('feishu', mode, request, response)) return;
  const body = json(request.body) ?? {};
  if (mode === 'rate_limited') return send(response, 200, { code: 9499, msg: 'too many request', data: {} });
  if (mode === 'credential' || match[1] === 'invalid') return send(response, 200, { code: 19001, msg: 'param invalid: incoming webhook access token invalid', data: {} });
  if (body.sign !== undefined) {
    const ts = Number(body.timestamp), expected = createHmac('sha256', `${ts}\n${FEISHU_SECRET}`).update('').digest('base64');
    if (body.sign !== expected || Math.abs(Date.now() / 1000 - ts) > 3600) return send(response, 200, { code: 19021, msg: 'sign match fail or timestamp is not within one hour from current time', data: {} });
  }
  if (mode === 'reject' || body.msg_type !== 'text') return send(response, 200, { code: 19002, msg: 'params error, msg_type need', data: {} });
  record('feishu', { hook: match[1], signed: body.sign !== undefined, text: body.content?.text });
  accept(mode, request, response, 200, { code: 0, msg: 'success', data: {} });
});

// WeCom group robot: POST /wecom/cgi-bin/webhook/send?key=…
route('POST', /^\/wecom\/cgi-bin\/webhook\/send$/, async (request, response) => {
  const mode = modeOf('wecom_bot');
  if (await transport('wecom_bot', mode, request, response)) return;
  const key = new URL(request.url, 'http://mock').searchParams.get('key') ?? '', body = json(request.body) ?? {};
  if (mode === 'rate_limited') return send(response, 200, { errcode: 45009, errmsg: 'api freq out of limit' });
  if (mode === 'credential' || !key || key.includes('invalid')) return send(response, 200, { errcode: 93000, errmsg: 'invalid webhook url' });
  if (mode === 'reject' || body.msgtype !== 'text') return send(response, 200, { errcode: 40008, errmsg: 'invalid message type' });
  record('wecom_bot', { keyTail: key.slice(-4), text: body.text?.content });
  accept(mode, request, response, 200, { errcode: 0, errmsg: 'ok' });
});

// WeCom application message: GET /wecom/cgi-bin/gettoken, POST /wecom/cgi-bin/message/send (duplicate check honoured).
route('GET', /^\/wecom\/cgi-bin\/gettoken$/, async (request, response) => {
  const mode = modeOf('wecom_app');
  if (await transport('wecom_app', mode, request, response)) return;
  const q = new URL(request.url, 'http://mock').searchParams;
  if (mode === 'credential' || (q.get('corpsecret') ?? '').includes('invalid')) return send(response, 200, { errcode: 40001, errmsg: 'invalid credential' });
  const token = `mock-token-${randomUUID()}`;
  wecomTokens.add(token);
  send(response, 200, { errcode: 0, errmsg: 'ok', access_token: token, expires_in: 7200 });
});
route('POST', /^\/wecom\/cgi-bin\/message\/send$/, async (request, response) => {
  const mode = modeOf('wecom_app');
  if (await transport('wecom_app', mode, request, response)) return;
  const token = new URL(request.url, 'http://mock').searchParams.get('access_token') ?? '', body = json(request.body) ?? {};
  if (mode === 'rate_limited') return send(response, 200, { errcode: 45009, errmsg: 'api freq out of limit' });
  if (!wecomTokens.has(token)) return send(response, 200, { errcode: 42001, errmsg: 'access_token expired' });
  if (body.touser === 'nobody') return send(response, 200, { errcode: 81013, errmsg: 'user & party & tag all invalid' });
  const fingerprint = `${body.touser}|${body.agentid}|${body.text?.content}`, seen = wecomRecent.get(fingerprint);
  const duplicate = body.enable_duplicate_check === 1 && seen !== undefined && Date.now() - seen < (Number(body.duplicate_check_interval) || 1800) * 1000;
  if (!duplicate) { wecomRecent.set(fingerprint, Date.now()); record('wecom_app', { toUser: body.touser, agentId: body.agentid, text: body.text?.content }); }
  accept(mode, request, response, 200, { errcode: 0, errmsg: 'ok', invaliduser: '', msgid: `msg-${randomUUID()}` });
});

// pushplus: POST /pushplus/send {token, title, content, template, channel}
route('POST', /^\/pushplus\/send$/, async (request, response) => {
  const mode = modeOf('pushplus');
  if (await transport('pushplus', mode, request, response)) return;
  const body = json(request.body) ?? {};
  if (mode === 'rate_limited') return send(response, 429, { code: 429, msg: '请求过于频繁' }, { 'Retry-After': '2' });
  if (mode === 'credential' || String(body.token ?? '').includes('invalid')) return send(response, 200, { code: 903, msg: '无效的用户token', data: null });
  if (mode === 'reject' || body.channel !== 'wechat') return send(response, 200, { code: 900, msg: '用户账号使用受限', data: null });
  const item = record('pushplus', { tokenTail: String(body.token).slice(-4), title: body.title, content: body.content, template: body.template, channel: body.channel });
  accept(mode, request, response, 200, { code: 200, msg: '请求成功', data: item.id });
});

// Generic webhook receiver: POST /webhook/<id>; records the signed headers so tests can verify the HMAC.
route('POST', /^\/webhook\/([^/]+)$/, async (request, response, match) => {
  const mode = modeOf('webhook');
  if (await transport('webhook', mode, request, response)) return;
  if (mode === 'rate_limited') return send(response, 429, { error: 'slow down' }, { 'Retry-After': '2' });
  if (mode === 'credential' || match[1] === 'gone') return send(response, 410, { error: 'endpoint removed' });
  if (mode === 'reject') return send(response, 400, { error: 'bad payload' });
  record('webhook', { hook: match[1], eventId: request.headers['x-ledger-event-id'], timestamp: request.headers['x-ledger-timestamp'], signature: request.headers['x-ledger-signature'] ?? null, body: request.body });
  accept(mode, request, response, 200, { received: true });
});

// Minimal SMTP server (no TLS / AUTH): enough for the worker's client to deliver; faults per mode.
export function startSmtp(port: number) {
  const server = createServer((socket: Socket) => {
    let buffer = '', data = false, envelope = { from: '', to: [] as string[] }, message = '';
    const reply = (line: string) => socket.write(`${line}\r\n`);
    reply('220 mock-smtp ESMTP ready');
    socket.on('error', () => undefined);
    socket.on('data', chunk => {
      buffer += chunk.toString('utf8');
      let index: number;
      while ((index = buffer.indexOf('\r\n')) >= 0) {
        const line = buffer.slice(0, index);
        buffer = buffer.slice(index + 2);
        if (data) {
          if (line !== '.') { message += `${line.startsWith('..') ? line.slice(1) : line}\n`; continue; }
          data = false;
          const mode = modeOf('smtp');
          if (mode === 'timeout') return;
          if (mode === 'server_error' || mode === 'rate_limited') { reply('451 4.3.0 Temporary failure, try again later'); continue; }
          const unfolded = message.slice(0, message.indexOf('\n\n')).replace(/\n[ \t]+/g, ' ');
          const subject = /^Subject: (.*)$/im.exec(unfolded)?.[1] ?? '';
          const item = record('smtp', { from: envelope.from, to: envelope.to, subject: decodeMime(subject), text: bodyText(message), raw: message });
          if (mode === 'drop') { socket.destroy(); return; } // queued, but the 250 never reaches the client
          reply(`250 2.0.0 Ok: queued as ${item.id}`);
          message = ''; envelope = { from: '', to: [] };
          continue;
        }
        const verb = line.slice(0, 4).toUpperCase();
        if (verb === 'EHLO') { socket.write('250-mock-smtp\r\n250-8BITMIME\r\n250 SMTPUTF8\r\n'); }
        else if (verb === 'HELO') reply('250 mock-smtp');
        else if (verb === 'MAIL') { envelope.from = /<([^>]*)>/.exec(line)?.[1] ?? ''; reply('250 2.1.0 Ok'); }
        else if (verb === 'RCPT') {
          const to = /<([^>]*)>/.exec(line)?.[1] ?? '';
          if (to.includes('bounce') || state.smtp.mode === 'reject') reply('550 5.1.1 Mailbox unavailable');
          else { envelope.to.push(to); reply('250 2.1.5 Ok'); }
        } else if (verb === 'DATA') { data = true; reply('354 End data with <CR><LF>.<CR><LF>'); }
        else if (verb === 'RSET') { envelope = { from: '', to: [] }; message = ''; reply('250 Ok'); }
        else if (verb === 'NOOP') reply('250 Ok');
        else if (verb === 'QUIT') { reply('221 Bye'); socket.end(); }
        else reply('502 5.5.2 Command not recognized');
      }
    });
  });
  server.listen(port, '0.0.0.0');
  return server;
}
/** Plain-text body of a single-part message, decoded from base64 / quoted-printable (what the recipient reads). */
function bodyText(message: string) {
  const split = message.indexOf('\n\n'), headers = message.slice(0, split), body = message.slice(split + 2);
  const encoding = /^Content-Transfer-Encoding:\s*(\S+)/im.exec(headers)?.[1]?.toLowerCase();
  if (encoding === 'base64') return Buffer.from(body.replace(/\s/g, ''), 'base64').toString('utf8');
  if (encoding === 'quoted-printable') return Buffer.from(body.replace(/=\n/g, '').replace(/=([0-9A-F]{2})/gi, (_, hex: string) => String.fromCharCode(parseInt(hex, 16))), 'latin1').toString('utf8');
  return body;
}
/**
 * Decodes an RFC 2047 header value (=?UTF-8?B?…?= / =?UTF-8?Q?…?=). Adjacent encoded words are joined at the byte
 * level first, because a mail client may split one multi-byte character across two words.
 */
function decodeMime(value: string) {
  const parts: (string | Buffer)[] = [];
  let rest = value;
  const word = /=\?utf-8\?([bq])\?([^?]*)\?=/i;
  for (let m = word.exec(rest); m; m = word.exec(rest)) {
    const before = rest.slice(0, m.index);
    if (before.trim() || !(parts.at(-1) instanceof Buffer)) parts.push(before);
    const bytes = m[1].toLowerCase() === 'b' ? Buffer.from(m[2], 'base64') : Buffer.from(m[2].replace(/_/g, ' ').replace(/=([0-9a-f]{2})/gi, (_, hex: string) => String.fromCharCode(parseInt(hex, 16))), 'latin1');
    parts.push(parts.at(-1) instanceof Buffer ? Buffer.concat([parts.pop() as Buffer, bytes]) : bytes);
    rest = rest.slice(m.index + m[0].length);
  }
  parts.push(rest);
  return parts.map(p => (p instanceof Buffer ? p.toString('utf8') : p)).join('');
}

route('GET', /^\/__inbox\/([a-z_]+)$/, (_request, response, match) => {
  const service = match[1] as Service;
  if (!SERVICES.includes(service)) return send(response, 404, { error: 'unknown service' });
  send(response, 200, { messages: inbox[service] });
});
route('DELETE', /^\/__inbox\/([a-z_]+)$/, (_request, response, match) => { const service = match[1] as Service; if (SERVICES.includes(service)) inbox[service] = []; send(response, 200, { cleared: service }); });
route('GET', /^\/__control\/channels$/, (_request, response) => send(response, 200, state));
route('POST', /^\/__control\/channels$/, (request, response) => {
  const body = json(request.body) ?? {};
  const service = body.service as Service;
  if (!SERVICES.includes(service)) return send(response, 400, { error: 'unknown service' });
  const s = state[service];
  if (body.mode !== undefined) s.mode = body.mode;
  if (body.failNext !== undefined) s.failNext = Number(body.failNext);
  if (body.failMode !== undefined) s.failMode = body.failMode;
  if (body.delayMs !== undefined) s.delayMs = Number(body.delayMs);
  if (body.expireTokens) wecomTokens.clear();
  send(response, 200, s);
});
