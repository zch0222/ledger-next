import { afterAll, expect, it } from 'vitest';
import { databasePool } from '@ledger/db/index';
import { appearanceCookie, getPreferences, present, updatePreferences } from '@ledger/domain/preferences';
import { seedUser } from './db';

afterAll(() => databasePool().end());

it('stores appearance per user, regenerates the palette server-side and guards versions', async () => {
  const userId = await seedUser();
  const initial = await getPreferences(userId);
  expect(initial).toEqual({ appearance: { mode: 'system', accent: 'teal', custom: null }, version: 1 });
  expect(present(initial.appearance, 1).appearance).toMatchObject({
    themeMode: 'system',
    accent: { type: 'preset', value: 'teal' },
    palette: { version: 1, light: { accent: '#07766a', adjusted: false }, dark: { accent: '#52cfb7' } },
  });
  await expect(updatePreferences(userId, { appearance: { themeMode: 'dark' } }, null)).rejects.toMatchObject({
    status: 428,
  });
  const dark = await updatePreferences(userId, { appearance: { themeMode: 'dark' } }, '"v1"');
  expect(dark).toEqual({ appearance: { mode: 'dark', accent: 'teal', custom: null }, version: 2 });
  await expect(updatePreferences(userId, { appearance: { themeMode: 'light' } }, '"v1"')).rejects.toMatchObject({
    status: 412,
  });
  // Unknown presets and malformed colours are rejected by the contract and never stored.
  await expect(
    updatePreferences(userId, { appearance: { accent: { type: 'preset', value: 'neon' } } }, '"v2"'),
  ).rejects.toThrow();
  await expect(
    updatePreferences(userId, { appearance: { accent: { type: 'custom', value: 'url(x)' } } }, '"v2"'),
  ).rejects.toThrow();
  const custom = await updatePreferences(
    userId,
    { appearance: { accent: { type: 'custom', value: '#FFFF00' } } },
    '"v2"',
  );
  const shown = present(custom.appearance, custom.version).appearance;
  expect(shown.accent).toEqual({ type: 'custom', value: '#FFFF00' });
  expect(shown.palette.light.adjusted).toBe(true); // pure yellow is darkened for AA on light surfaces
  expect(Number(shown.palette.light.minContrast)).toBeGreaterThanOrEqual(4.5);
  expect(Number(shown.palette.dark.minContrast)).toBeGreaterThanOrEqual(4.5);
  expect((await getPreferences(userId)).version).toBe(3);
  expect(appearanceCookie(custom.appearance, true)).toMatch(
    /^ln_appearance=.+; Path=\/; Max-Age=31536000; SameSite=Lax; Secure$/,
  );
});
