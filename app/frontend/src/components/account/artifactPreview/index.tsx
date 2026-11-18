/**
 * The artifact preview overlay's body.
 *
 *   renderArtifactPreview(artifact, { canEdit, onChanged })
 *
 * picks how to show an artifact (see `classify.ts`): the user's own screenshot first, then the
 * browser's native renderers for images / PDF / video / audio, a link card for URLs, and the
 * server's description for everything else. Nothing is sent to a third-party viewer: Office
 * files, text and archives are parsed by our own backend, and a link is only embedded after a click.
 */
import { useState } from "react";
import { resolveEmojiShortcodes } from "../../../lib/emojiShortcodes";
import type { AccountArtifact } from "../../../types";
import { classifyArtifact } from "./classify";
import LinkPreview from "./LinkPreview";
import PreviewFallback from "./PreviewFallback";
import RemotePreview from "./RemotePreview";

export { classifyArtifact, type PreviewMode } from "./classify";
export { default as ScreenshotPicker } from "./ScreenshotPicker";

export interface ArtifactPreviewOptions {
  /** May this user add, replace or remove the screenshot? */
  canEdit: boolean;
  onChanged: (a: AccountArtifact) => void;
}

export function ArtifactPreviewBody({ artifact, canEdit, onChanged }: { artifact: AccountArtifact } & ArtifactPreviewOptions) {
  const mode = classifyArtifact(artifact);
  // A file the browser cannot actually decode (corrupt image, 404) falls back like any other.
  const [failed, setFailed] = useState(false);
  const href = artifact.file_url ?? artifact.url ?? "";
  const title = resolveEmojiShortcodes(artifact.name);
  if (failed && mode !== "remote" && mode !== "link") {
    return <PreviewFallback artifact={artifact} reason="failed" canEdit={canEdit} onChanged={onChanged} />;
  }
  const onError = () => setFailed(true);
  switch (mode) {
    case "screenshot":
      return <img src={artifact.preview_image_url ?? ""} alt={`Screenshot of ${title}`} data-testid="preview-screenshot" onError={onError} style={{ maxWidth: "100%", maxHeight: "100%", objectFit: "contain" }} />;
    case "image":
      return <img src={href} alt={title} data-testid="preview-image" onError={onError} style={{ maxWidth: "100%", maxHeight: "100%", objectFit: "contain" }} />;
    case "pdf":
      // No `sandbox`: browsers' built-in PDF viewers do not run inside a sandboxed frame.
      return <iframe src={href} title={title} data-testid="preview-pdf" style={{ width: "100%", height: "100%", border: "none", background: "var(--surface-card)" }} />;
    case "video":
      return <video src={href} controls preload="metadata" data-testid="preview-video" onError={onError} style={{ maxWidth: "100%", maxHeight: "100%" }} />;
    case "audio":
      return <audio src={href} controls preload="metadata" data-testid="preview-audio" onError={onError} />;
    case "link":
      return <LinkPreview artifact={artifact} />;
    case "remote":
      return <RemotePreview artifact={artifact} canEdit={canEdit} onChanged={onChanged} />;
  }
}

export function renderArtifactPreview(artifact: AccountArtifact, options: ArtifactPreviewOptions) {
  return <ArtifactPreviewBody artifact={artifact} {...options} />;
}
