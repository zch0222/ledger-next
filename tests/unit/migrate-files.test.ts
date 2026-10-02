import { expect, it } from 'vitest';
import { checksum, normalize, statements } from '../../packages/db/src/migrate-files';

it('hashes migrations identically on LF and CRLF checkouts', () => {
  const lf = 'CREATE TABLE a (id INT);\n--> statement-breakpoint\nCREATE TABLE b (id INT);\n';
  expect(checksum(lf.replace(/\n/g, '\r\n'))).toBe(checksum(lf));
  expect(checksum(lf)).toMatch(/^[0-9a-f]{64}$/);
  expect(checksum(lf + ' ')).not.toBe(checksum(lf));
  expect(normalize('a\r\nb\nc')).toBe('a\nb\nc');
});
it('splits on statement breakpoints and drops empty fragments', () => {
  expect(statements('A;\r\n--> statement-breakpoint\r\nB;\n--> statement-breakpoint\n  \n')).toEqual(['A;\n', '\nB;\n']);
});
