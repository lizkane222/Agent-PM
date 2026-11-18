import { useMemo, useState } from "react";
import { useArtifactPreview } from "../../../hooks/useArtifactPreview";
import { markdownToHtml } from "../../../lib/markdownToHtml";
import { sanitizeHtml } from "../../../lib/noteHelpers";
import type { AccountArtifact, ArtifactPreviewResult } from "../../../types";
import PreviewFallback from "./PreviewFallback";

const panel: React.CSSProperties = {
  width: "100%", height: "100%", overflow: "auto", background: "var(--surface-card)",
  color: "var(--twilio-navy)", boxSizing: "border-box",
};

function TruncatedNote({ show }: { show: boolean }) {
  if (!show) return null;
  return (
    <p data-testid="preview-truncated" style={{ margin: 0, padding: "6px 14px", fontSize: "0.6875rem", background: "var(--surface-subtle)", color: "var(--text-gray-500)", borderBottom: "1px solid var(--border-subtle)" }}>
      Showing the first part of this file. Open it to see everything.
    </p>
  );
}

function prettyJson(text: string): string {
  try { return JSON.stringify(JSON.parse(text), null, 2); } catch { return text; }
}

function Table({ sheets }: { sheets: { name: string; rows: string[][] }[] }) {
  const [active, setActive] = useState(0);
  const sheet = sheets[Math.min(active, sheets.length - 1)];
  if (!sheet) return <p style={{ padding: 16, fontSize: "0.8125rem" }}>This file has no rows.</p>;
  return (
    <div>
      {sheets.length > 1 && (
        <div role="tablist" aria-label="Sheets" style={{ display: "flex", gap: 4, padding: "6px 10px", borderBottom: "1px solid var(--border-subtle)" }}>
          {sheets.map((s, i) => (
            <button key={i} role="tab" aria-selected={i === active} onClick={() => setActive(i)}
              style={{ fontSize: "0.75rem", padding: "3px 10px", borderRadius: 6, border: "none", cursor: "pointer", background: i === active ? "var(--twilio-red, #e22)" : "var(--surface-subtle)", color: i === active ? "#fff" : "var(--twilio-navy)" }}>
              {s.name || `Sheet ${i + 1}`}
            </button>
          ))}
        </div>
      )}
      <table style={{ borderCollapse: "collapse", fontSize: "0.75rem", margin: 8 }}>
        <tbody>
          {sheet.rows.map((row, r) => (
            <tr key={r}>
              {row.map((cell, c) => (
                <td key={c} style={{ border: "1px solid var(--border-subtle)", padding: "3px 8px", maxWidth: 280, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontWeight: r === 0 ? 600 : 400 }} title={cell}>{cell}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Body({ data, artifact }: { data: Extract<ArtifactPreviewResult, { kind: "text" | "html" | "table" | "document" | "slides" | "archive" }>; artifact: AccountArtifact }) {
  const markdown = useMemo(
    () => (data.kind === "text" && data.format === "markdown" ? sanitizeHtml(markdownToHtml(data.text)) : ""),
    [data],
  );
  switch (data.kind) {
    case "text":
      if (data.format === "markdown") {
        return <div className="rich-text" data-testid="preview-markdown" style={{ padding: "16px 22px", fontSize: "0.875rem" }} dangerouslySetInnerHTML={{ __html: markdown }} />;
      }
      return (
        <pre data-testid="preview-text" data-format={data.format}
          style={{ margin: 0, padding: "14px 18px", fontSize: "0.75rem", lineHeight: 1.5, whiteSpace: "pre-wrap", wordBreak: "break-word", fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace" }}>
          {data.format === "json" ? prettyJson(data.text) : data.text}
        </pre>
      );
    case "html":
      // Fully sandboxed (no scripts, no same-origin, no forms, no popups): the file cannot run
      // anything or reach the app, whatever it contains.
      return <iframe sandbox="" srcDoc={data.html} title={artifact.name} data-testid="preview-html" style={{ width: "100%", height: "100%", minHeight: 400, border: "none", background: "Canvas", colorScheme: "light" }} />;
    case "table":
      return <div data-testid="preview-table"><Table sheets={data.sheets} /></div>;
    case "document":
      return <div data-testid="preview-document" style={{ padding: "18px 26px", fontSize: "0.875rem", lineHeight: 1.6, whiteSpace: "pre-wrap", maxWidth: 820, margin: "0 auto" }}>{data.text}</div>;
    case "slides":
      return (
        <ol data-testid="preview-slides" style={{ listStyle: "none", margin: 0, padding: 16, display: "grid", gap: 12 }}>
          {data.slides.map((s) => (
            <li key={s.index} style={{ border: "1px solid var(--border-subtle)", borderRadius: 8, padding: "10px 14px", background: "var(--surface-subtle)" }}>
              <p style={{ margin: "0 0 4px", fontSize: "0.625rem", fontWeight: 700, textTransform: "uppercase", color: "var(--text-gray-500)" }}>Slide {s.index}</p>
              {s.lines.length === 0 ? <p style={{ margin: 0, fontSize: "0.75rem", fontStyle: "italic", color: "var(--text-gray-500)" }}>No text on this slide</p>
                : s.lines.map((line, i) => <p key={i} style={{ margin: "2px 0", fontSize: i === 0 ? "0.9375rem" : "0.8125rem", fontWeight: i === 0 ? 600 : 400 }}>{line}</p>)}
            </li>
          ))}
        </ol>
      );
    case "archive":
      return (
        <ul data-testid="preview-archive" style={{ listStyle: "none", margin: 0, padding: "10px 16px", fontSize: "0.75rem", fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace" }}>
          {data.entries.map((e, i) => (
            <li key={i} style={{ display: "flex", justifyContent: "space-between", gap: 16, padding: "2px 0" }}>
              <span style={{ wordBreak: "break-all" }}>{e.name}</span>
              <span style={{ color: "var(--text-gray-500)", flexShrink: 0 }}>{e.size.toLocaleString()} B</span>
            </li>
          ))}
        </ul>
      );
  }
}

/**
 * Previews that need the server (text/code, markdown, CSV, HTML, Office files, archives). The
 * server parses the file under size and time limits and answers with a small description; this
 * renders it read-only. Loading, error and "too large" are all handled here.
 */
export default function RemotePreview({ artifact, canEdit, onChanged }: {
  artifact: AccountArtifact;
  canEdit: boolean;
  onChanged: (a: AccountArtifact) => void;
}) {
  const { data, loading, error } = useArtifactPreview(artifact.id);

  if (loading || (!data && !error)) {
    return <p data-testid="preview-loading" style={{ color: "#fff", fontSize: "0.8125rem" }}>Loading preview…</p>;
  }
  if (error || !data) return <PreviewFallback artifact={artifact} reason="failed" canEdit={canEdit} onChanged={onChanged} />;
  if (data.kind === "native" || data.kind === "unsupported" || data.kind === "too_large" || data.kind === "unavailable" || data.kind === "error") {
    return <PreviewFallback artifact={artifact} reason={data.kind === "unsupported" || data.kind === "native" ? "unsupported" : data.kind} canEdit={canEdit} onChanged={onChanged} />;
  }
  return (
    <div style={panel} data-testid="remote-preview" data-kind={data.kind}>
      <TruncatedNote show={data.truncated} />
      <Body data={data} artifact={artifact} />
    </div>
  );
}
