import { cache } from 'react';
import { cookies } from 'next/headers';
import { getPreferences, type Appearance } from '../../../../packages/domain/src/preferences';
import { sanitize } from '../../../../packages/ui/src/theme.mjs';
import { currentSession } from './session';

/**
 * Cookie value: signed-out pages, or the device copy. `pending` holds the id of the user whose choice is not yet
 * saved to their account (debounce still running when the page reloaded, or the save failed) — for that user only,
 * the device choice wins until it syncs.
 */
export async function cookieAppearance(): Promise<{ value: Appearance; pending: string | null }> {
  const raw = (await cookies()).get('ln_appearance')?.value;
  try {
    const parsed = raw ? JSON.parse(decodeURIComponent(raw)) : null;
    return { value: sanitize(parsed) as Appearance, pending: typeof parsed?.pending === 'string' ? parsed.pending : null };
  } catch { return { value: sanitize(null) as Appearance, pending: null }; }
}
/**
 * First-frame appearance (TECHNICAL_DESIGN §7.4): signed in → the account preference read with the session (no extra
 * HTTP request) unless this device holds an unsynced choice; otherwise the ln_appearance cookie. version is the
 * preference ETag for PATCH.
 */
export const currentAppearance = cache(async (): Promise<{ value: Appearance; version: number | null; pending: boolean }> => {
  // cookies() first: during the build it marks the page dynamic before any auth configuration is needed.
  const device = await cookieAppearance(), session = await currentSession();
  if (!session) return { value: device.value, version: null, pending: false };
  const prefs = await getPreferences(session.user.id);
  return device.pending === session.user.id ? { value: device.value, version: prefs.version, pending: true } : { value: prefs.appearance, version: prefs.version, pending: false };
});
export const appearance = async () => (await currentAppearance()).value;
