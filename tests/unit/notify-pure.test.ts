import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { allowlistFrom, checkOutboundUrl, guardedLookup, isBlockedAddress } from '../../packages/domain/src/net-guard';
import { afterDue, beforeEvent, deferQuietHours, endOfDay, fxDecision, inQuietHours, localTimeOf, nowIn, periodic } from '../../packages/domain/src/reminder-schedule';
import { keyIdOf, keyring, mask, open, parseKeyring, rewrap, seal } from '../../packages/domain/src/secrets';

const key = () => randomBytes(32).toString('base64');

describe('envelope encryption', () => {
  const ring1 = parseKeyring(`k1:${key()}`);
  it('round-trips and binds a ciphertext to its record', () => {
    const sealed = seal({ botToken: '123:abc' }, 'channel-1', ring1);
    expect(sealed).not.toContain('123:abc');
    expect(open(sealed, 'channel-1', ring1)).toEqual({ botToken: '123:abc' });
    expect(() => open(sealed, 'channel-2', ring1)).toThrow();
    const tampered = JSON.parse(sealed); tampered.data = Buffer.from('x').toString('base64');
    expect(() => open(JSON.stringify(tampered), 'channel-1', ring1)).toThrow();
    expect(seal({ a: 1 }, 'r', ring1)).not.toBe(seal({ a: 1 }, 'r', ring1)); // fresh data key and IV each time
  });
  it('rotates master keys without touching plaintext', () => {
    const k1 = ring1.keys.get('k1')!.toString('base64');
    const ring2 = parseKeyring(`k2:${key()},k1:${k1}`);
    const old = seal({ secret: 's' }, 'r', ring1);
    expect(open(old, 'r', ring2)).toEqual({ secret: 's' }); // old records still open
    const moved = rewrap(old, 'r', ring2)!;
    expect(keyIdOf(moved)).toBe('k2');
    expect(open(moved, 'r', parseKeyring(`k2:${ring2.keys.get('k2')!.toString('base64')}`))).toEqual({ secret: 's' });
    expect(rewrap(moved, 'r', ring2)).toBeNull();
    expect(() => open(moved, 'r', ring1)).toThrow(/k2 is not configured/);
    expect(() => open(JSON.stringify({ ...JSON.parse(moved), v: 2 }), 'r', ring2)).toThrow(/unknown sealed format/);
  });
  it('validates key configuration', () => {
    expect(() => parseKeyring(undefined)).toThrow(/required/);
    expect(() => parseKeyring('k1:short')).toThrow(/32 bytes/);
    expect(() => parseKeyring(`bad id:${key()}`)).toThrow();
    const k = key();
    expect(() => parseKeyring(`a:${k},a:${k}`)).toThrow(/duplicate/);
    const before = process.env.LEDGER_ENCRYPTION_KEYS;
    process.env.LEDGER_ENCRYPTION_KEYS = `env1:${k}`;
    expect(keyring().current).toBe('env1');
    expect(keyring()).toBe(keyring()); // cached while the variable is unchanged
    process.env.LEDGER_ENCRYPTION_KEYS = before;
  });
  it('masks credentials for display', () => {
    expect(mask('1234567890:ABCDEFG')).toBe('••••DEFG');
    expect(mask('short')).toBe('••••');
  });
});

