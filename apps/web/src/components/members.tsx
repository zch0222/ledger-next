'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, intent } from '../lib/client';
type Member = { id: string; name: string; email: string; role: 'owner' | 'editor' | 'viewer'; version: number };
const names = { owner: '所有者', editor: '可编辑', viewer: '仅查看' };
export function Members({ ledgerId, initial }: { ledgerId: string; initial: Member[] }) {
  const router = useRouter();
  const [members, setMembers] = useState(initial), [error, setError] = useState(''), [busy, setBusy] = useState(false);
  const [removing, setRemoving] = useState<Member | null>(null), [submission] = useState(intent);
  const base = `/api/v1/ledgers/${ledgerId}/memberships`;
  async function refresh() { setMembers(await api<Member[]>(base)); router.refresh(); }
  async function add(event: React.SubmitEvent<HTMLFormElement>) {
    event.preventDefault(); const form = event.currentTarget; setBusy(true); setError('');
    const payload = JSON.stringify(Object.fromEntries(new FormData(form)));
    try { await api(base, { method: 'POST', headers: { 'Idempotency-Key': submission.key(payload) }, body: payload }); submission.done(); form.reset(); await refresh(); }
    catch (e) { setError(e instanceof Error ? e.message : '添加失败'); } finally { setBusy(false); }
  }
  async function change(member: Member, role: string | null) {
    setBusy(true); setError('');
    try {
      await api(`${base}/${member.id}`, { method: role ? 'PATCH' : 'DELETE', headers: { 'If-Match': `"v${member.version}"` }, ...(role ? { body: JSON.stringify({ role }) } : {}) });
      setRemoving(null); await refresh();
    } catch (e) { setError(e instanceof Error ? e.message : '更新失败'); } finally { setBusy(false); }
  }
  return <section className="panel"><div className="row paneltop"><h2>账本成员</h2><span className="pill">{members.length} 位成员</span></div>
    <p className="sub">所有者管理成员；可编辑成员处理账目；仅查看成员不能修改账本。</p>
    <div className="member-list">{members.map(member => <div className="channel" key={member.id}><span className="logo">{member.name.slice(0, 1)}</span><div className="channel-text"><strong>{member.name}</strong><p>{member.email}</p></div><select disabled={busy} aria-label={`${member.email} 的角色`} value={member.role} onChange={e => void change(member, e.target.value)}>{Object.entries(names).map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select><button disabled={busy} onClick={() => setRemoving(member)}>移除</button></div>)}</div>
    {removing && <div className="note confirm-box"><p>移除 {removing.email} 后，对方将无法访问此账本。</p><button onClick={() => setRemoving(null)}>取消</button><button disabled={busy} onClick={() => void change(removing, null)}>确认移除</button></div>}
    <form onSubmit={add} className="auth-form"><h3>添加已注册成员</h3><div className="formgrid"><div className="field"><label htmlFor="member-email">成员邮箱</label><input id="member-email" name="email" type="email" required /></div><div className="field"><label htmlFor="member-role">权限</label><select id="member-role" name="role" defaultValue="viewer">{Object.entries(names).map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select></div></div><button className="primary" disabled={busy}>{busy ? '正在保存…' : '添加成员'}</button></form><p role="alert" className="error">{error}</p>
  </section>;
}
