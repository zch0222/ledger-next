// The MCP layer's only way to the ledger: the public REST API with the caller's own token (API_AGENT_CONTRACT §4.1).
// No database access, no system token; every tool call is authorized by REST exactly like any other client.
export type Problem = { status: number; code: string; title: string; requestId?: string; errors?: { path: string; message: string }[]; approval?: { id: string; approvalUrl: string; expiresAt: string } };
export type RestResult<T = unknown> = { ok: true; status: number; data: T; page?: { nextCursor: string | null; hasMore: boolean }; requestId: string; headers: Headers } | { ok: false; status: number; problem: Problem };
export type Rest = <T = unknown>(method: 'GET' | 'POST' | 'PATCH' | 'DELETE', path: string, options?: { query?: Record<string, string | number | boolean | undefined | null>; body?: unknown; headers?: Record<string, string>; timeoutMs?: number }) => Promise<RestResult<T>>;

export function restClient(baseUrl: string, token: string, fetchImpl: typeof fetch = fetch, forward: Record<string, string> = {}): Rest {
  const base = baseUrl.replace(/\/$/, '');
  return async (method, path, options = {}) => {
    const url = new URL(`${base}${path}`);
    for (const [k, v] of Object.entries(options.query ?? {})) if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, String(v));
    let response: Response;
    try {
      response = await fetchImpl(url, { method, headers: { ...forward, Authorization: `Bearer ${token}`, Accept: 'application/json', ...(options.body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...options.headers },
        body: options.body !== undefined ? JSON.stringify(options.body) : undefined, signal: AbortSignal.timeout(options.timeoutMs ?? 20_000) });
    } catch (error) {
      const timeout = (error as Error)?.name === 'TimeoutError';
      // A write that timed out may still have happened: the caller checks ledger_get_operation with the same key.
      return { ok: false, status: 0, problem: { status: 0, code: timeout ? 'TIMEOUT' : 'NETWORK_ERROR', title: timeout ? '请求超时：写入可能已经完成，请用同一幂等键查询 operation，不要换新键重试' : '无法连接账本服务' } };
    }
    if (response.status === 204) return { ok: true, status: 204, data: null as never, requestId: response.headers.get('x-request-id') ?? '', headers: response.headers };
    const body = await response.json().catch(() => null) as { data?: unknown; page?: { nextCursor: string | null; hasMore: boolean }; meta?: { requestId: string } } & Partial<Problem> | null;
    if (!response.ok) return { ok: false, status: response.status, problem: { status: response.status, code: body?.code ?? `HTTP_${response.status}`, title: body?.title ?? response.statusText, requestId: body?.requestId, errors: body?.errors, approval: body?.approval } };
    return { ok: true, status: response.status, data: body?.data as never, page: body?.page, requestId: body?.meta?.requestId ?? response.headers.get('x-request-id') ?? '', headers: response.headers };
  };
}
