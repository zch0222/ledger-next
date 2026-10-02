import { cookies } from 'next/headers';
import { sanitize } from '../../../../packages/ui/src/theme.mjs';
export async function appearance() {
  const value = (await cookies()).get('ln_appearance')?.value;
  try { return sanitize(value ? JSON.parse(decodeURIComponent(value)) : null); } catch { return sanitize(null); }
}
