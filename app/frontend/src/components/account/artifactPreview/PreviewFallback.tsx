import { ArtifactIcon } from "../ArtifactIcon";
import { resolveEmojiShortcodes } from "../../../lib/emojiShortcodes";
import type { AccountArtifact } from "../../../types";
import ScreenshotPicker from "./ScreenshotPicker";

const REASONS: Record<string, string> = {
  too_large: "This file is too large to preview.",
  unavailable: "This file is no longer available to preview.",
  error: "A preview could not be built for this file.",
  failed: "The preview could not be loaded.",
};

/**
 * Shown when no preview can be rendered: an unsupported type, a failed extraction, a file that is
 * too large. The uploader can supply a screenshot to stand in for it.
 */
export default function PreviewFallback({ artifact, reason = "unsupported", canEdit, onChanged }: {
  artifact: AccountArtifact;
  reason?: string;
  canEdit: boolean;
  onChanged: (a: AccountArtifact) => void;
}) {
  const href = artifact.file_url ?? artifact.url ?? "";
  return (
    <div data-testid="preview-fallback" style={{ textAlign: "center", color: "#fff", padding: 24, maxWidth: 460 }}>
      <div style={{ marginBottom: 12, display: "flex", justifyContent: "center" }}>
        <ArtifactIcon artifactType={artifact.artifact_type} mime={artifact.mime_type} name={artifact.name} url={artifact.url} iconKey={artifact.icon_key} imageUrl={artifact.image_url} size={48} />
      </div>
      <p style={{ fontSize: "1rem", fontWeight: 600, margin: "0 0 6px" }}>{resolveEmojiShortcodes(artifact.name)}</p>
      <p style={{ fontSize: "0.8125rem", color: "rgba(255,255,255,0.7)", margin: "0 0 4px" }}>No preview available for this file type</p>
      {REASONS[reason] && <p style={{ fontSize: "0.75rem", color: "rgba(255,255,255,0.55)", margin: "0 0 16px" }}>{REASONS[reason]}</p>}
      {canEdit ? (
        <div style={{ display: "flex", justifyContent: "center", marginTop: 12 }}>
          <ScreenshotPicker artifact={artifact} onChanged={onChanged} headline="Add a screenshot as the preview" compact />
        </div>
      ) : (
        <p style={{ fontSize: "0.75rem", color: "rgba(255,255,255,0.55)", margin: "12px 0" }}>
          Whoever added this file can add a screenshot to show here.
        </p>
      )}
      {href && (
        <a href={href} target="_blank" rel="noopener noreferrer"
          style={{ display: "inline-block", marginTop: 14, fontSize: "0.8125rem", fontWeight: 600, color: "#fff", background: "rgba(255,255,255,0.15)", padding: "8px 16px", borderRadius: 8, textDecoration: "none" }}>
          Open file ↗
        </a>
      )}
    </div>
  );
}
