import { describe, expect, it } from 'vitest';
import { fetchFixer, fxConfig, parseFixer, ProviderError } from '../../packages/domain/src/fx-provider';
import { crossFromBatch, historicalFreshness, jumpedCurrency, liveFreshness } from '../../packages/domain/src/fx-pure';
import { normalizeRate } from '../../packages/domain/src/money';

const ok = (rates: string, extra = '') => `{"success":true,"timestamp":1790899200,"base":"EUR","date":"2026-10-02","rates":${rates}${extra}}`;
const symbols = ['CNY', 'EUR', 'HKD', 'JPY', 'USD'];

describe('Fixer protocol parsing', () => {
  it('keeps rate digits exactly as sent, without passing through JS numbers', () => {
    const q = parseFixer(ok('{"USD":1.0812345678901234567,"CNY":7.8,"HKD":8.43,"JPY":161}'), symbols, 'EUR');
    expect(q).toMatchObject({ pivot: 'EUR', date: '2026-10-02', rates: { USD: '1.081234567890123457', CNY: '7.8', HKD: '8.43', JPY: '161' } });
    expect(q.sourceAt.toISOString()).toBe('2026-10-02T00:00:00.000Z');
    expect(parseFixer(ok('{"USD":1.5e-5,"CNY":7.8,"HKD":8.43,"JPY":161}'), symbols, 'EUR').rates.USD).toBe('0.000015');
  });
  it('maps provider error codes and rejects incomplete or foreign batches', () => {
    const kind = (text: string, s = symbols, pivot = 'EUR') => { try { parseFixer(text, s, pivot); return 'parsed'; } catch (e) { return (e as ProviderError).kind; } };
    expect(kind('{"success":false,"error":{"code":101,"type":"invalid_access_key"}}')).toBe('credential');
    expect(kind('{"success":false,"error":{"code":104}}')).toBe('rate_limited');
    expect(kind('{"success":false,"error":{"code":999}}')).toBe('invalid');
    expect(kind('{"success":false}')).toBe('invalid');
    expect(kind('{"success":true,"rates":')).toBe('invalid');
    expect(kind(ok('{"USD":1.08,"CNY":7.8,"HKD":8.43}'))).toBe('invalid'); // JPY missing
    expect(kind(ok('{"USD":1.08,"CNY":7.8,"HKD":8.43,"JPY":0}'))).toBe('invalid');
    expect(kind(ok('{"USD":-1,"CNY":7.8,"HKD":8.43,"JPY":1}'))).toBe('invalid');
    expect(kind(ok('{"USD":"1.08","CNY":7.8,"HKD":8.43,"JPY":1}'))).toBe('parsed'); // already a string
    expect(kind('{"success":true,"timestamp":1,"base":"USD","date":"2026-10-02","rates":{}}')).toBe('invalid');
    expect(kind('{"success":true,"base":"EUR","date":"2026-10-02","rates":{}}', [])).toBe('invalid');
    expect(kind('{"success":true,"timestamp":1,"base":"EUR","rates":{}}', [])).toBe('invalid');
    expect(kind('{"success":false,"error":{"code":101,"type":"invalid_access_key"}}')).toBe('credential');
  });
  it('fetches one batch, classifies HTTP failures and never leaks the key', async () => {
    const config = { ...fxConfig({ FX_PROVIDER_URL: 'https://fx.example/api/', FX_PROVIDER_KEY: 'secret-key' }), timeoutMs: 50 };
    let seen = '';
    const fetcher = (async (url: string) => { seen = url; return new Response(ok('{"USD":1.08,"CNY":7.8,"HKD":8.43,"JPY":161}')); }) as unknown as typeof fetch;
    expect((await fetchFixer(config, 'latest', symbols, fetcher)).rates.USD).toBe('1.08');
    expect(seen).toBe('https://fx.example/api/latest?access_key=secret-key&base=EUR&symbols=CNY%2CHKD%2CJPY%2CUSD');
    const failing = (status: number, headers: Record<string, string> = {}) => (async () => new Response('x', { status, headers })) as unknown as typeof fetch;
    const failure = async (f: typeof fetch, endpoint = 'latest') => { try { await fetchFixer(config, endpoint, symbols, f); return null; } catch (e) { return e as ProviderError; } };
    expect(await failure(failing(429, { 'Retry-After': '30' }))).toMatchObject({ kind: 'rate_limited', retryAfterSeconds: 30 });
    expect((await failure(failing(401)))?.kind).toBe('credential');
    expect((await failure(failing(503)))?.kind).toBe('server');
    expect((await failure(failing(404)))?.kind).toBe('invalid');
    expect((await failure((async () => { throw Object.assign(new Error('t'), { name: 'TimeoutError' }); }) as unknown as typeof fetch))?.kind).toBe('timeout');
    expect((await failure((async () => { throw new TypeError('fetch failed'); }) as unknown as typeof fetch))?.kind).toBe('network');
    expect((await failure(fetcher, 'yesterday'))?.kind).toBe('invalid');
    const unconfigured = await (async () => { try { await fetchFixer(fxConfig({}), 'latest', symbols, fetcher); } catch (e) { return e as ProviderError; } })();
    expect(unconfigured?.message).toBe('FX provider is not configured');
    for (const error of [await failure(failing(503)), await failure(failing(401))]) expect(error?.message).not.toContain('secret-key');
  });
  it('reads configuration with safe defaults', () => {
    expect(fxConfig({})).toMatchObject({ provider: 'fixer', url: '', pivot: 'EUR', timeoutMs: 8000, jumpThreshold: '0.2', staleFailures: 10 });
    expect(fxConfig({ FX_PROVIDER: 'p', FX_PIVOT: 'USD', FX_TIMEOUT_MS: '100', FX_JUMP_THRESHOLD: '0.05', FX_STALE_FAILURES: '3' })).toMatchObject({ provider: 'p', pivot: 'USD', timeoutMs: 100, jumpThreshold: '0.05', staleFailures: 3 });
  });
});

