import { json, route, send } from './server';

// Fixer-compatible FX mock (https://fixer.io/documentation): GET /fixer/latest and GET /fixer/YYYY-MM-DD with
// access_key, base and symbols. Rates are deterministic per minute / per day so tests can predict cross rates.
// Faults: POST /__control/fixer {mode, lagSeconds, jumpFactor}.
const KEY = process.env.MOCK_FIXER_KEY || 'mock-fixer-key';
const EUR: Record<string, number> = { USD: 1.08, CNY: 7.8, HKD: 8.43, JPY: 161, KWD: 0.332, GBP: 0.86 };
type Mode = 'ok' | 'frozen' | 'server_error' | 'timeout' | 'rate_limited' | 'invalid_key' | 'malformed' | 'usage_limit';
// frozen: the provider keeps answering but its quote time stops advancing (market data feed stalled).
const state = { mode: 'ok' as Mode, frozenAt: 0, lagSeconds: 0, jumpFactor: 1, requests: { latest: 0, historical: 0 } };
export function resetFixer() { Object.assign(state, { mode: 'ok', frozenAt: 0, lagSeconds: 0, jumpFactor: 1, requests: { latest: 0, historical: 0 } }); }

/** EUR-based rate of a currency for a minute index or a day index; smooth, bounded variation (±0.3%). */
export function mockRate(code: string, index: number) {
  const base = EUR[code];
  if (base === undefined) return null;
  const wobble = 1 + 0.003 * Math.sin(index / 7 + code.charCodeAt(0));
  return Number((base * wobble).toFixed(6));
}

async function answer(endpoint: string, query: URLSearchParams, response: Parameters<Parameters<typeof route>[2]>[1]) {
  if (state.mode === 'timeout') return; // never answer; the client times out
  if (state.mode === 'server_error') return send(response, 503, { message: 'upstream unavailable' });
  if (state.mode === 'rate_limited') return send(response, 429, { message: 'too many requests' }, { 'Retry-After': '30' });
  if (state.mode === 'malformed') return send(response, 200, '{"success":true,"rates":');
  if (state.mode === 'usage_limit') return send(response, 200, { success: false, error: { code: 104, type: 'usage_limit_reached' } });
  if (state.mode === 'invalid_key' || query.get('access_key') !== KEY) return send(response, 200, { success: false, error: { code: 101, type: 'invalid_access_key' } });
  const base = query.get('base') || 'EUR';
  if (base !== 'EUR') return send(response, 200, { success: false, error: { code: 105, type: 'base_currency_access_restricted' } });
  const symbols = (query.get('symbols') || Object.keys(EUR).join(',')).split(',').filter(Boolean);
  let timestamp: number, date: string, index: number;
  if (endpoint === 'latest') {
    const minute = Math.floor(((state.mode === 'frozen' ? state.frozenAt : Date.now()) - state.lagSeconds * 1000) / 60000);
    timestamp = minute * 60; date = new Date(timestamp * 1000).toISOString().slice(0, 10); index = minute;
  } else {
    const day = Date.parse(`${endpoint}T23:59:59Z`);
    if (Number.isNaN(day) || day - 86400_000 > Date.now()) return send(response, 200, { success: false, error: { code: 302, type: 'invalid_date' } });
    timestamp = Math.floor(Math.min(day, Date.now()) / 1000); date = endpoint; index = Math.floor(day / 86400_000);
  }
  const rates: Record<string, number> = {};
  for (const code of symbols) {
    const value = mockRate(code, index);
    if (value === null) return send(response, 200, { success: false, error: { code: 202, type: 'invalid_currency_codes' } });
    rates[code] = Number((value * (code === 'USD' ? state.jumpFactor : 1)).toFixed(6));
  }
  send(response, 200, { success: true, timestamp, base, date, rates, ...(endpoint === 'latest' ? {} : { historical: true }) });
}

route('GET', /^\/fixer\/latest$/, (request, response) => { state.requests.latest++; return answer('latest', new URL(request.url, 'http://mock').searchParams, response); });
route('GET', /^\/fixer\/(\d{4}-\d{2}-\d{2})$/, (request, response, match) => { state.requests.historical++; return answer(match[1], new URL(request.url, 'http://mock').searchParams, response); });
route('GET', /^\/__control\/fixer$/, (_request, response) => send(response, 200, state));
route('POST', /^\/__control\/fixer$/, (request, response) => {
  const body = json(request.body) ?? {};
  if (body.mode !== undefined) { if (body.mode === 'frozen' && state.mode !== 'frozen') state.frozenAt = Date.now(); state.mode = body.mode; }
  if (body.lagSeconds !== undefined) state.lagSeconds = Number(body.lagSeconds);
  if (body.jumpFactor !== undefined) state.jumpFactor = Number(body.jumpFactor);
  send(response, 200, state);
});
