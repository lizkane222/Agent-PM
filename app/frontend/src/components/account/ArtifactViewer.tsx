import { useCallback, useEffect, useRef, useState } from "react";
import type { AccountArtifact, CommentReference } from "../../types";
import { accountsApi } from "../../lib/api";
import { resolveEmojiShortcodes } from "../../lib/emojiShortcodes";
import { useCurrentUser } from "../../context/CurrentUserContext";
import { useAppError } from "../../context/AppErrorContext";
import ArtifactSidebar from "./ArtifactSidebar";
import { ArtifactPreviewBody, classifyArtifact } from "./artifactPreview";
import ScreenshotPicker from "./artifactPreview/ScreenshotPicker";

/** Layers that sit above the overlay and own Escape while they are open. */
const ESC_OWNER_SELECTOR = '[role="menu"], [role="listbox"], [role="alertdialog"], [data-esc-layer]';

function editableDraft(target: EventTarget | null): { field: HTMLElement; hasText: boolean } | null {
  const el = (target as HTMLElement | null)?.closest?.("input, textarea, [contenteditable=''], [contenteditable='true']") as HTMLElement | null;
  if (!el) return null;
  const value = el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement ? el.value : el.textContent ?? "";
  return { field: el, hasText: value.trim().length > 0 };
}

/**
 * Decides what Escape does inside the overlay (exported so the rule is tested on its own):
 *  - `"ignore"`: something above the overlay already handled it (the event was
 *    `preventDefault`ed) or owns it (an open menu / listbox / alert dialog / nested dialog);
 *  - `"blur"`: focus is in a text field that holds typed text. The first Escape leaves the field
 *    so a half-written note is never thrown away with the overlay; the next Escape closes it;
 *  - `"close"`: otherwise.
 */
export function escapeAction(e: KeyboardEvent, overlay: HTMLElement | null): "ignore" | "blur" | "close" {
  if (e.key !== "Escape" || e.defaultPrevented) return "ignore";
  const target = e.target as HTMLElement | null;
  const owner = target?.closest?.(ESC_OWNER_SELECTOR);
  if (owner) return "ignore";
  const dialog = target?.closest?.('[role="dialog"]');
  if (dialog && dialog !== overlay) return "ignore";
  const draft = editableDraft(target);
  if (draft?.hasText) return "blur";
  return "close";
}

