import { lookup as dnsLookup, type LookupAddress } from 'node:dns';
import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { isIP } from 'node:net';
import { DomainError } from './policy';

/**
 * Outbound HTTP for user-supplied URLs (webhooks) and provider endpoints (TECHNICAL_DESIGN §6.3, §8):
 * HTTPS only, no credentials in the URL, no redirects, and every resolved address is checked at connect time so a
 * DNS answer cannot point the request at loopback, private, link-local or metadata addresses (DNS rebinding).
 * Self-hosted receivers on a private network need an explicit administrator allowlist (host or host:port).
 */
const V4_BLOCKS: [string, number][] = [
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16], ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.0.2.0', 24],
  ['192.88.99.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15], ['198.51.100.0', 24], ['203.0.113.0', 24], ['224.0.0.0', 4], ['240.0.0.0', 4],
];
const v4 = (ip: string) => ip.split('.').reduce((n, part) => (n << 8) + Number(part), 0) >>> 0;
const inV4 = (ip: string, [net, bits]: [string, number]) => bits === 0 || ((v4(ip) ^ v4(net)) >>> (32 - bits)) === 0;

function expandV6(ip: string) {
  let text = ip.toLowerCase().split('%')[0];
  const dotted = text.match(/(\d+\.\d+\.\d+\.\d+)$/);
  if (dotted) { const n = v4(dotted[1]); text = text.slice(0, -dotted[1].length) + `${(n >>> 16).toString(16)}:${(n & 0xffff).toString(16)}`; }
  const [head, tail] = text.split('::');
  const h = head ? head.split(':') : [], t = tail !== undefined && tail ? tail.split(':') : [];
  const groups = tail === undefined ? h : [...h, ...Array(8 - h.length - t.length).fill('0'), ...t];
  return groups.map(g => parseInt(g || '0', 16));
}
export function isBlockedAddress(ip: string): boolean {
  const family = isIP(ip);
  if (family === 4) return V4_BLOCKS.some(block => inV4(ip, block)) || ip === '255.255.255.255';
  if (family !== 6) return true;
  const g = expandV6(ip);
  const embedded = (hi: number, lo: number) => `${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`;
  if (g.slice(0, 5).every(x => x === 0) && g[5] === 0xffff) return isBlockedAddress(embedded(g[6], g[7])); // ::ffff:a.b.c.d
  if (g[0] === 0x64 && g[1] === 0xff9b && g.slice(2, 6).every(x => x === 0)) return isBlockedAddress(embedded(g[6], g[7])); // NAT64
  if (g.every(x => x === 0) || (g.slice(0, 7).every(x => x === 0) && g[7] === 1)) return true; // :: and ::1
  if ((g[0] & 0xfe00) === 0xfc00 || (g[0] & 0xffc0) === 0xfe80 || (g[0] & 0xff00) === 0xff00) return true; // ULA, link-local, multicast
  if (g[0] === 0x2001 && g[1] === 0x0db8) return true; // documentation
  return false;
}

export type Allowlist = string[];
export const allowlistFrom = (value: string | undefined): Allowlist => (value ?? '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
const allowed = (url: URL, allow: Allowlist) => allow.includes(url.host.toLowerCase()) || allow.includes(url.hostname.toLowerCase());

/** Validates a user-supplied URL before it is stored or used; throws 422 with a field error. */
export function checkOutboundUrl(raw: string, allow: Allowlist, field = 'url') {
  const fail = (message: string): never => { throw new DomainError(422, 'VALIDATION_ERROR', '请检查输入字段', {}, [{ path: field, message, code: 'UNSAFE_URL' }]); };
  let url: URL;
  try { url = new URL(raw); } catch { return fail('不是有效的 URL'); }
  const listed = allowed(url, allow);
  if (url.username || url.password) fail('URL 不能包含账号或密码');
  if (url.protocol !== 'https:' && !(listed && url.protocol === 'http:')) fail('仅支持 HTTPS 地址');
  const host = url.hostname.replace(/^\[|\]$/g, '');
  if (!listed && (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.internal') || host.endsWith('.local'))) fail('不能使用内网或本机地址');
  if (!listed && isIP(host) && isBlockedAddress(host)) fail('不能使用内网、本机或保留地址');
  return { url, listed };
}

type LookupCallback = (error: NodeJS.ErrnoException | null, address: string | LookupAddress[], family?: number) => void;
/** dns.lookup that refuses blocked addresses (checked on the addresses actually used for the connection). */
export function guardedLookup(allow: boolean) {
  return (hostname: string, options: object, callback: LookupCallback) => {
    dnsLookup(hostname, { ...options, all: true }, (error, addresses) => {
      if (error) return callback(error, []);
      const list = addresses as LookupAddress[];
      const bad = allow ? undefined : list.find(a => isBlockedAddress(a.address));
      if (bad || !list.length) return callback(Object.assign(new Error(`blocked address for ${hostname}`), { code: 'EBLOCKEDADDRESS' }), []);
      if ((options as { all?: boolean }).all) return callback(null, list);
      callback(null, list[0].address, list[0].family);
    });
  };
}

export type HttpResult = { status: number; headers: Record<string, string>; body: string };
/**
 * POST / GET without following redirects. `sent` on the error tells whether the request body may have reached the
 * server (a timeout after sending is ambiguous: the provider may have accepted the message).
 */
export function guardedRequest(target: string, init: { method?: 'GET' | 'POST'; headers?: Record<string, string>; body?: string; timeoutMs?: number; allow?: Allowlist }): Promise<HttpResult> {
  const { url, listed } = checkOutboundUrl(target, init.allow ?? []);
  const send = url.protocol === 'https:' ? httpsRequest : httpRequest;
  return new Promise((resolve, reject) => {
    let sent = false;
    const req = send(url, { method: init.method ?? 'POST', headers: { ...(init.body ? { 'Content-Length': String(Buffer.byteLength(init.body)) } : {}), ...init.headers }, lookup: guardedLookup(listed) as never, timeout: init.timeoutMs ?? 10_000 }, res => {
      const chunks: Buffer[] = [];
      let size = 0;
      res.on('data', (c: Buffer) => { size += c.length; if (size <= 64 * 1024) chunks.push(c); });
      res.on('end', () => resolve({ status: res.statusCode ?? 0, headers: Object.fromEntries(Object.entries(res.headers).map(([k, v]) => [k, Array.isArray(v) ? v.join(', ') : v ?? ''])), body: Buffer.concat(chunks).toString('utf8') }));
      res.on('error', error => reject(Object.assign(error, { sent: true })));
    });
    req.on('timeout', () => req.destroy(Object.assign(new Error('timeout'), { code: 'ETIMEDOUT' })));
    req.on('error', error => reject(Object.assign(error, { sent })));
    req.on('finish', () => { sent = true; });
    req.end(init.body);
  });
}
