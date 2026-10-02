import { cache } from 'react';
import { cookies } from 'next/headers';
import { getPreferences, type Appearance } from '../../../../packages/domain/src/preferences';
import { sanitize } from '../../../../packages/ui/src/theme.mjs';
import { currentSession } from './session';

/** Cookie value (signed-out pages, or the device copy when saving to the account failed). */
export async function cookieAppearance(): Promise<Appearance> {
  const value = (await cookies()).get('ln_appearance')?.value;
  try { return sanitize(value ? JSON.parse(decodeURIComponent(value)) : null) as Appearance; } catch { return sanitize(null) as Appearance; }
}
/**
 * First-frame appearance (TECHNICAL_DESIGN §7.4): signed in → the account preference read with the session (no extra
 * HTTP request); otherwise the ln_appearance cookie. version is the preference ETag for PATCH.
 */
export const currentAppearance = cache(async (): Promise<{ value: Appearance; version: number | null }> => {
  const session = await currentSession();
  if (!session) return { value: await cookieAppearance(), version: null };
  const prefs = await getPreferences(session.user.id);
  return { value: prefs.appearance, version: prefs.version };
});
export const appearance = async () => (await currentAppearance()).value;