describe('freshness and cross rates', () => {
  it('classifies live quotes by source age and failure streak', () => {
    expect(liveFreshness(0, 0, 10)).toBe('fresh');
    expect(liveFreshness(120_000, 0, 10)).toBe('fresh');
    expect(liveFreshness(120_001, 0, 10)).toBe('delayed');
    expect(liveFreshness(15 * 60_000, 0, 10)).toBe('delayed');
    expect(liveFreshness(15 * 60_000 + 1, 0, 10)).toBe('stale');
    expect(liveFreshness(1000, 10, 10)).toBe('stale');
    expect(historicalFreshness(26 * 3600_000)).toBe('fresh');
    expect(historicalFreshness(26 * 3600_000 + 1)).toBe('stale');
  });
  it('computes cross rates from one batch, with the pivot at 1', () => {
    const rates = { USD: '1.08', CNY: '7.8', JPY: '161' };
    expect(crossFromBatch(rates, 'EUR', 'USD', 'CNY')).toBe('7.222222222222222222');
    expect(crossFromBatch(rates, 'EUR', 'EUR', 'CNY')).toBe('7.8');
    expect(crossFromBatch(rates, 'EUR', 'CNY', 'EUR')).toBe('0.128205128205128205');
    expect(crossFromBatch(rates, 'EUR', 'JPY', 'JPY')).toBe('1');
    expect(crossFromBatch(rates, 'EUR', 'USD', 'HKD')).toBeNull();
  });
  it('flags implausible jumps', () => {
    expect(jumpedCurrency({ USD: '1.08', CNY: '7.8' }, { USD: '1.09', CNY: '7.8' }, '0.2')).toBeNull();
    expect(jumpedCurrency({ USD: '1.08', CNY: '7.8' }, { USD: '1.5', CNY: '7.8' }, '0.2')).toBe('USD');
    expect(jumpedCurrency({ USD: '1.08' }, { USD: '1.08', HKD: '9' }, '0.2')).toBeNull();
  });
  it('normalizes provider rate text to DECIMAL(38,18)', () => {
    expect(normalizeRate('7.12345678901234567890')).toBe('7.123456789012345679');
    expect(normalizeRate('2E+2')).toBe('200');
    expect(() => normalizeRate('0.0000000000000000001')).toThrow('汇率低于可记录精度');
    expect(() => normalizeRate('1e30')).toThrow('汇率超出可记录范围');
    expect(() => normalizeRate('-1')).toThrow('汇率须为正的十进制数');
    expect(() => normalizeRate('abc')).toThrow();
  });
});
