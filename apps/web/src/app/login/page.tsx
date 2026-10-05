import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { auth } from '@/lib/auth';
import { LoginForm } from '@/components/login-form';
import { Icon } from '@/components/ui/icons';
export const dynamic = 'force-dynamic';
export default async function Login() {
  const session = await auth().api.getSession({ headers: await headers() });
  if (session) redirect('/');
  return (
    <main className="auth-page">
      <div className="brand auth-brand">
        <span className="mark" aria-hidden="true">
          <Icon name="arrowUpRight" size={22} strokeWidth={2.25} />
        </span>
        Ledger
      </div>
      <LoginForm />
    </main>
  );
}
