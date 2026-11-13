/** Pure helpers for the profile page's ordered, add/remove-able sections. */

/** Move `id` so it sits at `toIndex` of the list (clamped). Unknown ids leave the list as it was. */
export function moveTo<T>(list: readonly T[], id: T, toIndex: number): T[] {
  const from = list.indexOf(id);
  if (from < 0) return [...list];
  const next = list.filter((x) => x !== id);
  next.splice(Math.max(0, Math.min(toIndex, next.length)), 0, id);
  return next;
}

/** Move `id` one place up (-1) or down (+1). */
export function nudge<T>(list: readonly T[], id: T, delta: -1 | 1): T[] {
  const from = list.indexOf(id);
  if (from < 0) return [...list];
  return moveTo(list, id, from + delta);
}

/** Add to the end if absent, remove if present. */
export function toggleIn<T>(list: readonly T[], id: T): T[] {
  return list.includes(id) ? list.filter((x) => x !== id) : [...list, id];
}

/** Read a saved id list, keeping only ids that still exist (and no repeats). `null` = nothing saved. */
export function loadIdList<T extends string>(key: string, valid: readonly T[]): T[] | null {
  try {
    const raw = JSON.parse(localStorage.getItem(key) ?? "null");
    if (!Array.isArray(raw)) return null;
    const ok = new Set<string>(valid);
    const seen = new Set<string>();
    return raw.filter((id): id is T => typeof id === "string" && ok.has(id) && !seen.has(id) && !!seen.add(id));
  } catch { return null; }
}

/** How long a revealed section glows. */
export const SECTION_GLOW_MS = 3000;

/**
 * Scroll the section with this id into view and give it the purple glow for three seconds. Returns
 * whether the section was found (it is not when it is not on the page).
 */
export function revealSection(id: string, root: ParentNode = document): boolean {
  const el = root.querySelector<HTMLElement>(`[data-section-id="${id}"]`);
  if (!el) return false;
  el.scrollIntoView?.({ behavior: "smooth", block: "start" });
  // Restart the animation if it is already running.
  el.removeAttribute("data-glow");
  void el.offsetWidth;
  el.setAttribute("data-glow", "true");
  const prior = (el as HTMLElement & { __glowTimer?: number }).__glowTimer;
  if (prior) window.clearTimeout(prior);
  (el as HTMLElement & { __glowTimer?: number }).__glowTimer = window.setTimeout(() => el.removeAttribute("data-glow"), SECTION_GLOW_MS);
  return true;
}
