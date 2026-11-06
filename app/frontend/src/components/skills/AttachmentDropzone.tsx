import { useRef, useState } from "react";
import { fmtBytes } from "twilio-agent-pm-shared";

export interface PendingAttachment {
  /** Local key — the real id exists only after the skill is saved. */
  key: string;
  name: string;
  file?: File;
  url?: string;
  size?: number | null;
}

export interface SavedAttachmentView {
  id: number;
  name: string;
  url?: string;
  file_size?: number | null;
  has_text?: boolean;
  artifact?: number | null;
}

const ACCEPT = ".md,.markdown,.txt,.csv,.json,.html,.htm,.docx,.pdf";

/**
 * Drag-and-drop (or browse / paste-a-link) attachments. Files are held locally until the
 * skill exists, then uploaded; already-saved attachments can be viewed and removed.
 * Uploaded documents become account artifacts when an account is chosen.
 */
export default function AttachmentDropzone({
  pending, onPendingChange, saved = [], onRemoveSaved, onView, disabled,
}: {
  pending: PendingAttachment[];
  onPendingChange: (next: PendingAttachment[]) => void;
  saved?: SavedAttachmentView[];
  onRemoveSaved?: (id: number) => void;
  onView?: (id: number) => void;
  disabled?: boolean;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const [link, setLink] = useState("");

  function addFiles(files: FileList | File[]) {
    const next = Array.from(files).map((f) => ({
      key: `${f.name}-${f.size}-${Math.random().toString(36).slice(2, 7)}`, name: f.name, file: f, size: f.size,
    }));
    if (next.length) onPendingChange([...pending, ...next]);
  }
  function addLink() {
    const url = link.trim();
    if (!/^https?:\/\//i.test(url)) return;
    onPendingChange([...pending, { key: `url-${Date.now()}`, name: url, url }]);
    setLink("");
  }

  return (
    <div data-testid="attachment-dropzone">
      <label style={{ display: "block", fontSize: "0.8125rem", fontWeight: 600, color: "var(--text-secondary, #666)", marginBottom: "6px", letterSpacing: "0.04em" }}>
        ATTACHMENTS <span style={{ fontWeight: 400, opacity: 0.6 }}>(documents become context — and artifacts when you pick an account)</span>
      </label>
      <div
        onDragOver={(e) => { e.preventDefault(); if (!disabled) setOver(true); }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => { e.preventDefault(); setOver(false); if (!disabled && e.dataTransfer?.files) addFiles(e.dataTransfer.files); }}
        style={{
          border: `1.5px dashed ${over ? "var(--twilio-red, #e22)" : "rgba(0,0,0,0.2)"}`, borderRadius: "8px",
          padding: "14px", textAlign: "center", background: over ? "rgba(226,35,26,0.04)" : "transparent",
          fontSize: "0.8125rem", color: "var(--text-secondary, #888)",
        }}>
        Drop files here or{" "}
        <button type="button" disabled={disabled} onClick={() => inputRef.current?.click()}
          style={{ background: "none", border: "none", padding: 0, cursor: "pointer", color: "var(--twilio-red, #e22)", fontWeight: 600, fontFamily: "var(--font-base)" }}>
          browse
        </button>
        <div style={{ fontSize: "0.6875rem", marginTop: "4px" }}>.md · .txt · .docx · .pdf · .html (up to 15 MB)</div>
        <input ref={inputRef} type="file" multiple accept={ACCEPT} data-testid="attachment-input" style={{ display: "none" }}
          onChange={(e) => { if (e.target.files) addFiles(e.target.files); e.target.value = ""; }} />
      </div>

      <div style={{ display: "flex", gap: "6px", marginTop: "8px" }}>
        <input value={link} onChange={(e) => setLink(e.target.value)} placeholder="…or paste a link (https://…)"
          aria-label="Attachment link"
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addLink(); } }}
          style={{ flex: 1, padding: "6px 10px", borderRadius: "6px", fontSize: "0.8125rem", border: "1px solid var(--border, rgba(0,0,0,0.12))", fontFamily: "var(--font-base)" }} />
        <button type="button" onClick={addLink} disabled={!/^https?:\/\//i.test(link.trim())} style={smallBtn}>Add link</button>
      </div>

      {(saved.length > 0 || pending.length > 0) && (
        <ul style={{ listStyle: "none", margin: "8px 0 0", padding: 0, display: "flex", flexDirection: "column", gap: "4px" }}>
          {saved.map((a) => (
            <li key={`s${a.id}`} style={row}>
              <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                📎 {a.name}
                {a.file_size ? <span style={meta}> · {fmtBytes(a.file_size)}</span> : null}
                {a.artifact ? <span style={meta}> · filed as artifact</span> : null}
              </span>
              {a.has_text && onView && <button type="button" style={smallBtn} onClick={() => onView(a.id)}>View</button>}
              {onRemoveSaved && <button type="button" style={smallBtn} aria-label={`Remove ${a.name}`} onClick={() => onRemoveSaved(a.id)}>Remove</button>}
            </li>
          ))}
          {pending.map((p) => (
            <li key={p.key} style={row}>
              <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                📎 {p.name}
                {p.size ? <span style={meta}> · {fmtBytes(p.size)}</span> : null}
                <span style={meta}> · uploads when you save</span>
              </span>
              <button type="button" style={smallBtn} aria-label={`Remove ${p.name}`}
                onClick={() => onPendingChange(pending.filter((x) => x.key !== p.key))}>Remove</button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

const row: React.CSSProperties = { display: "flex", alignItems: "center", gap: "8px", padding: "6px 10px", borderRadius: "6px", background: "rgba(0,0,0,0.03)", fontSize: "0.8125rem" };
const meta: React.CSSProperties = { color: "var(--text-secondary, #999)", fontSize: "0.75rem" };
const smallBtn: React.CSSProperties = { padding: "3px 10px", borderRadius: "6px", fontSize: "0.75rem", fontWeight: 600, border: "1px solid rgba(0,0,0,0.15)", background: "transparent", cursor: "pointer", fontFamily: "var(--font-base)", color: "var(--text-secondary, #666)" };
