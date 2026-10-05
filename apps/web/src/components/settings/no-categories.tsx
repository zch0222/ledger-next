'use client';
import Link from 'next/link';
import { useLedgerUI } from '@/components/ledger-ui';

/** Under a category select while the ledger has no category of this kind: new ledgers start without any. */
export function NoCategoriesHint({ kind, onNavigate }: { kind: 'expense' | 'income'; onNavigate: () => void }) {
  const { ledger, canWrite } = useLedgerUI();
  return (
    <p className="small muted field-hint">
      还没有{kind === 'expense' ? '支出' : '收入'}分类。
      {canWrite && (
        <Link href={`/ledgers/${ledger.id}/settings#catalog`} onClick={onNavigate}>
          去添加分类
        </Link>
      )}
    </p>
  );
}
