import { useState } from "react";
import { ArtifactIcon } from "../account/ArtifactIcon";
import { MAX_QUICK_LINKS, useQuickLinks } from "../../hooks/useQuickLinks";

const ERRORS = {
  invalid: "Enter a web link, like docs.google.com/… or https://example.com",
  duplicate: "That link is already here.",
  full: `You can keep up to ${MAX_QUICK_LINKS} quick links. Remove one to add another.`,
} as const;

/**
 * The user's own quick links, and the input to add one. Sits at the bottom of the "+ new file"
 * list. Each link's icon comes from the link itself (a known service's icon, else the site's
 * favicon) through the same component the Artifacts panel uses.
 */
export default function QuickLinks({ accent }: { accent: string }) {
  const { links, add, remove } = useQuickLinks();
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);

  function submit() {
    if (!value.trim()) return;
    const result = add(value);
    if (result.ok) {
      setValue("");
      setError(null);
    } else {
      setError(ERRORS[result.reason]);
    }
  }

  return (
    <div style={{ marginTop: 6, paddingTop: 8, borderTop: "1px solid var(--border, rgba(0,0,0,0.08))" }}>
      {links.map((l) => (
        <div key={l.id} style={{ display: "flex", alignItems: "center" }}>
          <a
            href={l.url}
            target="_blank"
            rel="noopener noreferrer"
            title={l.url}
            style={{ flex: 1, minWidth: 0, display: "flex", alignItems: "center", gap: 10, padding: "6px 10px", borderRadius: 8, textDecoration: "none", color: "var(--text-primary, #111)", fontSize: "0.8125rem", fontWeight: 500 }}
          >
            <span style={{ width: 28, height: 28, borderRadius: 6, background: "var(--bg, #f5f5f5)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
              <ArtifactIcon artifactType="link" mime="" name={l.label} url={l.url} size={16} />
            </span>
            <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{l.label}</span>
          </a>
          <button
            type="button"
            aria-label={`Remove ${l.label}`}
            onClick={() => remove(l.id)}
            style={{ background: "none", border: "none", cursor: "pointer", color: "var(--text-secondary, #aaa)", fontSize: "0.75rem", padding: "4px 8px" }}
          >✕</button>
        </div>
      ))}

      <div style={{ display: "flex", gap: 6, padding: "4px 6px 2px" }}>
        <input
          type="text"
          aria-label="Add a quick link"
          placeholder="+ Add a quick link"
          value={value}
          onChange={(e) => { setValue(e.target.value); if (error) setError(null); }}
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); submit(); } }}
          aria-invalid={error ? true : undefined}
          style={{ flex: 1, minWidth: 0, padding: "6px 8px", borderRadius: 6, fontSize: "0.75rem", fontFamily: "inherit", boxSizing: "border-box", border: `1px solid ${error ? "#dc2626" : "var(--border, rgba(0,0,0,0.15))"}` }}
        />
        <button
          type="button"
          aria-label="Add quick link"
          onClick={submit}
          disabled={!value.trim()}
          style={{ padding: "6px 10px", borderRadius: 6, border: `1px solid ${accent}`, background: "transparent", color: accent, fontSize: "0.75rem", fontWeight: 600, cursor: value.trim() ? "pointer" : "default", opacity: value.trim() ? 1 : 0.5 }}
        >Add</button>
      </div>
      {error && <p role="alert" style={{ margin: "4px 8px 2px", fontSize: "0.6875rem", color: "#dc2626" }}>{error}</p>}
    </div>
  );
}
