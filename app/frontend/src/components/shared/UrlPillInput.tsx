import { useEffect, useRef } from "react";

/**
 * The open state of a URL pill — one input, shared by all five pill copies.
 *
 * Extracted because every copy committed on **blur only**. Pasting a link and then pressing
 * Enter, or pasting and clicking something that does not move focus, silently discarded it:
 * the pill collapsed back to "Slack" and the value was never handed to the form, let alone
 * saved. `onPaste` is the fix — a pasted URL is the whole intent of this field, so it commits
 * straight away and closes, which makes the "Slack ↗" chip the confirmation that it took.
 *
 * Only the input is shared. Each pill keeps its own chip and button markup, which differs
 * slightly between the Action Items, Account Detail and Calendar copies.
 */
export default function UrlPillInput({
  value,
  onCommit,
  onCancel,
}: {
  value: string | undefined;
  /** The new value. Fires at most once — see `committedRef`. */
  onCommit: (next: string) => void;
  /** Escape: stop editing without committing. */
  onCancel: () => void;
}) {
  const ref = useRef<HTMLInputElement>(null);
  // Committing closes the pill, which unmounts this input — and removing a focused element
  // can fire blur on the way out, so without this a paste would commit twice.
  const committedRef = useRef(false);

  useEffect(() => { ref.current?.focus(); }, []);

  function commit(next: string) {
    if (committedRef.current) return;
    committedRef.current = true;
    onCommit(next);
  }

  return (
    <input
      ref={ref}
      type="url"
      defaultValue={value ?? ""}
      onPaste={(e) => {
        // Applied by hand rather than read back after the default paste: the post-paste value
        // is not available synchronously, and deferring a tick to read it would not work in
        // jsdom, which never applies clipboard data to the input at all.
        const pasted = e.clipboardData?.getData("text") ?? "";
        if (!pasted) return;
        e.preventDefault();
        const el = e.currentTarget;
        const start = el.selectionStart ?? el.value.length;
        const end = el.selectionEnd ?? start;
        const next = el.value.slice(0, start) + pasted + el.value.slice(end);
        el.value = next;
        commit(next.trim());
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          // Also stops an enclosing form from submitting on what reads as "I'm done typing".
          e.preventDefault();
          commit(e.currentTarget.value.trim());
        } else if (e.key === "Escape") {
          e.preventDefault();
          committedRef.current = true;
          onCancel();
        }
      }}
      onBlur={(e) => commit(e.target.value.trim())}
      // Keeps a click in the input from reaching a card whose own onClick opens a modal.
      onClick={(e) => e.stopPropagation()}
      placeholder="https://…"
      className="w-40 rounded-full border border-indigo-400 bg-white px-2.5 py-0.5 text-[12px] font-semibold focus:outline-none"
    />
  );
}
