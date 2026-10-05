'use client';
import { useEffect, useSyncExternalStore } from 'react';
import type * as ModalImpl from '@/components/ui/modal-impl';

type Impl = typeof ModalImpl;
let impl: Impl | null = null;
let pending: Promise<Impl> | null = null;
const listeners = new Set<() => void>();
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};
/** Fetches the Base UI dialog code. Runs on the first open, and on idle from LedgerProvider so that open is instant. */
export function preloadModal() {
  pending ??= import('@/components/ui/modal-impl').then(
    m => {
      impl = m;
      listeners.forEach(notify => notify());
      return m;
    },
    error => {
      pending = null;
      throw error;
    },
  );
  return pending;
}

/**
 * Modal dialog. The Base UI implementation (modal-impl.tsx) is loaded the first time a dialog opens, which keeps it
 * out of the first-screen JavaScript (TECHNICAL_DESIGN §7.3). A closed dialog renders nothing either way; hydration
 * uses the server snapshot (not loaded), so an initially open dialog never mismatches the server HTML.
 */
export function Modal(props: React.ComponentProps<Impl['Modal']>) {
  const loaded = useSyncExternalStore(
    subscribe,
    () => impl,
    () => null,
  );
  useEffect(() => {
    if (props.open && !loaded) void preloadModal().catch(() => {});
  }, [props.open, loaded]);
  return loaded ? <loaded.Modal {...props} /> : null;
}
/** Title row with the close button. Only rendered inside an open Modal, so the implementation is already loaded. */
export function ModalHeader(props: React.ComponentProps<Impl['ModalHeader']>) {
  return impl ? <impl.ModalHeader {...props} /> : null;
}
