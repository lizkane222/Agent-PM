import { useEffect, useState, type ReactNode } from "react";
import { CATALOG_BY_KEY, getAutoIconKey } from "../account/ArtifactIcon";

/** The URL's origin when it is an http(s) link; null for anything else (javascript:, data:, junk). */
export function httpOrigin(url: string | null | undefined): string | null {
  try {
    const u = new URL(url ?? "");
    return u.protocol === "http:" || u.protocol === "https:" ? u.origin : null;
  } catch { return null; }
}

/** Only http(s) links may be rendered as an `href`. */
export function safeHttpUrl(url: string | null | undefined): string | null {
  return httpOrigin(url) ? (url as string) : null;
}

/**
 * The icon of the site a link points at.
 *
 * Order: (1) the app's own bundled icon for a recognised service (Google Docs, Segment…),
 * (2) the site's own `<origin>/favicon.ico`, (3) `fallback`, or a letter tile.
 *
 * Deliberately NOT a third-party favicon service: these URLs can be internal hostnames and
 * must not be sent to anyone but the site itself. Non-http(s) URLs are never fetched.
 */
export default function SiteFavicon({
  url, name = "", size = 20, fallback,
}: {
  url: string | null | undefined;
  name?: string;
  size?: number;
  fallback?: ReactNode;
}) {
  const origin = httpOrigin(url);
  const known = origin ? CATALOG_BY_KEY[getAutoIconKey(url as string)]?.assetUrl : undefined;
  // 0 = bundled icon, 1 = the site's favicon, 2 = fallback.
  const [stage, setStage] = useState(known ? 0 : 1);
  useEffect(() => { setStage(known ? 0 : 1); }, [url, known]);

  const common = { width: size, height: size, style: { objectFit: "contain" as const, borderRadius: 3, display: "block", flexShrink: 0 } };

  if (origin && stage === 0 && known) {
    return <img {...common} src={known} alt="" data-testid="site-favicon" data-source="service" onError={() => setStage(1)} />;
  }
  if (origin && stage <= 1) {
    return <img {...common} src={`${origin}/favicon.ico`} alt="" data-testid="site-favicon" data-source="site" onError={() => setStage(2)} />;
  }
  if (fallback) return <>{fallback}</>;
  const letter = (name.trim()[0] ?? "?").toUpperCase();
  return (
    <span
      data-testid="site-favicon-fallback"
      aria-hidden="true"
      style={{
        width: size, height: size, flexShrink: 0, borderRadius: 4, display: "inline-flex",
        alignItems: "center", justifyContent: "center", fontSize: Math.max(9, size * 0.5), fontWeight: 700,
        background: "var(--surface-subtle-2)", color: "var(--text-gray-500, #6b7280)",
      }}
    >
      {letter}
    </span>
  );
}
