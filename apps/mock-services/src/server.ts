import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';

// Minimal router for protocol mocks. Each mock registers handlers for the provider's public request format and a
// /__control endpoint for fault injection. Only for local development and the isolated Docker test stack.
export type Handler = (
  request: IncomingMessage & { body: string; url: string },
  response: ServerResponse,
  match: RegExpMatchArray,
) => Promise<void> | void;
const routes: { method: string; pattern: RegExp; handler: Handler }[] = [];
export function route(method: string, pattern: RegExp, handler: Handler) {
  routes.push({ method, pattern, handler });
}
export function send(response: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}) {
  const text = typeof body === 'string' ? body : JSON.stringify(body);
  response.writeHead(status, {
    'Content-Type': typeof body === 'string' ? 'text/plain; charset=utf-8' : 'application/json; charset=utf-8',
    ...headers,
  });
  response.end(text);
}
export const json = (text: string) => {
  try {
    return JSON.parse(text || '{}');
  } catch {
    return null;
  }
};

export function start(port: number) {
  const server = createServer(async (request, response) => {
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(chunk as Buffer);
    const body = Buffer.concat(chunks).toString('utf8');
    const path = new URL(request.url ?? '/', 'http://mock').pathname;
    for (const r of routes) {
      const match = r.method === request.method ? path.match(r.pattern) : null;
      if (!match) continue;
      try {
        await r.handler(Object.assign(request, { body, url: request.url ?? '/' }), response, match);
      } catch (error) {
        if (!response.headersSent) {
          send(response, 500, { error: error instanceof Error ? error.message : 'mock failure' });
        }
      }
      return;
    }
    send(response, 404, { error: 'no mock route', method: request.method, path });
  });
  server.listen(port, '0.0.0.0');
  return server;
}
