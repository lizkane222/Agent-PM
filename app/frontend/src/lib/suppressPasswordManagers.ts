/**
 * Keeps password-manager extensions (1Password, LastPass, Bitwarden, browser autofill)
 * from popping up on ordinary app fields.
 *
 * Installed once from main.tsx. Every <input>/<textarea>/<select> in the document gets
 *   data-1p-ignore, data-lpignore="true", data-bwignore, data-form-type="other"
 * and autocomplete="off" (unless the author already set an autocomplete value).
 *
 * Left alone:
 *  - type="password" and type="hidden"
 *  - anything inside an element marked data-allow-autofill (or marked itself)
 *  - any control in a <form> that also holds a password field (the sign-in form)
 * TipTap/ProseMirror editors are contenteditable <div>s, not form controls, so they are
 * never touched.
 *
 * Limits: this is a hint, not a guarantee. Extensions that guess "login/address/card"
 * from field names may still show; users can also set the extension's "never show on this
 * site" option.
 */

const SELECTOR = "input, textarea, select";

export function shouldSuppress(el: Element): boolean {
  if (!(el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement)) {
    return false;
  }
  if (el instanceof HTMLInputElement && (el.type === "password" || el.type === "hidden")) return false;
  if (el.closest("[data-allow-autofill]")) return false;
  const form = el.form ?? el.closest("form");
  if (form && form.querySelector('input[type="password"]')) return false;
  return true;
}

export function suppressElement(el: Element): void {
  if (!shouldSuppress(el)) return;
  if (!el.hasAttribute("data-1p-ignore")) el.setAttribute("data-1p-ignore", "true");
  if (!el.hasAttribute("data-lpignore")) el.setAttribute("data-lpignore", "true");
  if (!el.hasAttribute("data-bwignore")) el.setAttribute("data-bwignore", "true");
  if (!el.hasAttribute("data-form-type")) el.setAttribute("data-form-type", "other");
  if (!el.hasAttribute("autocomplete")) el.setAttribute("autocomplete", "off");
}

function suppressTree(root: ParentNode | Element): void {
  if (root instanceof Element && root.matches(SELECTOR)) suppressElement(root);
  root.querySelectorAll?.(SELECTOR).forEach(suppressElement);
}

/** Install once; returns a disposer. Safe to call again (returns a no-op). */
let installed = false;
export function installPasswordManagerSuppression(doc: Document = document): () => void {
  if (installed || typeof MutationObserver === "undefined") return () => {};
  installed = true;
  suppressTree(doc);
  const observer = new MutationObserver((mutations) => {
    for (const m of mutations) {
      m.addedNodes.forEach((n) => { if (n instanceof Element) suppressTree(n); });
    }
  });
  observer.observe(doc.documentElement, { childList: true, subtree: true });
  // Safety net for controls that appeared before the observer saw them.
  const onFocus = (e: Event) => { if (e.target instanceof Element) suppressElement(e.target); };
  doc.addEventListener("focusin", onFocus, true);
  return () => {
    observer.disconnect();
    doc.removeEventListener("focusin", onFocus, true);
    installed = false;
  };
}
