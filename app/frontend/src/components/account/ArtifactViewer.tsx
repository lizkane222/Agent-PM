import { useEffect } from "react";
import type { AccountArtifact } from "../../types";
import { ArtifactIcon } from "./ArtifactIcon";
import { resolveEmojiShortcodes } from "../../lib/emojiShortcodes";
import { plainToHtml, sanitizeHtml } from "../../lib/noteHelpers";
import LinkedRecordsList from "../shared/LinkedRecordsList";

export function ArtifactViewer({
  artifact,
  onClose,
  canPreview,
}: {
  artifact: AccountArtifact;
  onClose: () => void;
  canPreview: boolean;
}) {
  useEffect(() => {
    function handler(e: KeyboardEvent) { if (e.key === "Escape") onClose(); }
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [onClose]);

  const href = artifact.file_url ?? artifact.url ?? "";
  const references = artifact.references ?? [];
  const usedIn = artifact.used_in ?? [];
  const hasDetails = Boolean(artifact.description?.trim()) || references.length > 0 || usedIn.length > 0 || Boolean(artifact.uploaded_by_username);

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-black/70 backdrop-blur-sm" onClick={onClose}>
      <div
        style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 20px", background: "rgba(0,0,0,0.6)", flexShrink: 0 }}
        onClick={(e) => e.stopPropagation()}
      >
        <p style={{ margin: 0, fontSize: "0.875rem", fontWeight: 600, color: "#fff", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: "60%" }}>
          {resolveEmojiShortcodes(artifact.name)}
        </p>
        <div style={{ display: "flex", gap: "10px", alignItems: "center" }}>
          {artifact.icon_key === "lucidchart" && artifact.secondary_url && (
            <a
              href={artifact.secondary_url}
              target="_blank"
              rel="noopener noreferrer"
              style={{ fontSize: "0.75rem", fontWeight: 600, color: "#fff", background: "rgba(8,145,178,0.4)", padding: "6px 12px", borderRadius: "6px", textDecoration: "none" }}
              onClick={(e) => e.stopPropagation()}
            >Published ↗</a>
          )}
          {href && (
            <a
              href={href}
              target="_blank"
              rel="noopener noreferrer"
              style={{ fontSize: "0.75rem", fontWeight: 600, color: "#fff", background: "rgba(255,255,255,0.15)", padding: "6px 12px", borderRadius: "6px", textDecoration: "none" }}
              onClick={(e) => e.stopPropagation()}
            >
              {artifact.icon_key === "lucidchart" ? "Edit ↗" : "Open in new tab ↗"}
            </a>
          )}
          <button className="card-btn" onClick={onClose} style={{ background: "transparent", border: "none", color: "#fff", fontSize: "1.25rem", cursor: "pointer", lineHeight: 1, padding: "2px 6px" }}>×</button>
        </div>
      </div>

      <div style={{ flex: 1, overflow: "hidden", display: "flex", minHeight: 0 }} onClick={(e) => e.stopPropagation()}>
        <div style={{ flex: 1, overflow: "hidden", display: "flex", alignItems: "center", justifyContent: "center" }}>
        {canPreview && artifact.mime_type.startsWith("image/") ? (
          <img src={href} alt={artifact.name} style={{ maxWidth: "100%", maxHeight: "100%", objectFit: "contain" }} />
        ) : canPreview ? (
          <iframe src={href} title={artifact.name} style={{ width: "100%", height: "100%", border: "none", background: "#fff" }} />
        ) : (
          <div style={{ textAlign: "center", color: "#fff" }}>
            <div style={{ fontSize: "3rem", marginBottom: "12px", display: "flex", justifyContent: "center" }}>
              <ArtifactIcon artifactType={artifact.artifact_type} mime={artifact.mime_type} name={artifact.name} url={artifact.url} iconKey={artifact.icon_key} size={48} />
            </div>
            <p style={{ fontSize: "1rem", fontWeight: 600, marginBottom: "8px" }}>{resolveEmojiShortcodes(artifact.name)}</p>
            <p style={{ fontSize: "0.8125rem", color: "rgba(255,255,255,0.6)", marginBottom: "20px" }}>Preview not available</p>
            <a href={href} target="_blank" rel="noopener noreferrer" style={{ fontSize: "0.875rem", fontWeight: 600, color: "#fff", background: "var(--twilio-red, #e22)", padding: "10px 20px", borderRadius: "8px", textDecoration: "none" }}>
              Open file ↗
            </a>
          </div>
        )}
        </div>

        {hasDetails && (
          <aside
            data-testid="artifact-details"
            style={{ width: "300px", flexShrink: 0, background: "#fff", overflowY: "auto", padding: "16px", borderLeft: "1px solid rgba(0,0,0,0.08)" }}
          >
            {artifact.uploaded_by_username && (
              <div className="flex items-center gap-2 mb-3">
                <span className="w-6 h-6 rounded-full bg-indigo-600 text-white text-[10px] font-bold flex items-center justify-center shrink-0">
                  {artifact.uploaded_by_username[0].toUpperCase()}
                </span>
                <span className="text-xs text-gray-600">
                  Added by <span className="font-semibold text-gray-800">{artifact.uploaded_by_username}</span>
                </span>
              </div>
            )}
            {artifact.description?.trim() && (
              <div className="mb-3">
                <p className="text-[9px] font-semibold text-[var(--twilio-gray-60)] uppercase tracking-wide">Description</p>
                <div
                  className="mt-1 text-xs text-[var(--twilio-navy)] prose-sm"
                  dangerouslySetInnerHTML={{ __html: sanitizeHtml(plainToHtml(artifact.description)) }}
                />
              </div>
            )}
            <LinkedRecordsList title="Mentions in description" references={references} className="mb-3" />
            <LinkedRecordsList title="Used in" references={usedIn} />
          </aside>
        )}
      </div>
    </div>
  );
}
