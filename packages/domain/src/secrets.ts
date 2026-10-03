import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

/**
 * Envelope encryption for channel credentials (TECHNICAL_DESIGN §6.3). Every record gets its own random data key
 * (AES-256-GCM); the data key is wrapped with the current master key, named by a key id so masters can rotate:
 * `rewrap` moves a record to the newest master without touching its plaintext. Associated data (the record id and
 * owner) binds a ciphertext to its row, so copying it to another row fails to decrypt.
 *
 * LEDGER_ENCRYPTION_KEYS = "k2:<base64 32 bytes>,k1:<base64 32 bytes>" — the first entry encrypts, all decrypt.
 */
export type Keyring = { current: string; keys: Map<string, Buffer> };
type Sealed = { v: 1; kid: string; wrap: string; iv: string; tag: string; data: string };

export function parseKeyring(value: string | undefined): Keyring {
  const entries = (value ?? '')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean)
    .map(entry => {
      const at = entry.indexOf(':');
      const id = entry.slice(0, at);
      const key = Buffer.from(entry.slice(at + 1), 'base64');
      if (at < 1 || !/^[A-Za-z0-9_-]{1,16}$/.test(id) || key.length !== 32) {
        throw new Error('LEDGER_ENCRYPTION_KEYS entries must be "<id>:<base64 of 32 bytes>"');
      }
      return [id, key] as const;
    });
  if (!entries.length) throw new Error('LEDGER_ENCRYPTION_KEYS is required to store channel credentials');
  if (new Set(entries.map(([id]) => id)).size !== entries.length) {
    throw new Error('LEDGER_ENCRYPTION_KEYS has duplicate key ids');
  }
  return { current: entries[0][0], keys: new Map(entries) };
}
let cached: { source: string | undefined; ring: Keyring } | null = null;
export function keyring() {
  const source = process.env.LEDGER_ENCRYPTION_KEYS;
  if (cached?.source !== source) cached = { source, ring: parseKeyring(source) };
  return cached!.ring;
}

function gcm(key: Buffer, plaintext: Buffer, aad: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(Buffer.from(aad));
  const data = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return { iv, tag: cipher.getAuthTag(), data };
}
function ungcm(key: Buffer, iv: Buffer, tag: Buffer, data: Buffer, aad: string) {
  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAAD(Buffer.from(aad));
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]);
}
const b64 = (b: Buffer) => b.toString('base64');

export function seal(value: unknown, aad: string, ring: Keyring = keyring()): string {
  const dek = randomBytes(32);
  const master = ring.keys.get(ring.current)!;
  const wrapped = gcm(master, dek, `dek:${aad}`);
  const body = gcm(dek, Buffer.from(JSON.stringify(value)), aad);
  const sealed: Sealed = {
    v: 1,
    kid: ring.current,
    wrap: b64(Buffer.concat([wrapped.iv, wrapped.tag, wrapped.data])),
    iv: b64(body.iv),
    tag: b64(body.tag),
    data: b64(body.data),
  };
  return JSON.stringify(sealed);
}
function unwrap(sealed: Sealed, aad: string, ring: Keyring) {
  const master = ring.keys.get(sealed.kid);
  if (!master) throw new Error(`encryption key ${sealed.kid} is not configured`);
  const wrap = Buffer.from(sealed.wrap, 'base64');
  return ungcm(master, wrap.subarray(0, 12), wrap.subarray(12, 28), wrap.subarray(28), `dek:${aad}`);
}
export function open<T = unknown>(text: string, aad: string, ring: Keyring = keyring()): T {
  const sealed = JSON.parse(text) as Sealed;
  if (sealed.v !== 1) throw new Error('unknown sealed format');
  const dek = unwrap(sealed, aad, ring);
  return JSON.parse(
    ungcm(
      dek,
      Buffer.from(sealed.iv, 'base64'),
      Buffer.from(sealed.tag, 'base64'),
      Buffer.from(sealed.data, 'base64'),
      aad,
    ).toString('utf8'),
  ) as T;
}
/** Re-wraps the data key with the current master; returns null when the record already uses it. */
export function rewrap(text: string, aad: string, ring: Keyring = keyring()): string | null {
  const sealed = JSON.parse(text) as Sealed;
  if (sealed.kid === ring.current) return null;
  const dek = unwrap(sealed, aad, ring);
  const wrapped = gcm(ring.keys.get(ring.current)!, dek, `dek:${aad}`);
  return JSON.stringify({
    ...sealed,
    kid: ring.current,
    wrap: b64(Buffer.concat([wrapped.iv, wrapped.tag, wrapped.data])),
  } satisfies Sealed);
}
export const keyIdOf = (text: string) => (JSON.parse(text) as Sealed).kid;

/** Masks a credential for display: keeps at most the last four characters of long values. */
export function mask(value: string) {
  if (value.length <= 8) return '••••';
  return `••••${value.slice(-4)}`;
}
