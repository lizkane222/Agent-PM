/**
 * Thin wrapper around the Segment analytics.js snippet loaded in index.html.
 *
 * All calls are no-ops when the write key is not configured so the rest of
 * the app never needs to guard individual calls.
 */

declare global {
  interface Window {
    analytics?: {
      load?: (writeKey: string) => void;
      identify: (userId: string | number, traits?: Record<string, unknown>) => void;
      track: (event: string, properties?: Record<string, unknown>) => void;
      page: (name?: string, properties?: Record<string, unknown>) => void;
      reset: () => void;
    };
  }
}

function seg() {
  return window.analytics ?? null;
}

export function identify(userId: string | number, traits?: Record<string, unknown>) {
  seg()?.identify(String(userId), traits);
}

export function track(event: string, properties?: Record<string, unknown>) {
  seg()?.track(event, properties);
}

export function page(name?: string, properties?: Record<string, unknown>) {
  seg()?.page(name, properties);
}

export function reset() {
  seg()?.reset();
}
