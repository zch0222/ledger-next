import { cache } from 'react';
import { headers } from 'next/headers';
import { notFound, redirect } from 'next/navigation';
import { auth } from './auth';
import { getLedger, listLedgers } from '../../../../packages/domain/src/identity';
import { DomainError } from '../../../../packages/domain/src/policy';

// SSR reads call the domain layer directly with an AuthContext (TECHNICAL_DESIGN §3); cache() dedupes per request.
export const currentSession = cache(async () => auth().api.getSession({ headers: await headers() }));
export const requireUser = cache(async () => {
  const session = await currentSession();
  if (!session) redirect('/login');
  return { ctx: { userId: session.user.id, requestId: crypto.randomUUID() }, user: session.user };
});
export const ledgersOf = cache(async () => listLedgers((await requireUser()).ctx));
/** The ledger in the URL, authorized for the current user; anything else is a 404 (no existence leak). */
export const requireLedger = cache(async (ledgerId: string) => {
  const { ctx, user } = await requireUser();
  try { return { ctx, user, ledger: await getLedger(ctx, ledgerId) }; } catch (error) {
    if (error instanceof DomainError && error.status === 404) notFound();
    throw error;
  }
});
export type LedgerPageProps = { params: Promise<{ ledgerId: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> };
/** First value of a search parameter. */
export const param = (params: Record<string, string | string[] | undefined>, name: string) => { const v = params[name]; return Array.isArray(v) ? v[0] : v; };
