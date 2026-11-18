import { useState } from "react";
import SiteFavicon, { httpOrigin, safeHttpUrl } from "../../shared/SiteFavicon";
import { resolveEmojiShortcodes } from "../../../lib/emojiShortcodes";
import type { AccountArtifact } from "../../../types";

const GOOGLE_EMBED_HOSTS = new Set(["docs.google.com", "drive.google.com"]);

/** A Google Docs/Sheets/Slides/Drive URL turned into its embeddable `/preview` form, else null. */
export function googleEmbedUrl(url: string): string | null {
  try {
    const u = new URL(url);
    if (u.protocol !== "https:" || !GOOGLE_EMBED_HOSTS.has(u.hostname)) return null;
    const m = u.pathname.match(/^(\/(?:document|spreadsheets|presentation)\/d\/[^/]+|\/file\/d\/[^/]+)/);
    return m ? `${u.origin}${m[1]}/preview` : null;
  } catch { return null; }
}

/**
 * A URL artifact. Nothing is loaded from the link until the user asks: the card is just the
 * site's icon, the address and an Open button. Same-origin pages embed straight away; the
 * user's own Google docs can be embedded after a click ("Show embedded preview").
 */
export default function LinkPreview({ artifact }: { artifact: AccountArtifact }) {
  const url = artifact.url ?? "";
  const safe = safeHttpUrl(url);
  const [embed, setEmbed] = useState(false);
  const sameOrigin = !!safe && httpOrigin(safe) === window.location.origin;
  const google = safe ? googleEmbedUrl(safe) : null;
  const embedUrl = sameOrigin ? safe : embed ? google : null;

  if (embedUrl) {
    return (
      <iframe
        src={embedUrl} title={artifact.name} data-testid="link-embed"
        sandbox="allow-scripts allow-same-origin allow-popups allow-forms"
        referrerPolicy="no-referrer"
        style={{ width: "100%", height: "100%", border: "none", background: "var(--surface-card)" }}
      />
    );
  }
  return (
    <div data-testid="link-card" style={{ background: "var(--surface-card)", color: "var(--twilio-navy)", borderRadius: 12, padding: "22px 26px", maxWidth: 460, width: "100%", textAlign: "center" }}>
      <div style={{ display: "flex", justifyContent: "center", marginBottom: 10 }}>
        <SiteFavicon url={safe} name={artifact.name} size={40} />
      </div>
      <p style={{ margin: "0 0 4px", fontSize: "1rem", fontWeight: 600 }}>{resolveEmojiShortcodes(artifact.name)}</p>
      <p style={{ margin: "0 0 14px", fontSize: "0.75rem", color: "var(--text-gray-500)", wordBreak: "break-all" }}>{safe ?? "This link has no web address."}</p>
      <div style={{ display: "flex", gap: 8, justifyContent: "center", flexWrap: "wrap" }}>
        {safe && (
          <a href={safe} target="_blank" rel="noopener noreferrer"
            style={{ fontSize: "0.8125rem", fontWeight: 600, color: "#fff", background: "var(--twilio-red, #e22)", padding: "8px 16px", borderRadius: 8, textDecoration: "none" }}>
            Open ↗
          </a>
        )}
        {google && (
          <button type="button" onClick={() => setEmbed(true)}
            style={{ fontSize: "0.8125rem", fontWeight: 600, color: "var(--twilio-navy)", background: "var(--surface-subtle)", border: "1px solid var(--border-subtle)", padding: "8px 16px", borderRadius: 8, cursor: "pointer" }}>
            Show embedded preview
          </button>
        )}
      </div>
      {google && <p style={{ margin: "10px 0 0", fontSize: "0.6875rem", color: "var(--text-gray-500)" }}>Embedding loads the document from Google.</p>}
    </div>
  );
}
