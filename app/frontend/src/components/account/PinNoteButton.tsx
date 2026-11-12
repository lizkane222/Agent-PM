import React, { createContext, useCallback, useContext, useMemo, useState } from "react";
import { accountsApi } from "../../lib/api";
import { addLog } from "../../lib/appLog";
import { htmlToPreviewText } from "../../lib/noteHelpers";
import { useAppError } from "../../context/AppErrorContext";
import type { AccountNote } from "../../types";

/** Where a pinned note came from. `resourceId` is the meeting / calendar event id. */
export interface PinSource {
  accountId: number;
  accountName?: string | null;
  label: string;
  date?: string | null;
  resourceId: number;
  url: string;
  /** Called with the created note so the page's notes list updates without a reload. */
  onPinned?: (note: AccountNote) => void;
}

const PinNoteContext = createContext<PinSource | null>(null);

export function PinNoteProvider({ value, children }: { value: PinSource | null; children: React.ReactNode }) {
  return <PinNoteContext.Provider value={value}>{children}</PinNoteContext.Provider>;
}

function escapeHtml(s: string) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function normalize(s: string) {
  return s.replace(/\s+/g, " ").trim().toLowerCase();
}

/** Body for the account note: the text (HTML kept as-is for rich notes), then a source line. */
export function buildPinnedContent(text: string, isHtml: boolean, source: Pick<PinSource, "label" | "date">) {
  const body = isHtml ? text.trim() : `<p>${escapeHtml(text.trim())}</p>`;
  const when = source.date ? ` (${source.date.slice(0, 10)})` : "";
  return `${body}<p><em>From ${escapeHtml(source.label)}${when}</em></p>`;
}

/** True when `notes` already holds this text pinned from the same meeting. */
export function isAlreadyPinned(notes: AccountNote[], text: string, isHtml: boolean, source: Pick<PinSource, "resourceId">) {
  const want = normalize(isHtml ? htmlToPreviewText(text) : text);
  return notes.some((n) => {
    const refs = (n as AccountNote & { references?: { resource_type: string; resource_id: number }[] }).references ?? [];
    if (!refs.some((r) => r.resource_type === "meeting" && r.resource_id === source.resourceId)) return false;
    return normalize(htmlToPreviewText(n.content)).startsWith(want);
  });
}

export const PIN_TITLE = "Pin this note to the account's notes (adds a copy to this account's Meeting Notes list)";
export const PINNED_TITLE = "Pinned to account notes";

/** Pin icon for a note/bullet's action rail. Sits below the trash button. */
export function PinNoteButton({ text, isHtml = false }: { text: string; isHtml?: boolean }) {
  const source = useContext(PinNoteContext);
  const { reportError } = useAppError();
  const [pinned, setPinned] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");

  const pin = useCallback(async () => {
    if (!source || busy) return;
    if (pinned) { setNotice("Already pinned"); return; }
    setBusy(true);
    try {
      const existing = (await accountsApi.listNotes(source.accountId)).data;
      if (isAlreadyPinned(existing, text, isHtml, source)) { setPinned(true); setNotice("Already pinned"); return; }
      const { data } = await accountsApi.createNote(source.accountId, buildPinnedContent(text, isHtml, source), [
        { resource_type: "meeting", resource_id: source.resourceId, label: source.label, url: source.url },
      ]);
      setPinned(true);
      setNotice("Pinned to account notes");
      source.onPinned?.(data);
      addLog({
        category: "account",
        message: `Pinned a note from "${source.label}" to ${source.accountName || "the account"}'s notes`,
        links: [{ label: "View account", path: `/accounts/${source.accountId}` }],
        resource: { type: "account", id: source.accountId },
      });
    } catch {
      reportError("Could not pin this note to the account's notes.", "PinNoteButton");
    } finally {
      setBusy(false);
    }
  }, [source, busy, pinned, text, isHtml, reportError]);

  const title = useMemo(() => (pinned ? PINNED_TITLE : PIN_TITLE), [pinned]);
  if (!source) return null;
  return (
    <>
      <button
        type="button"
        title={title}
        aria-label={title}
        aria-pressed={pinned}
        onClick={() => void pin()}
        style={{ padding: "2px", borderRadius: "3px", background: "none", border: "none", cursor: "pointer", display: "flex", alignItems: "center", color: pinned ? "#2563eb" : "var(--text-gray-400)" }}
        className={pinned ? "transition-opacity" : "opacity-0 group-hover:opacity-100 transition-opacity"}
      >
        <svg viewBox="0 0 16 16" fill={pinned ? "currentColor" : "none"} stroke="currentColor" strokeWidth="1.4" style={{ width: "12px", height: "12px" }}>
          <path d="M9.5 2l4.5 4.5-2 .5-2.5 2.5.5 3-1 1-2.5-2.5L3 13.5 2.5 13l3-3.5L3 7l1-1 3 .5L9.5 4z" strokeLinejoin="round" />
        </svg>
      </button>
      {notice && <span role="status" style={{ position: "absolute", right: 0, top: "100%", fontSize: "10px", color: "#2563eb", whiteSpace: "nowrap" }}>{notice}</span>}
    </>
  );
}
