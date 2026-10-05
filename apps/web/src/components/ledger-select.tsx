'use client';
import { Icon } from '@/components/ui/icons';
import { lazyControl } from '@/components/ui/lazy';

export type LedgerSelectProps = { ledgers: { id: string; name: string }[]; current: string };

/**
 * Ledger switcher: a menu of ledgers plus actions, instead of a select with "＋ 新建账本" disguised as an option.
 * The menu (ledger-menu.tsx) loads after hydration; until then the same trigger is shown, static and inert.
 */
export const LedgerSelect = lazyControl<LedgerSelectProps>(
  () => import('@/components/ledger-menu').then(m => m.LedgerMenu),
  ({ ledgers, current }) => (
    <button type="button" className="ledger-switch" aria-disabled="true" tabIndex={-1}>
      <span className="ledger-switch-name">{ledgers.find(l => l.id === current)?.name ?? '账本'}</span>
      <Icon name="chevronDown" size={16} />
    </button>
  ),
);
