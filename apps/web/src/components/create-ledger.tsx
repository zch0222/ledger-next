'use client';
import { useState } from 'react';
import { api, intent } from '@/lib/client';
import { useRouter } from 'next/navigation';
import { Select, plainOptions } from '@/components/ui/select';
export function CreateLedger({ additional = false }: { additional?: boolean }) {
  const router = useRouter();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [submission] = useState(intent);
  async function submit(event: React.SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    setBusy(true);
    try {
      const payload = JSON.stringify(Object.fromEntries(new FormData(event.currentTarget)));
      const data = await api<{ id: string }>('/api/v1/ledgers', {
        method: 'POST',
        headers: { 'Idempotency-Key': submission.key(payload) },
        body: payload,
      });
      submission.done();
      router.push(`/ledgers/${data.id}/accounts?new=first`);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : '创建失败');
      setBusy(false);
    }
  }
  return (
    <section className="panel setup-card">
      <h1>{additional ? '新建账本' : '从一本新账本开始'}</h1>
      <form onSubmit={submit} className="auth-form">
        <div className="field">
          <label htmlFor="ledger-name">账本名称</label>
          <input id="ledger-name" name="name" placeholder="例如：家庭账本" maxLength={80} required />
        </div>
        <div className="formgrid">
          <div className="field">
            <label htmlFor="base-currency">基准币种</label>
            <Select
              id="base-currency"
              name="baseCurrency"
              defaultValue="CNY"
              options={plainOptions(['CNY', 'USD', 'HKD', 'EUR', 'JPY'])}
            />
          </div>
          <div className="field">
            <label htmlFor="timezone">账本时区</label>
            <Select
              id="timezone"
              name="timezone"
              defaultValue="Asia/Hong_Kong"
              options={plainOptions([
                'Asia/Hong_Kong',
                'Asia/Shanghai',
                'Asia/Tokyo',
                'America/New_York',
                'Europe/London',
                'UTC',
              ])}
            />
          </div>
        </div>
        <p className="note">首笔入账后基准币种固定；日期与月度统计按账本时区计算。</p>
        <p role="alert" className="error">
          {error}
        </p>
        <button className="primary" disabled={busy}>
          {busy ? '正在创建…' : '创建账本'}
        </button>
      </form>
    </section>
  );
}
