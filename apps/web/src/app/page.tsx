import { headers } from 'next/headers';
import { notFound, redirect } from 'next/navigation';
import Link from 'next/link';
import { auth } from '../lib/auth';
import { appearance } from '../lib/appearance';
import { listLedgers, listMembers } from '../../../../packages/domain/src/identity';
import { CreateLedger } from '../components/create-ledger';
import { LedgerSelect } from '../components/ledger-select';
import { AccountMenu } from '../components/account-menu';
import { Members } from '../components/members';
import { Appearance } from '../components/appearance';
export const dynamic = 'force-dynamic';
const navigation = [['overview', '▦', '总览'], ['transactions', '≡', '账目'], ['subscriptions', '▣', '订阅'], ['analytics', '◴', '预算与分析'], ['accounts', '▤', '账户'], ['reminders', '♧', '提醒中心'], ['agents', '⌘', 'Agent 接入'], ['settings', '⚙', '账本设置']];
export default async function Home({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const session = await auth().api.getSession({ headers: await headers() });
  if (!session) redirect('/login');
  const ctx = { userId: session.user.id, requestId: crypto.randomUUID() };
  const books = await listLedgers(ctx), params = await searchParams;
  const book = params.ledger ? books.find(b => b.id === params.ledger) : books[0];
  if (params.ledger && !book) notFound();
  const setup = !book || params.setup === '1';
  const view = params.view ?? 'overview';
  if (!navigation.some(([id]) => id === view)) notFound();
  const pref = await appearance();
  const link = (id: string) => `/?ledger=${book?.id ?? ''}&view=${id}`;
  return <div className="shell"><aside className="sidebar"><div className="brand"><span className="mark">↗</span><div>Ledger<small>YOUR MONEY, CLEARLY.</small></div></div>
    <nav className="nav" aria-label="主要导航">{navigation.map(([id, icon, name]) => <Link key={id} className={view === id ? 'active' : ''} aria-current={view === id ? 'page' : undefined} href={setup ? '/?setup=1' : link(id)}><span>{icon}</span>{name}</Link>)}</nav><div className="sidefoot"><strong>每一笔，都有去处。</strong>个人与家庭账本<br />让生活的收支清楚一点。</div></aside>
    <div className="main"><header className="topbar"><div className="book">{book ? <LedgerSelect ledgers={books} current={book.id} /> : '我的账本'}<small>个人空间 · {book?.timezone ?? 'Asia/Hong_Kong'}</small></div><div className="topactions">{book && <span className="pill">{book.baseCurrency}</span>}<Appearance initial={pref} /><button className="primary add" disabled title="记账功能正在开发">＋ 记一笔</button><AccountMenu name={session.user.name} /></div></header>
    <main id="content">{setup ? <><CreateLedger additional={books.length > 0} /><div className="setup-account"><AccountMenu name={session.user.name} compact={false} /></div></> : <>
      <div className="heading"><div><div className="kicker">YOUR MONEY, CLEARLY.</div><h1>{view === 'overview' ? '本月，收支一目了然' : navigation.find(([id]) => id === view)?.[2]}</h1><p className="sub">{view === 'overview' ? '掌握支出的节奏，把重要的事提前安排好。' : `当前账本：${book.name}`}</p></div><span className="pill">{({ owner: '所有者', editor: '可编辑', viewer: '仅查看' })[book.role]}</span></div>
      {view === 'settings' ? book.role === 'owner' ? <Members key={book.id} ledgerId={book.id} initial={await listMembers(ctx, book.id)} /> : <section className="panel"><h2>账本信息</h2><p>{book.name} · {book.baseCurrency} · {book.timezone}</p><p className="muted">成员管理仅对所有者开放。</p></section> : view === 'overview' ? <>
        <div className="metrics">{[['本月支出', '按历史入账汇率汇总'], ['本月收入', '暂无入账记录'], ['本月结余', '收入 − 支出'], ['未来 7 天到期', '暂无订阅账单']].map(([label, hint], i) => <div className="metric" key={label}><div className="label">{label}</div><div className="value num">— <small>{i === 3 ? '笔' : book.baseCurrency}</small></div><div className="hint">{hint}</div></div>)}</div>
        <div className="note"><span className="dot" /><span>账本已创建。记账、订阅与统计功能正在开发，当前尚无可用统计。</span></div>
        <div className="grid"><section className="panel"><div className="row paneltop chart-head"><h2>收支趋势</h2><span className="small muted">每周 · {book.baseCurrency}</span></div><div className="empty chart-empty"><span className="empty-symbol">↗</span><p>记录第一笔，开始看见收支的变化。</p></div></section><section className="panel"><h2>钱花在哪里</h2><p className="chart-hint">分类排行 · {book.baseCurrency}</p><div className="empty chart-empty"><span className="empty-symbol">◴</span><p>分类支出将在这里呈现。</p></div></section></div>
        <div className="grid"><section className="panel"><div className="row paneltop"><h2>最近账目</h2><Link href={link('transactions')}>全部账目 →</Link></div><div className="empty">还没有账目。</div></section><section className="panel"><h2>接下来的账单</h2><div className="empty">暂无未来账单。</div><p className="small muted">到期后先确认支付，再计入实际支出。</p></section></div>
      </> : <section className="panel"><h2>{navigation.find(([id]) => id === view)?.[2]}</h2><div className="empty">此功能正在开发。完成后将在这里管理你的{view === 'accounts' ? '账户' : view === 'transactions' ? '账目' : '数据'}。</div></section>}
      {view === 'settings' && <section className="panel account-settings"><div><h2>我的账号</h2><p className="muted">{session.user.email}</p></div><AccountMenu name={session.user.name} compact={false} /></section>}
    </>}</main></div><nav className="mobile-nav" aria-label="移动导航">{[['overview', '▦', '总览'], ['transactions', '≡', '账目'], ['entry', '＋', '记一笔'], ['subscriptions', '▣', '订阅'], ['settings', '⋯', '更多']].map(([id, icon, name]) => id === 'entry' ? <button key={id} className="mobile-add" disabled aria-label="记一笔" title="记账功能正在开发"><span>{icon}</span></button> : <Link key={id} className={view === id ? 'active' : ''} href={setup ? '/?setup=1' : link(id)}><span>{icon}</span>{name}</Link>)}</nav>
  </div>;
}
