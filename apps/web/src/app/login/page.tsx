import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { auth } from '../../lib/auth';
import { LoginForm } from '../../components/login-form';
export const dynamic = 'force-dynamic';
export default async function Login() {
  const session = await auth().api.getSession({ headers: await headers() });
  if (session) redirect('/');
  return (
    <main className="auth-page">
      <div className="brand auth-brand">
        <span className="mark">↗</span>
        <div>
          Ledger<small>YOUR MONEY, CLEARLY.</small>
        </div>
      </div>
      <LoginForm />
    </main>
  );
}
