'use client';
export default function ErrorPage({ reset }: { reset: () => void }) {
  return (
    <main className="auth-page">
      <section className="panel">
        <h1>暂时无法读取账本</h1>
        <p className="muted">请检查连接后重试。</p>
        <button onClick={reset}>重新加载</button>
      </section>
    </main>
  );
}
