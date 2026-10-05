'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/client';

/** Ends the session and goes to /login; `error` is set when the request fails. */
export function useSignOut() {
  const router = useRouter();
  const [error, setError] = useState('');
  async function signOut() {
    setError('');
    try {
      await api('/api/auth/sign-out', { method: 'POST', body: '{}' });
      router.replace('/login');
      router.refresh();
    } catch {
      setError('退出失败，请重试');
    }
  }
  return { signOut, error };
}
