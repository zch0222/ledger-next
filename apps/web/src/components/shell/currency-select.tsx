'use client';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';

/** Display currency for valuations (URL ?currency=); it never changes booked amounts. */
export function CurrencySelect({ base, currencies }: { base: string; currencies: readonly string[] }) {
  const router = useRouter(), pathname = usePathname(), search = useSearchParams();
  const value = search.get('currency') ?? base;
  return <><label className="small muted hide-mobile-label" htmlFor="display-currency">展示</label>
    <select id="display-currency" aria-label="展示币种" value={value} onChange={e => {
      const next = new URLSearchParams(search);
      if (e.target.value === base) next.delete('currency'); else next.set('currency', e.target.value);
      router.push(`${pathname}${next.size ? `?${next}` : ''}`);
    }}>{currencies.map(c => <option key={c} value={c}>{c}</option>)}</select></>;
}
