'use client';
import { useState } from 'react';
import { api } from '../lib/client';
import { useRouter } from 'next/navigation';
export function AccountMenu({ name, compact = true }: { name: string; compact?: boolean }) {
  const router = useRouter();
  const [error, setError] = useState('');
  async function logout() {
    try {
      await api('/api/auth/sign-out', { method: 'POST', body: '{}' });
      router.replace('/login');
      router.refresh();
    } catch {
      setError('退出失败，请重试');
    }
  }
  return (
    <>
      <button
        onClick={logout}
        title={`${name} · 退出登录`}
        aria-label={compact ? '退出登录' : '退出当前账号'}
        className={compact ? 'avatar' : ''}
      >
        {compact ? name.slice(0, 2) : '退出当前账号'}
      </button>
      {error && (
        <span role="alert" className="error">
          {error}
        </span>
      )}
    </>
  );
}