describe('outbound URL guard', () => {
  it('blocks private, loopback, link-local, metadata and reserved addresses', () => {
    for (const ip of ['127.0.0.1', '10.1.2.3', '172.16.0.1', '172.31.255.255', '192.168.1.1', '169.254.169.254', '100.64.0.1', '0.0.0.0', '198.18.0.5', '224.0.0.1', '255.255.255.255', '::1', '::', 'fc00::1', 'fd12::3', 'fe80::1', 'ff02::1', '::ffff:127.0.0.1', '::ffff:10.0.0.1', '64:ff9b::a9fe:a9fe', '2001:db8::1', 'not-an-ip'])
      expect(isBlockedAddress(ip), ip).toBe(true);
    for (const ip of ['8.8.8.8', '1.1.1.1', '172.32.0.1', '2606:4700:4700::1111', '::ffff:8.8.8.8', '2001:4860::8888']) expect(isBlockedAddress(ip), ip).toBe(false);
  });
  it('accepts only HTTPS public URLs unless the host is allowlisted', () => {
    expect(checkOutboundUrl('https://hooks.example.com/x', []).listed).toBe(false);
    const reasons = ['http://hooks.example.com/x', 'https://user:pw@hooks.example.com/', 'https://localhost/x', 'https://svc.internal/x', 'https://127.0.0.1/x', 'https://[::1]/x', 'https://169.254.169.254/latest', 'ftp://x.example.com', 'not a url']
      .map(url => { try { checkOutboundUrl(url, []); return 'ok'; } catch (e) { return (e as { errors: { code: string }[] }).errors[0].code; } });
    expect(reasons.every(r => r === 'UNSAFE_URL')).toBe(true);
    const allow = allowlistFrom(' mock-services:4010 , Receiver.LAN ');
    expect(allow).toEqual(['mock-services:4010', 'receiver.lan']);
    expect(checkOutboundUrl('http://mock-services:4010/webhook/a', allow).listed).toBe(true);
    expect(checkOutboundUrl('http://receiver.lan/hook', allow).listed).toBe(true);
    expect(() => checkOutboundUrl('http://mock-services:9999/', allow)).toThrow();
  });
  it('rejects DNS answers that point at blocked addresses at connect time', async () => {
    const resolve = (allow: boolean, host: string, all = false) => new Promise<unknown>(done => guardedLookup(allow)(host, { all }, (error, address) => done(error ? (error as { code?: string }).code : address)));
    expect(await resolve(false, 'localhost')).toBe('EBLOCKEDADDRESS');
    expect(await resolve(true, 'localhost')).toMatch(/^(127\.0\.0\.1|::1)$/);
    expect(await resolve(true, 'localhost', true)).toEqual(expect.arrayContaining([expect.objectContaining({ address: expect.any(String) })]));
    expect(await resolve(false, 'no-such-host.invalid')).toMatch(/ENOTFOUND|EAI_AGAIN/);
  });
});

