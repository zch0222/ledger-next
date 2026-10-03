import { normalizeRate } from './money';

// Fixer-compatible provider adapter (https://fixer.io/documentation). Endpoints: GET {url}/latest and GET {url}/{YYYY-MM-DD}
// with access_key, base and symbols. Fixer answers HTTP 200 with {success:false, error:{code}} for API errors, so the body
// is checked, not only the status. Tests and local runs point FX_PROVIDER_URL at the mock in apps/mock-services.
export type ProviderQuote = { pivot: string; sourceAt: Date; date: string; rates: Record<string, string> };
export type ProviderFailure = 'rate_limited' | 'credential' | 'server' | 'timeout' | 'network' | 'invalid';
export class ProviderError extends Error {
  constructor(
    public kind: ProviderFailure,
    message: string,
    public retryAfterSeconds?: number,
  ) {
    super(message);
  }
}
export type FxConfig = {
  provider: string;
  url: string;
  key: string;
  pivot: string;
  timeoutMs: number;
  jumpThreshold: string;
  staleFailures: number;
};

export function fxConfig(env: Record<string, string | undefined> = process.env): FxConfig {
  return {
    provider: env.FX_PROVIDER || 'fixer',
    url: (env.FX_PROVIDER_URL || '').replace(/\/$/, ''),
    key: env.FX_PROVIDER_KEY || '',
    pivot: env.FX_PIVOT || 'EUR',
    timeoutMs: Number(env.FX_TIMEOUT_MS || 8000),
    jumpThreshold: env.FX_JUMP_THRESHOLD || '0.2',
    staleFailures: Number(env.FX_STALE_FAILURES || 10),
  };
}

const FIXER_ERRORS: Record<number, ProviderFailure> = {
  101: 'credential',
  102: 'credential',
  103: 'invalid',
  104: 'rate_limited',
  105: 'credential',
  106: 'invalid',
  201: 'invalid',
  202: 'invalid',
  302: 'invalid',
};

/** Parses a Fixer body without passing rates through JS numbers: the reviver reads each number's source text. */
export function parseFixer(text: string, symbols: readonly string[], pivot: string): ProviderQuote {
  let body: {
    success?: unknown;
    error?: { code?: unknown; type?: unknown };
    base?: unknown;
    timestamp?: unknown;
    date?: unknown;
    rates?: Record<string, unknown>;
  };
  try {
    body = JSON.parse(text, (_key, value, context?: { source?: string }) =>
      typeof value === 'number' && context?.source ? context.source : value,
    );
  } catch {
    throw new ProviderError('invalid', 'FX provider returned malformed JSON');
  }
  if (body?.success !== true) {
    const code = Number(body?.error?.code);
    throw new ProviderError(
      FIXER_ERRORS[code] ?? 'invalid',
      `FX provider error ${Number.isFinite(code) ? code : 'unknown'}${typeof body?.error?.type === 'string' ? ` (${body.error.type.slice(0, 60)})` : ''}`,
    );
  }
  if (body.base !== pivot) {
    throw new ProviderError('invalid', `FX provider pivot ${String(body.base).slice(0, 8)} ≠ ${pivot}`);
  }
  const seconds = Number(body.timestamp);
  if (!Number.isInteger(seconds) || seconds <= 0) throw new ProviderError('invalid', 'FX provider timestamp missing');
  if (typeof body.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(body.date)) {
    throw new ProviderError('invalid', 'FX provider date missing');
  }
  const rates: Record<string, string> = {};
  for (const symbol of symbols) {
    if (symbol === pivot) continue;
    const raw = body.rates?.[symbol];
    if (typeof raw !== 'string') throw new ProviderError('invalid', `FX provider omitted ${symbol}`);
    try {
      rates[symbol] = normalizeRate(raw);
    } catch {
      throw new ProviderError('invalid', `FX provider sent an invalid ${symbol} rate`);
    }
  }
  return { pivot, sourceAt: new Date(seconds * 1000), date: body.date, rates };
}

/** One request for the whole batch of active currencies; the access key never appears in errors or logs. */
export async function fetchFixer(
  config: FxConfig,
  endpoint: 'latest' | string,
  symbols: readonly string[],
  fetcher: typeof fetch = fetch,
): Promise<ProviderQuote> {
  if (!config.url) throw new ProviderError('invalid', 'FX provider is not configured');
  if (endpoint !== 'latest' && !/^\d{4}-\d{2}-\d{2}$/.test(endpoint)) {
    throw new ProviderError('invalid', 'Invalid historical date');
  }
  const query = new URLSearchParams({
    access_key: config.key,
    base: config.pivot,
    symbols: symbols.filter(s => s !== config.pivot).join(','),
  });
  let response: Response;
  try {
    response = await fetcher(`${config.url}/${endpoint}?${query}`, {
      signal: AbortSignal.timeout(config.timeoutMs),
      headers: { Accept: 'application/json' },
    });
  } catch (error) {
    const name = (error as { name?: string })?.name;
    throw new ProviderError(
      name === 'TimeoutError' || name === 'AbortError' ? 'timeout' : 'network',
      name === 'TimeoutError' ? 'FX provider timed out' : 'FX provider unreachable',
    );
  }
  if (response.status === 429) {
    throw new ProviderError(
      'rate_limited',
      'FX provider rate limited',
      Number(response.headers.get('retry-after')) || undefined,
    );
  }
  if (response.status === 401 || response.status === 403) {
    throw new ProviderError('credential', `FX provider rejected credentials (${response.status})`);
  }
  if (response.status >= 500) throw new ProviderError('server', `FX provider server error ${response.status}`);
  if (!response.ok) throw new ProviderError('invalid', `FX provider HTTP ${response.status}`);
  return parseFixer(await response.text(), symbols, config.pivot);
}
