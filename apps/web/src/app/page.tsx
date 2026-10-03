import { redirect } from 'next/navigation';
import { ledgersOf, requireUser } from '@/lib/session';
export const dynamic = 'force-dynamic';

// Older links (/?ledger=…&view=…) keep working; everything else lands on the first ledger or the onboarding.
const VIEWS: Record<string, string> = {
  overview: 'dashboard',
  transactions: 'transactions',
  subscriptions: 'subscriptions',
  analytics: 'analytics',
  accounts: 'accounts',
  reminders: 'reminders',
  agents: 'agents',
  settings: 'settings',
};
export default async function Home({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  await requireUser();
  const books = await ledgersOf();
  const params = await searchParams;
  if (params.setup === '1') redirect('/onboarding');
  const book = params.ledger ? books.find(b => b.id === params.ledger) : books[0];
  if (!book) redirect(params.ledger ? '/' : '/onboarding');
  redirect(`/ledgers/${book.id}/${VIEWS[params.view ?? 'overview'] ?? 'dashboard'}`);
}
