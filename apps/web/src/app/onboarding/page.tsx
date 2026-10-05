import { SignOutButton } from '@/components/account-menu';
import { Icon } from '@/components/ui/icons';
import { CreateLedger } from '@/components/create-ledger';
import { ledgersOf, requireUser } from '@/lib/session';
export const dynamic = 'force-dynamic';

/** P00 first run: create a ledger (base currency, timezone), then its first account (F01). */
export default async function Onboarding() {
  await requireUser();
  const books = await ledgersOf();
  return (
    <main className="auth-page onboarding">
      <div className="brand auth-brand">
        <span className="mark" aria-hidden="true">
          <Icon name="arrowUpRight" size={22} strokeWidth={2.25} />
        </span>
        Ledger
      </div>
      <CreateLedger additional={books.length > 0} />
      <div className="setup-account">
        <SignOutButton />
      </div>
    </main>
  );
}
