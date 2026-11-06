import { useState } from "react";
import {
  ARTIFACT_ICON_CATALOG, ArtifactIconImg, fileIconKeyFor, type ArtifactIconEntry,
} from "./ArtifactIcon";
import { ArtifactImageField } from "./ArtifactImageField";

export interface PendingUpload {
  file: File;
  iconKey: string;
  image: File | null;
}

const FILE_ICONS = ARTIFACT_ICON_CATALOG.filter((e) => e.key.startsWith("file_"));

/**
 * Shown after files are picked or dropped, before anything is uploaded: lets the user choose
 * which file-type icon represents each file (pre-selected from its type) and optionally
 * attach an image. Confirming returns one {file, iconKey, image} per file.
 */
export function UploadFileDialog({
  files, onCancel, onConfirm,
}: {
  files: File[];
  onCancel: () => void;
  onConfirm: (uploads: PendingUpload[]) => void;
}) {
  const [rows, setRows] = useState<PendingUpload[]>(() =>
    files.map((file) => ({ file, iconKey: fileIconKeyFor(file.type, file.name), image: null })),
  );
  const [removed, setRemoved] = useState<Record<number, boolean>>({});

  const update = (i: number, patch: Partial<PendingUpload>) =>
    setRows((prev) => prev.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={onCancel}>
      <div
        role="dialog"
        aria-label="Upload files"
        data-testid="upload-file-dialog"
        onClick={(e) => e.stopPropagation()}
        style={{ background: "var(--surface, #fff)", borderRadius: 12, padding: 20, width: 520, maxWidth: "calc(100vw - 32px)", maxHeight: "calc(100vh - 48px)", overflowY: "auto", boxShadow: "0 20px 50px rgba(0,0,0,0.25)" }}
      >
        <p style={{ margin: "0 0 4px", fontSize: "0.9375rem", fontWeight: 700 }}>Upload {rows.length === 1 ? "file" : `${rows.length} files`}</p>
        <p style={{ margin: "0 0 14px", fontSize: "0.75rem", color: "var(--text-secondary, #888)" }}>Choose the icon that represents each file.</p>

        {rows.map((row, i) => (
          <div key={i} data-testid={`upload-row-${i}`} style={{ paddingBottom: 14, marginBottom: 14, borderBottom: i < rows.length - 1 ? "1px solid var(--border, rgba(0,0,0,0.08))" : "none" }}>
            <p style={{ margin: "0 0 8px", fontSize: "0.8125rem", fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{row.file.name}</p>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
              {FILE_ICONS.map((entry: ArtifactIconEntry) => {
                const selected = row.iconKey === entry.key;
                return (
                  <button
                    key={entry.key}
                    type="button"
                    title={entry.label}
                    aria-pressed={selected}
                    data-testid={`upload-icon-${i}-${entry.key}`}
                    onClick={() => update(i, { iconKey: entry.key })}
                    className="card-btn"
                    style={{
                      display: "flex", alignItems: "center", gap: 5, padding: "5px 8px", borderRadius: 7, cursor: "pointer",
                      border: selected ? "2px solid var(--twilio-red, #e22)" : "1px solid var(--border, rgba(0,0,0,0.12))",
                      background: selected ? "rgba(226,34,34,0.06)" : "var(--bg, #f5f5f5)",
                      fontSize: "0.6875rem", fontWeight: selected ? 600 : 400, color: "var(--text-primary, #111)", outline: "none",
                    }}
                  >
                    <ArtifactIconImg entry={entry} size={14} />
                    <span>{entry.label}</span>
                  </button>
                );
              })}
            </div>
            <ArtifactImageField
              file={row.image}
              removed={removed[i] ?? false}
              onPick={(f) => { update(i, { image: f }); setRemoved((p) => ({ ...p, [i]: false })); }}
              onRemove={() => { update(i, { image: null }); setRemoved((p) => ({ ...p, [i]: true })); }}
              fallback={<ArtifactIconImg entry={ARTIFACT_ICON_CATALOG.find((e) => e.key === row.iconKey) ?? FILE_ICONS[0]} size={22} />}
            />
          </div>
        ))}

        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
          <button type="button" className="card-btn" onClick={onCancel} style={{ padding: "8px 16px", borderRadius: 8, border: "1px solid var(--border, rgba(0,0,0,0.12))", background: "var(--surface, #fff)", fontSize: "0.8125rem", cursor: "pointer", color: "var(--text-secondary, #888)" }}>Cancel</button>
          <button type="button" className="card-btn" onClick={() => onConfirm(rows)} style={{ padding: "8px 16px", borderRadius: 8, border: "none", background: "var(--twilio-red, #e22)", color: "#fff", fontSize: "0.8125rem", fontWeight: 600, cursor: "pointer" }}>
            Upload
          </button>
        </div>
      </div>
    </div>
  );
}
