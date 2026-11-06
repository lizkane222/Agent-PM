import { useEffect, useRef, useState } from "react";

export const ARTIFACT_IMAGE_MAX_BYTES = 5 * 1024 * 1024;
const ACCEPT = "image/png,image/jpeg,image/gif,image/webp";

/**
 * Optional custom image for an artifact. `existingUrl` is the image already saved on the
 * server; `file` is a newly picked one (not yet uploaded); `removed` marks the saved one for
 * deletion. The parent owns all three and decides what to send on save.
 */
export function ArtifactImageField({
  existingUrl, file, removed, onPick, onRemove, fallback,
}: {
  existingUrl?: string | null;
  file: File | null;
  removed: boolean;
  onPick: (f: File) => void;
  onRemove: () => void;
  /** What shows when there is no custom image — the icon / favicon that will be used. */
  fallback: React.ReactNode;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!file) { setPreviewUrl(null); return; }
    const url = URL.createObjectURL(file);
    setPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  const shownUrl = previewUrl ?? (removed ? null : existingUrl ?? null);

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (!f) return;
    if (!/^image\/(png|jpeg|gif|webp)$/.test(f.type)) { setError("Use a PNG, JPEG, GIF or WebP image."); return; }
    if (f.size > ARTIFACT_IMAGE_MAX_BYTES) { setError("Image must be 5 MB or smaller."); return; }
    setError(null);
    onPick(f);
  }

  return (
    <div style={{ marginTop: "14px" }} data-testid="artifact-image-field">
      <p style={{ margin: "0 0 8px", fontSize: "0.75rem", fontWeight: 600, color: "var(--text-secondary, #888)" }}>
        Image <span style={{ fontWeight: 400 }}>(optional — otherwise the icon below, or the site's favicon, is used)</span>
      </p>
      <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
        <div style={{ width: 40, height: 40, borderRadius: 8, border: "1px solid var(--border, rgba(0,0,0,0.12))", background: "var(--bg, #f5f5f5)", display: "flex", alignItems: "center", justifyContent: "center", overflow: "hidden" }}>
          {shownUrl
            ? <img src={shownUrl} alt="Artifact" data-testid="artifact-image-preview" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
            : fallback}
        </div>
        <input ref={inputRef} type="file" accept={ACCEPT} onChange={handleChange} style={{ display: "none" }} data-testid="artifact-image-input" />
        <button type="button" className="card-btn" onClick={() => inputRef.current?.click()} style={{ padding: "5px 10px", borderRadius: 7, border: "1px solid var(--border, rgba(0,0,0,0.12))", background: "var(--surface, #fff)", fontSize: "0.75rem", cursor: "pointer" }}>
          {shownUrl ? "Replace image" : "Upload image"}
        </button>
        {shownUrl && (
          <button type="button" className="card-btn" onClick={() => { setError(null); onRemove(); }} style={{ padding: "5px 10px", borderRadius: 7, border: "none", background: "transparent", fontSize: "0.75rem", cursor: "pointer", color: "#dc2626" }}>
            Remove
          </button>
        )}
      </div>
      {error && <p role="alert" style={{ margin: "6px 0 0", fontSize: "0.6875rem", color: "#dc2626" }}>{error}</p>}
    </div>
  );
}