describe('reminder fire times', () => {
  const tz = 'Asia/Hong_Kong';
  it('handles quiet hours inside a day and across midnight', () => {
    expect(inQuietHours('23:00', { start: '22:00', end: '08:00' })).toBe(true);
    expect(inQuietHours('07:59', { start: '22:00', end: '08:00' })).toBe(true);
    expect(inQuietHours('08:00', { start: '22:00', end: '08:00' })).toBe(false);
    expect(inQuietHours('13:00', { start: '12:00', end: '14:00' })).toBe(true);
    expect(inQuietHours('13:00', null)).toBe(false);
    expect(inQuietHours('13:00', { start: '09:00', end: '09:00' })).toBe(false);
    expect(deferQuietHours('2026-10-02', '23:30', { start: '22:00', end: '08:00' })).toEqual({ date: '2026-10-03', time: '08:00', deferred: true });
    expect(deferQuietHours('2026-10-02', '06:00', { start: '22:00', end: '08:00' })).toEqual({ date: '2026-10-02', time: '08:00', deferred: true });
    expect(deferQuietHours('2026-10-02', '12:30', { start: '12:00', end: '14:00' })).toEqual({ date: '2026-10-02', time: '14:00', deferred: true });
    expect(deferQuietHours('2026-10-02', '09:00', { start: '22:00', end: '08:00' }).deferred).toBe(false);
  });
  it('schedules lead days before an event in the receiver timezone', () => {
    const fires = beforeEvent('2026-10-10', [0, 7, 3, 3], '09:00', tz, null);
    expect(fires.map(f => f.scheduledAt.toISOString())).toEqual(['2026-10-03T01:00:00.000Z', '2026-10-07T01:00:00.000Z', '2026-10-10T01:00:00.000Z']);
    expect(fires.map(f => f.lead)).toEqual([7, 3, 0]);
    // Each slot expires when the next one starts; the last one at the end of the event day.
    expect(fires.map(f => f.expiresAt.toISOString())).toEqual(['2026-10-07T01:00:00.000Z', '2026-10-10T01:00:00.000Z', '2026-10-10T16:00:00.000Z']);
    const quiet = beforeEvent('2026-10-10', [1], '23:00', tz, { start: '22:00', end: '08:00' })[0];
    expect(quiet).toMatchObject({ localDate: '2026-10-10', localTime: '08:00', deferredByQuietHours: true });
    expect(afterDue('2026-10-10', '09:00', tz, null)).toMatchObject({ localDate: '2026-10-11', localTime: '09:00' });
    expect(endOfDay('2026-03-08', 'America/New_York').toISOString()).toBe('2026-03-09T04:00:00.000Z');
    // DST gap: 02:30 does not exist on 2026-03-08 in New York and moves to 03:00.
    expect(beforeEvent('2026-03-08', [0], '02:30', 'America/New_York', null)[0].scheduledAt.toISOString()).toBe('2026-03-08T07:00:00.000Z');
  });
  it('lists periodic summaries', () => {
    expect(periodic('daily', '2026-10-02', 2, '21:00', tz, null).map(f => f.localDate)).toEqual(['2026-10-02', '2026-10-03']);
    expect(periodic('weekly', '2026-10-02', 2, '09:00', tz, null).map(f => f.localDate)).toEqual(['2026-10-05', '2026-10-12']);
    expect(periodic('monthly', '2026-10-02', 2, '09:00', tz, null).map(f => f.localDate)).toEqual(['2026-11-01', '2026-12-01']);
    expect(localTimeOf(new Date('2026-10-02T01:05:00Z'), tz)).toBe('09:05');
    expect(nowIn(tz, new Date('2026-10-02T17:00:00Z'))).toEqual({ date: '2026-10-03', time: '01:00' });
  });
});

describe('FX threshold decisions', () => {
  const t0 = new Date('2026-10-02T00:00:00Z'), at = (minutes: number) => new Date(t0.getTime() + minutes * 60_000);
  it('fires once when crossing, stays quiet while jittering, re-arms after the hysteresis band and respects the cooldown', () => {
    let d = fxDecision(null, '7.10', '7.20', null, at(0));
    expect(d).toMatchObject({ fire: null, changed: true });
    d = fxDecision(d.next, '7.21', '7.20', null, at(1));
    expect(d.fire).toBe('above');
    d = fxDecision(d.next, '7.205', '7.20', null, at(2)); // still above: no repeat
    expect(d.fire).toBeNull();
    d = fxDecision(d.next, '7.19', '7.20', null, at(3)); // inside the 0.2 % band: not re-armed
    expect(d.next.above).toBe('fired');
    d = fxDecision(d.next, '7.18', '7.20', null, at(4)); // 7.18 < 7.1856: re-armed
    expect(d.next.above).toBe('armed');
    expect(fxDecision(d.next, '7.25', '7.20', null, at(60)).fire).toBeNull(); // cooldown (6 h) not over
    expect(fxDecision(d.next, '7.25', '7.20', null, at(6 * 60 + 1)).fire).toBe('above');
  });
  it('handles the lower limit and both limits together', () => {
    const low = fxDecision(null, '6.90', null, '6.95', t0);
    expect(low.fire).toBe('below');
    expect(fxDecision(low.next, '6.97', null, '6.95', at(400)).next.below).toBe('armed'); // 6.97 > 6.9639
    const both = fxDecision(null, '7.00', '7.20', '6.95', t0);
    expect(both).toMatchObject({ fire: null, changed: true });
    expect(fxDecision({ above: 'armed', below: 'armed', lastFiredAt: null }, '7.00', '7.20', '6.95', t0).changed).toBe(false);
  });
});
