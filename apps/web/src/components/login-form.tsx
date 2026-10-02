'use client';
import { useState } from 'react';
import { api } from '../lib/client';
import { useRouter } from 'next/navigation';

export function LoginForm() {
  const router = useRouter();
  const [register, setRegister] = useState(false), [error, setError] = useState(''), [busy, setBusy] = useState(false);
  async function submit(event: React.SubmitEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError('');
    const data = Object.fromEntries(new FormData(event.currentTarget));
    try {
      await api(`/api/auth/${register ? 'sign-up' : 'sign-in'}/email`, { method: 'POST', body: JSON.stringify({ ...data, callbackURL: '/' }) });
      router.replace('/'); router.refresh();
    } catch (e) { setError(e instanceof Error ? e.message : '登录失败，请重试'); setBusy(false); }
  }
  return <section className="panel auth-card"><div className="kicker">YOUR MONEY, CLEARLY.</div><h1>{register ? '创建你的账号' : '欢迎回来'}</h1><p className="sub">每一笔，都有去处。登录后继续你的账本。</p>
    <form onSubmit={submit} className="auth-form">
      {register && <div className="field"><label htmlFor="name">称呼</label><input id="name" name="name" autoComplete="name" maxLength={100} required /></div>}
      <div className="field"><label htmlFor="email">邮箱</label><input id="email" name="email" type="email" autoComplete="email" required maxLength={255} /></div>
      <div className="field"><label htmlFor="password">密码{register ? '（至少 12 位）' : ''}</label><input id="password" name="password" type="password" autoComplete={register ? 'new-password' : 'current-password'} minLength={12} maxLength={128} required /></div>
      <p className="error" role="alert">{error}</p><button className="primary full-width" disabled={busy}>{busy ? '正在验证…' : register ? '创建账号' : '登录'}</button>
    </form><button className="linkbtn" onClick={() => { setRegister(!register); setError(''); }}>{register ? '已有账号，去登录' : '第一次使用？创建账号'}</button>
  </section>;
}
