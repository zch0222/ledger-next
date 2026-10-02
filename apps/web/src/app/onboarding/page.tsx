import { AccountMenu } from '../../components/account-menu';
import { CreateLedger } from '../../components/create-ledger';
import { ledgersOf, requireUser } from '../../lib/session';
export const dynamic = 'force-dynamic';

/** P00 first run: create a ledger (base currency, timezone), then its first account (F01). */
export default async function Onboarding() {
  const { user } = await requireUser();
  const books = await ledgersOf();
  return <main className="auth-page onboarding"><div className="brand auth-brand"><span className="mark" aria-hidden="true">↗</span><div>Ledger<small>YOUR MONEY, CLEARLY.</small></div></div>
    <CreateLedger additional={books.length > 0} />
    <div className="setup-account"><AccountMenu name={user.name} compact={false} /></div></main>;
}
