import { eq } from 'drizzle-orm';
import { PreferencesUpdate } from '@ledger/contracts/platform';
import { database } from '@ledger/db/index';
import { userPreferences } from '@ledger/db/schema';
import { DEFAULTS, palette, sanitize } from '@ledger/ui/theme.mjs';
import { requireVersion } from './policy';

// Appearance is a personal display preference: no ledger, no audit, never part of money data (UI_SPEC §2.2).
/** Bump when the generator changes; stored inputs are re-derived, old generated colours are never trusted. */
export const PALETTE_VERSION = 1;
export type Appearance = { mode: 'system' | 'light' | 'dark'; accent: string; custom: string | null };
type Row = typeof userPreferences.$inferSelect;

const toAppearance = (row: Row | undefined): Appearance =>
  sanitize(
    row
      ? {
          mode: row.themeMode,
          accent: row.accentType === 'custom' ? 'custom' : row.accentValue,
          custom: row.accentType === 'custom' ? row.accentValue : null,
        }
      : null,
  ) as Appearance;
/** Server-generated palette: the client preview is never trusted. */
export function present(appearance: Appearance, version: number) {
  const p = palette(appearance);
  const mode = (m: 'light' | 'dark') => ({
    accent: p[m],
    onAccent: p.report[m].onAccent,
    minContrast: p.report[m].min.toFixed(2),
    adjusted: m === 'light' ? p.lightAdjusted : p.darkAdjusted,
  });
  return {
    appearance: {
      themeMode: appearance.mode,
      accent:
        appearance.accent === 'custom'
          ? { type: 'custom' as const, value: appearance.custom!.toUpperCase() }
          : { type: 'preset' as const, value: appearance.accent as 'teal' },
      palette: { version: PALETTE_VERSION, light: mode('light'), dark: mode('dark') },
    },
    version,
  };
}
/** Unsaved preferences read as the defaults (system + teal) at version 1. */
export async function getPreferences(userId: string) {
  const [row] = await database().select().from(userPreferences).where(eq(userPreferences.userId, userId));
  return { appearance: toAppearance(row), version: row?.version ?? 1 };
}
export async function updatePreferences(userId: string, input: unknown, etag: string | null) {
  const data = PreferencesUpdate.parse(input).appearance;
  return database().transaction(async tx => {
    const [row] = await tx.select().from(userPreferences).where(eq(userPreferences.userId, userId)).for('update');
    const version = row?.version ?? 1;
    requireVersion(etag, version);
    const current = toAppearance(row);
    const next = sanitize({
      mode: data.themeMode ?? current.mode,
      accent: data.accent ? (data.accent.type === 'custom' ? 'custom' : data.accent.value) : current.accent,
      custom: data.accent ? (data.accent.type === 'custom' ? data.accent.value : null) : current.custom,
    }) as Appearance;
    const values = {
      themeMode: next.mode,
      accentType: next.accent === 'custom' ? ('custom' as const) : ('preset' as const),
      accentValue: next.accent === 'custom' ? next.custom! : next.accent,
      paletteVersion: PALETTE_VERSION,
      version: version + 1,
      updatedAt: new Date(),
    };
    if (row) await tx.update(userPreferences).set(values).where(eq(userPreferences.userId, userId));
    else await tx.insert(userPreferences).values({ userId, ...values });
    return { appearance: next, version: version + 1 };
  });
}
/** Non-sensitive cookie that lets SSR paint the first frame (also for signed-out pages). */
export function appearanceCookie(appearance: Appearance, secure: boolean) {
  return `ln_appearance=${encodeURIComponent(JSON.stringify(appearance))}; Path=/; Max-Age=31536000; SameSite=Lax${secure ? '; Secure' : ''}`;
}
export { DEFAULTS };
