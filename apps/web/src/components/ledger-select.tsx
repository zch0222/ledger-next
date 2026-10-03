'use client';
import { useRouter } from 'next/navigation';
export function LedgerSelect({ ledgers, current }: { ledgers: { id: string; name: string }[]; current: string }) {
  const router = useRouter();
  return (
    <select
      aria-label="切换账本"
      value={current}
      onChange={e => router.push(e.target.value === 'new' ? '/onboarding' : `/ledgers/${e.target.value}/dashboard`)}
    >
      {ledgers.map(l => (
        <option key={l.id} value={l.id}>
          {l.name}
        </option>
      ))}
      <option value="new">＋ 新建账本</option>
    </select>
  );
}
