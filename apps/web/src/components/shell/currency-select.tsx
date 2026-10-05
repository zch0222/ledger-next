'use client';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Select } from '@/components/ui/select';

/** Display currency for valuations (URL ?currency=); it never changes booked amounts. */
export function CurrencySelect({ base, currencies }: { base: string; currencies: readonly string[] }) {
  const router = useRouter();
  const pathname = usePathname();
  const search = useSearchParams();
  const value = search.get('currency') ?? base;
  return (
    <>
      <label className="small muted hide-mobile-label" htmlFor="display-currency">
        展示
      </label>
      <Select
        id="display-currency"
        aria-label="展示币种"
        className="compact"
        value={value}
        options={currencies.map(c => ({ value: c, label: c }))}
        onValueChange={next => {
          const params = new URLSearchParams(search);
          if (next === base) params.delete('currency');
          else params.set('currency', next);
          router.push(`${pathname}${params.size ? `?${params}` : ''}`);
        }}
      />
    </>
  );
}
