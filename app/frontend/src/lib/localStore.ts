/**
 * A tiny localStorage-backed external store for UI state shared across sibling components.
 *
 * Why this exists: the browser's `storage` event does NOT fire in the document that
 * performed the write. So N components each holding their own `useState` seeded from the
 * same localStorage key will silently drift apart within a single tab as soon as one of
 * them writes. A module-level store with an explicit subscriber list fixes in-tab sync,
 * and the `storage` listener it registers gives cross-tab sync for free.
 *
 * This is UI state, not server data — `useResource` / HOOK_SPEC rules do not apply.
 */

export interface LocalStore<T> {
  /** Current value. Reference is stable until a mutation, so it is safe as a
   *  `useSyncExternalStore` snapshot. */
  get(): T;
  set(next: T): void;
  update(fn: (prev: T) => T): void;
  /** Returns an unsubscribe function. */
  subscribe(cb: () => void): () => void;
  /** Re-read from localStorage and notify. For when the key is written by something
   *  outside this store — including `localStorage.clear()`, which fires no event. */
  reload(): void;
}

export function createLocalStore<T>(
  key: string,
  parse: (raw: string | null) => T,
  serialize: (value: T) => string,
): LocalStore<T> {
  let value: T = parse(readRaw(key));
  const subscribers = new Set<() => void>();
  let listening = false;

  function notify() {
    for (const cb of subscribers) cb();
  }

  function onStorage(e: StorageEvent) {
    // e.key is null when localStorage was cleared wholesale.
    if (e.key !== null && e.key !== key) return;
    value = parse(e.key === null ? null : e.newValue);
    notify();
  }

  return {
    get: () => value,
    set(next: T) {
      value = next;
      try { localStorage.setItem(key, serialize(next)); } catch { /* quota / private mode */ }
      notify();
    },
    update(fn: (prev: T) => T) {
      this.set(fn(value));
    },
    reload() {
      value = parse(readRaw(key));
      notify();
    },
    subscribe(cb: () => void) {
      subscribers.add(cb);
      if (!listening && typeof window !== "undefined") {
        window.addEventListener("storage", onStorage);
        listening = true;
      }
      return () => { subscribers.delete(cb); };
    },
  };
}

function readRaw(key: string): string | null {
  try { return localStorage.getItem(key); } catch { return null; }
}
