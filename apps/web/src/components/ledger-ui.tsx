'use client';
import { createContext, startTransition, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import { preloadModal } from '@/components/ui/modal';
import type { EntryInit } from './entry-drawer';

// The entry form and dialog code load on demand (and on idle, below), not with the first screen (TECHNICAL_DESIGN §7.3).
const loadEntryDrawer = () => import('./entry-drawer');
const EntryDrawer = dynamic(() => loadEntryDrawer().then(m => m.EntryDrawer), { ssr: false });

export type LedgerInfo = {
  id: string;
  name: string;
  baseCurrency: string;
  timezone: string;
  role: 'owner' | 'editor' | 'viewer';
};
export type AccountOption = { id: string; name: string; currency: string; type: string; balance: string };
export type CategoryOption = { id: string; name: string; kind: 'expense' | 'income'; parentId: string | null };
type Toast = { text: string; href?: string; linkText?: string } | null;
type LedgerUI = {
  ledger: LedgerInfo;
  accounts: AccountOption[];
  categories: CategoryOption[];
  canWrite: boolean;
  openEntry: (init?: EntryInit) => void;
  toast: (toast: Toast) => void;
};
const Context = createContext<LedgerUI | null>(null);
export function useLedgerUI() {
  const value = useContext(Context);
  if (!value) throw new Error('useLedgerUI outside LedgerProvider');
  return value;
}

/** Ledger-wide client state: the entry drawer (P03), toasts and the "N" shortcut. Data comes from SSR props. */
export function LedgerProvider({
  ledger,
  accounts,
  categories,
  children,
}: {
  ledger: LedgerInfo;
  accounts: AccountOption[];
  categories: CategoryOption[];
  children: React.ReactNode;
}) {
  const [entry, setEntry] = useState<EntryInit | null>(null);
  const [toast, setToast] = useState<Toast>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const canWrite = ledger.role !== 'viewer';
  // A transition lets the tap paint at once (INP) and mounts the dialog right after, instead of inside the click task.
  const openEntry = useCallback(
    (init: EntryInit = { mode: 'create' }) => {
      if (canWrite) startTransition(() => setEntry(init));
    },
    [canWrite],
  );
  const showToast = useCallback((next: Toast) => {
    setToast(next);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setToast(null), 5000);
  }, []);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (event.key !== 'n' && event.key !== 'N') return;
      // An open Base UI dialog carries data-open; an open menu or select marks its trigger with data-popup-open.
      const popupOpen = document.querySelector('[role="dialog"][data-open], [data-popup-open]');
      if (event.metaKey || event.ctrlKey || event.altKey || popupOpen) return;
      // A focused select trigger (role=combobox) uses letters for typeahead.
      const typing =
        ['INPUT', 'TEXTAREA', 'SELECT'].includes(target?.tagName ?? '') || target?.getAttribute('role') === 'combobox';
      if (target && (target.isContentEditable || typing)) return;
      event.preventDefault();
      openEntry();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [openEntry]);
  // Warm the entry form and dialog code once the page is idle, so the first "记一笔" opens without a fetch.
  useEffect(() => {
    if (!canWrite) return;
    const warm = () => void Promise.all([loadEntryDrawer(), preloadModal()]).catch(() => {});
    if (!('requestIdleCallback' in window)) {
      const timeout = setTimeout(warm, 1500);
      return () => clearTimeout(timeout);
    }
    const id = requestIdleCallback(warm, { timeout: 3000 });
    return () => cancelIdleCallback(id);
  }, [canWrite]);
  const value = useMemo(
    () => ({ ledger, accounts, categories, canWrite, openEntry, toast: showToast }),
    [ledger, accounts, categories, canWrite, openEntry, showToast],
  );
  return (
    <Context.Provider value={value}>
      {children}
      {entry && <EntryDrawer key={JSON.stringify(entry)} init={entry} onClose={() => setEntry(null)} />}
      <div className="toast" role="status" aria-live="polite" hidden={!toast}>
        {toast?.text}
        {toast?.href && (
          <>
            {' '}
            · <a href={toast.href}>{toast.linkText ?? '查看'}</a>
          </>
        )}
      </div>
    </Context.Provider>
  );
}
