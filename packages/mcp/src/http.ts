// Streamable HTTP front door for /mcp (API_AGENT_CONTRACT §4.1): Host, Origin, Bearer and size are checked before
// any JSON-RPC is read. Stateless: every POST builds a fresh server bound to the caller's own token.
export const MCP_MAX_BODY = 64 * 1024;
const BEARER = /^Bearer\s+(lnp_[A-Za-z0-9_-]{43})\s*$/i;

export type McpGuardOptions = { appUrl: string; allowedHosts?: string; allowedOrigins?: string };
const list = (value?: string) => (value ?? '').split(',').map(s => s.trim()).filter(Boolean);

export function rpcError(status: number, message: string, headers: Record<string, string> = {}) {
  return Response.json({ jsonrpc: '2.0', error: { code: status === 401 || status === 403 ? -32001 : -32000, message }, id: null },
    { status, headers: { 'Cache-Control': 'no-store', ...headers } });
}
export const unauthorized = (message: string, error?: 'invalid_token') =>
  rpcError(401, message, { 'WWW-Authenticate': `Bearer realm="ledger"${error ? `, error="${error}"` : ''}` });

/** Returns the caller's token, or the response that refuses the request. */
export function guardMcpRequest(request: Request, options: McpGuardOptions): { token: string } | { response: Response } {
  if (request.method !== 'POST') return { response: rpcError(405, '该端点只接受 POST（无状态 Streamable HTTP，不提供 SSE 流）', { Allow: 'POST' }) };
  const app = new URL(options.appUrl);
  const host = request.headers.get('host')?.toLowerCase();
  if (!host || ![app.host.toLowerCase(), ...list(options.allowedHosts).map(h => h.toLowerCase())].includes(host)) return { response: rpcError(421, 'Host 不在允许列表') };
  // Browsers always send Origin on cross-site POSTs; native MCP clients usually send none.
  const origin = request.headers.get('origin');
  if (origin && ![app.origin, ...list(options.allowedOrigins)].includes(origin)) return { response: rpcError(403, 'Origin 不在允许列表') };
  const length = Number(request.headers.get('content-length') ?? 0);
  if (length > MCP_MAX_BODY) return { response: rpcError(413, '请求内容过大') };
  const authorization = request.headers.get('authorization');
  if (!authorization) return { response: unauthorized('需要 Authorization: Bearer <个人访问令牌>') };
  const match = BEARER.exec(authorization);
  if (!match) return { response: unauthorized('令牌格式不正确', 'invalid_token') };
  return { token: match[1] };
}
