'use client';
import { useSyncExternalStore, type ComponentType } from 'react';

/**
 * Keeps Base UI's popup code out of the first-screen JavaScript (TECHNICAL_DESIGN §7.3, ≤180 KiB gzip). The server and
 * hydration render `Fallback`: static markup that looks exactly like the closed control. The first mounted instance
 * fetches the real component and every instance swaps it in. The fallback is aria-disabled, so nothing (users, tests)
 * acts on it during that moment. useSyncExternalStore hydrates with the server snapshot, so an instance that hydrates
 * after the code has arrived (inside a later Suspense boundary) still matches the server HTML.
 */
export function lazyControl<P extends object>(load: () => Promise<ComponentType<P>>, Fallback: ComponentType<P>) {
  let loaded: ComponentType<P> | null = null;
  let pending: Promise<void> | null = null;
  const listeners = new Set<() => void>();
  const subscribe = (listener: () => void) => {
    listeners.add(listener);
    pending ??= load().then(
      component => {
        loaded = component;
        listeners.forEach(notify => notify());
      },
      () => {
        pending = null; // retry on the next mount
      },
    );
    return () => {
      listeners.delete(listener);
    };
  };
  function LazyControl(props: P) {
    const Real = useSyncExternalStore(
      subscribe,
      () => loaded,
      () => null,
    );
    return Real ? <Real {...props} /> : <Fallback {...props} />;
  }
  return LazyControl;
}
