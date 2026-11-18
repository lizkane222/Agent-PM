import { useCallback, useEffect, useRef, useState } from "react";
import { accountsApi } from "../../../lib/api";
import type { AccountArtifact } from "../../../types";

export const SCREENSHOT_TYPES = ["image/png", "image/jpeg", "image/gif", "image/webp"];
export const SCREENSHOT_MAX_BYTES = 10 * 1024 * 1024;

/** The first acceptable image problem, or null. (The server re-checks the real bytes.) */
export function screenshotProblem(file: File): string | null {
  if (!SCREENSHOT_TYPES.includes(file.type)) return "The screenshot must be a PNG, JPEG, GIF or WebP image.";
  if (file.size > SCREENSHOT_MAX_BYTES) return "That image is too large (max 10 MB).";
  return null;
}

function isEditable(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  return !!el?.closest?.("input, textarea, select, [contenteditable=''], [contenteditable='true']");
}

function imageFromClipboard(data: DataTransfer | null): File | null {
  if (!data) return null;
  for (const f of Array.from(data.files ?? [])) if (f.type.startsWith("image/")) return f;
  for (const item of Array.from(data.items ?? [])) {
    if (item.kind === "file" && item.type.startsWith("image/")) return item.getAsFile();
  }
  return null;
}

/**
 * Lets the uploader give an artifact a screenshot to show as its preview: choose a file, drop
 * one on the panel, or paste (Cmd/Ctrl+V) one from the clipboard. Paste is only listened for
 * while this is mounted, and never when the caret is in a text field.
 */
export default function ScreenshotPicker({ artifact, onChanged, onCancel, headline, compact = false }: {
  artifact: AccountArtifact;
  onChanged: (a: AccountArtifact) => void;
  onCancel?: () => void;
  headline?: string;
  compact?: boolean;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [over, setOver] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const upload = useCallback(async (file: File) => {
    const problem = screenshotProblem(file);
    if (problem) { setError(problem); return; }
    setBusy(true); setError(null);
    try {
      const { data } = await accountsApi.uploadArtifactPreviewImage(artifact.id, file);
      onChanged(data);
    } catch (e) {
      const server = (e as { response?: { data?: { error?: string; detail?: string } } })?.response?.data;
      setError(server?.error ?? server?.detail ?? "Could not save the screenshot. Please try again.");
    } finally {
      setBusy(false);
    }
  }, [artifact.id, onChanged]);

  useEffect(() => {
    function onPaste(e: ClipboardEvent) {
      if (isEditable(e.target)) return;
      const file = imageFromClipboard(e.clipboardData);
      if (!file) return;
      e.preventDefault();
      void upload(file);
    }
    document.addEventListener("paste", onPaste);
    return () => document.removeEventListener("paste", onPaste);
  }, [upload]);

  return (
    <div
      data-testid="screenshot-picker"
      onDragOver={(e) => { e.preventDefault(); setOver(true); }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault(); setOver(false);
        const file = Array.from(e.dataTransfer.files).find((f) => f.type.startsWith("image/")) ?? e.dataTransfer.files[0];
        if (file) void upload(file);
      }}
      style={{
        border: `2px dashed ${over ? "var(--twilio-red, #e22)" : "var(--border-subtle)"}`,
        borderRadius: 12, padding: compact ? "14px 16px" : "22px 26px", textAlign: "center",
        background: "var(--surface-card)", color: "var(--twilio-navy)", maxWidth: 420,
      }}
    >
      {headline && <p style={{ margin: "0 0 4px", fontSize: "0.875rem", fontWeight: 600 }}>{headline}</p>}
      <p style={{ margin: "0 0 10px", fontSize: "0.75rem", color: "var(--text-gray-500)" }}>
        Choose an image, drop one here, or paste a screenshot (⌘V / Ctrl+V). PNG, JPEG, GIF or WebP, up to 10 MB.
      </p>
      <div style={{ display: "flex", gap: 8, justifyContent: "center" }}>
        <button type="button" disabled={busy} onClick={() => inputRef.current?.click()}
          style={{ fontSize: "0.75rem", fontWeight: 600, color: "#fff", background: "var(--twilio-red, #e22)", border: "none", borderRadius: 8, padding: "6px 14px", cursor: "pointer" }}>
          {busy ? "Saving…" : "Choose image"}
        </button>
        {onCancel && (
          <button type="button" disabled={busy} onClick={onCancel}
            style={{ fontSize: "0.75rem", color: "var(--text-gray-500)", background: "transparent", border: "none", cursor: "pointer" }}>
            Cancel
          </button>
        )}
      </div>
      <input
        ref={inputRef} type="file" accept={SCREENSHOT_TYPES.join(",")} hidden data-testid="screenshot-file-input"
        onChange={(e) => { const f = e.target.files?.[0]; if (f) void upload(f); e.target.value = ""; }}
      />
      {error && <p role="alert" style={{ margin: "8px 0 0", fontSize: "0.75rem", color: "#dc2626" }}>{error}</p>}
    </div>
  );
}
