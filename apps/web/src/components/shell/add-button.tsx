'use client';
import { useLedgerUI } from '@/components/ledger-ui';

export function AddButton({
  label = '＋ 记一笔',
  className = 'primary add',
  init,
}: {
  label?: string;
  className?: string;
  init?: Parameters<ReturnType<typeof useLedgerUI>['openEntry']>[0];
}) {
  const ui = useLedgerUI();
  return (
    <button
      className={className}
      disabled={!ui.canWrite}
      title={ui.canWrite ? '快捷键 N' : '仅查看成员不能记账'}
      aria-keyshortcuts={init ? undefined : 'N'}
      onClick={() => ui.openEntry(init)}
    >
      {label}
    </button>
  );
}
