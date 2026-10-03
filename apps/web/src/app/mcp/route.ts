import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { guardMcpRequest, MCP_MAX_BODY, unauthorized } from '@ledger/mcp/http';
import { restClient } from '@ledger/mcp/rest';
import { createLedgerMcpServer } from '@ledger/mcp/server';
import { handle } from '@/lib/api/router';

export const dynamic = 'force-dynamic';

// The MCP server reaches the ledger only through the REST handler, in process, with the caller's own token —
// the same authentication, scopes, ledger restrictions, approvals and idempotency as any other REST client.
const PREFIX = '/api/v1/';
const inProcess = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const request = new Request(input, init);
  const segments = new URL(request.url).pathname.slice(PREFIX.length).split('/').map(decodeURIComponent);
  return handle(request, { params: Promise.resolve({ segments }) });
}) as typeof fetch;

export async function POST(request: Request) {
  const appUrl = process.env.APP_URL!;
  const guard = guardMcpRequest(request, {
    appUrl,
    allowedHosts: process.env.MCP_ALLOWED_HOSTS,
    allowedOrigins: process.env.MCP_ALLOWED_ORIGINS,
  });
  if ('response' in guard) return guard.response;
  const apiBase = `${appUrl.replace(/\/$/, '')}/api/v1`;
  // The caller's address (from the reverse proxy) travels with every in-process REST call, for rate limits.
  const forwarded = request.headers.get('x-forwarded-for');
  const rest = restClient(apiBase, guard.token, inProcess, forwarded ? { 'X-Forwarded-For': forwarded } : {});
  // A revoked or expired token is refused at the door, so clients can show "needs authentication".
  const me = await rest('GET', '/me');
  if (!me.ok && me.status === 401) return unauthorized('令牌无效、已过期或已撤销', 'invalid_token');
  const server = createLedgerMcpServer(rest, { apiBase });
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
    maxRequestBodySize: MCP_MAX_BODY,
  });
  await server.connect(transport);
  try {
    return await transport.handleRequest(request);
  } finally {
    await server.close();
  }
}

const notAllowed = (request: Request) => {
  const guard = guardMcpRequest(request, { appUrl: process.env.APP_URL! });
  return 'response' in guard ? guard.response : new Response(null, { status: 405 });
};
export { notAllowed as GET, notAllowed as DELETE };
