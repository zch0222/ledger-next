import { createHash } from 'node:crypto';

// Checkouts may convert line endings (core.autocrlf); hashing normalized text keeps checksums identical across
// Windows and Linux so an applied migration is never reported as changed just because of CRLF.
export const normalize = (sql: string) => sql.replace(/\r\n/g, '\n');
export const checksum = (sql: string) => createHash('sha256').update(normalize(sql)).digest('hex');
export const statements = (sql: string) =>
  normalize(sql)
    .split('--> statement-breakpoint')
    .filter(s => s.trim());