export function ArtifactViewer({
  artifact: initial,
  onClose,
  canEdit,
  onUpdated,
  accountName,
  airtableAccountId,
}: {
  artifact: AccountArtifact;
  onClose: () => void;
  /** Kept for callers that still pass it; the preview now decides how to render by itself. */
  canPreview?: boolean;
  /** May the viewer edit the artifact's details? Omit it and the Edit button is not offered. */
  canEdit?: boolean;
  onUpdated?: (a: AccountArtifact) => void;
  accountName?: string | null;
  airtableAccountId?: number | null;
}) {
  const [artifact, setArtifact] = useState(initial);
  useEffect(() => { setArtifact(initial); }, [initial]);
  const me = useCurrentUser();
  const { reportError } = useAppError();
  const rootRef = useRef<HTMLDivElement>(null);
  const [linked, setLinked] = useState<CommentReference[]>([]);
  const [replacing, setReplacing] = useState(false);
  const [resolvedName, setResolvedName] = useState<string | null>(null);

  // The screenshot follows the server's edit rule: the uploader (or an Admin).
  const canChangePreview = canEdit ?? (!!me && (me.id === artifact.uploaded_by || me.access_level === "admin"));

  // Escape closes the overlay (see `escapeAction` for when it does not). Listening on the
  // document in the bubble phase lets any handler below it call preventDefault() first.
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    function handler(e: KeyboardEvent) {
      const action = escapeAction(e, rootRef.current);
      if (action === "blur") { (editableDraft(e.target)?.field as HTMLElement | undefined)?.blur(); return; }
      if (action === "close") closeRef.current();
    }
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, []);

  // Take focus on open and give it back on close, so keyboard users land where they were.
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    rootRef.current?.focus({ preventScroll: true });
    return () => { if (previous && document.contains(previous)) previous.focus?.({ preventScroll: true }); };
  }, []);

  // The account's name is needed to file action items made from a note under it.
  useEffect(() => {
    if (accountName || !artifact.account) return;
    let cancelled = false;
    accountsApi.getAccount(artifact.account)
      .then(({ data }) => { if (!cancelled) setResolvedName(data.company_name); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [accountName, artifact.account]);

  const changed = useCallback((a: AccountArtifact) => {
    setArtifact(a);
    setReplacing(false);
    onUpdated?.(a);
  }, [onUpdated]);

  async function removeScreenshot() {
    try {
      const { data } = await accountsApi.deleteArtifactPreviewImage(artifact.id);
      changed(data);
    } catch {
      reportError("Could not remove the screenshot. Please try again.");
    }
  }

  const href = artifact.file_url ?? artifact.url ?? "";
  const linkBtn: React.CSSProperties = { fontSize: "0.75rem", fontWeight: 600, color: "#fff", background: "rgba(255,255,255,0.15)", padding: "6px 12px", borderRadius: "6px", textDecoration: "none" };

  return (
    <div
      ref={rootRef} role="dialog" aria-modal="true" aria-label={`Preview of ${resolveEmojiShortcodes(artifact.name)}`} tabIndex={-1}
      className="fixed inset-0 z-[9000] flex flex-col bg-black/70 backdrop-blur-sm" style={{ outline: "none" }} onClick={onClose}
    >
      <div
        style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 20px", background: "rgba(0,0,0,0.6)", flexShrink: 0 }}
        onClick={(e) => e.stopPropagation()}
      >
        <p style={{ margin: 0, fontSize: "0.875rem", fontWeight: 600, color: "#fff", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: "60%" }}>
          {resolveEmojiShortcodes(artifact.name)}
        </p>
        <div style={{ display: "flex", gap: "10px", alignItems: "center" }}>
          {artifact.icon_key === "lucidchart" && artifact.secondary_url && (
            <a href={artifact.secondary_url} target="_blank" rel="noopener noreferrer"
              style={{ ...linkBtn, background: "rgba(8,145,178,0.4)" }} onClick={(e) => e.stopPropagation()}>Published ↗</a>
          )}
          {href && (
            <a href={href} target="_blank" rel="noopener noreferrer" style={linkBtn} onClick={(e) => e.stopPropagation()}>
              {artifact.icon_key === "lucidchart" ? "Edit ↗" : "Open in new tab ↗"}
            </a>
          )}
          <button className="card-btn" aria-label="Close preview" title="Close (Esc)" onClick={onClose}
            style={{ background: "transparent", border: "none", color: "#fff", fontSize: "1.25rem", cursor: "pointer", lineHeight: 1, padding: "2px 6px" }}>×</button>
        </div>
      </div>

      <div style={{ flex: 1, overflow: "hidden", display: "flex", minHeight: 0 }} onClick={(e) => e.stopPropagation()}>
        <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", overflow: "hidden" }}>
          <div style={{ flex: 1, minHeight: 0, overflow: "hidden", display: "flex", alignItems: "center", justifyContent: "center", padding: classifyArtifact(artifact) === "link" ? 24 : 0 }}>
            {replacing ? (
              <ScreenshotPicker artifact={artifact} onChanged={changed} onCancel={() => setReplacing(false)} headline="Replace the preview with a screenshot" />
            ) : (
              <ArtifactPreviewBody
                key={`${artifact.id}-${artifact.preview_image_url ?? ""}`}
                artifact={artifact} canEdit={canChangePreview} onChanged={changed}
              />
            )}
          </div>
          {canChangePreview && !replacing && (
            <div data-testid="screenshot-controls" style={{ flexShrink: 0, display: "flex", gap: 14, justifyContent: "center", padding: "6px 12px", background: "rgba(0,0,0,0.45)", fontSize: "0.6875rem" }}>
              <button type="button" onClick={() => setReplacing(true)} style={{ color: "#fff", background: "transparent", border: "none", cursor: "pointer", textDecoration: "underline" }}>
                {artifact.preview_image_url ? "Replace screenshot" : "Replace preview with a screenshot"}
              </button>
              {artifact.preview_image_url && (
                <button type="button" onClick={() => void removeScreenshot()} style={{ color: "#fff", background: "transparent", border: "none", cursor: "pointer", textDecoration: "underline" }}>
                  Remove screenshot
                </button>
              )}
            </div>
          )}
        </div>

        <ArtifactSidebar
          artifact={artifact}
          canEdit={canEdit === true}
          onUpdated={changed}
          accountName={accountName ?? resolvedName}
          airtableAccountId={airtableAccountId}
          linked={linked}
          onLinked={(ref) => setLinked((prev) => [...prev, ref])}
        />
      </div>
    </div>
  );
}
