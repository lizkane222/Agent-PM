/**
 * Defence in depth against script-capable links. Many surfaces render user/Google/Airtable
 * supplied URLs straight into `<a href>`; React does not block `javascript:` there. Rather
 * than trust every call site, one capture-phase listener refuses to follow any anchor whose
 * resolved scheme is not on the allow-list.
 */
const ALLOWED_PROTOCOLS = new Set(["http:", "https:", "mailto:", "tel:", "blob:"]);

export function isSafeLinkHref(href: string, base: string = window.location.href): boolean {
  try {
    return ALLOWED_PROTOCOLS.has(new URL(href.trim(), base).protocol);
  } catch {
    return false;
  }
}

function guard(e: MouseEvent) {
  const a = (e.target as Element | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
  if (!a) return;
  const href = a.getAttribute("href") ?? "";
  if (href === "" || href.startsWith("#") || isSafeLinkHref(href)) return;
  e.preventDefault();
  e.stopImmediatePropagation();
}

export function installLinkGuard(target: Document = document): () => void {
  target.addEventListener("click", guard, true);
  target.addEventListener("auxclick", guard, true);
  return () => {
    target.removeEventListener("click", guard, true);
    target.removeEventListener("auxclick", guard, true);
  };
}
