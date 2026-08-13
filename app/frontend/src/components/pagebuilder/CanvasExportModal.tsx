import { useState, useEffect } from "react";
import { toPng, toJpeg } from "html-to-image";
import type { CanvasNode } from "./types";

interface Props {
  nodes: CanvasNode[];
  selectedId: string | null;
  canvasRef: React.RefObject<HTMLDivElement | null>;
  viewportRef: React.RefObject<HTMLDivElement | null>;
  onClose: () => void;
  onDeselectAll: () => void;
}

type Scope = "viewport" | "selected" | `page:${string}`;

// ── HTML serializer for Google Drive / Notion exports ─────────────────────────

function escHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function serializeNodeToHtml(n: CanvasNode): string {
  const p = n.props;
  switch (n.type) {
    case "Page": {
      const label = (p.label as string) || "Page";
      const inner = n.children.map(serializeNodeToHtml).join("\n");
      return `<section style="page-break-before:always"><h2>${escHtml(label)}</h2>${inner}</section>`;
    }
    case "Heading": {
      const level = (p.level as number) ?? 1;
      return `<h${level}>${escHtml((p.text as string) ?? "")}</h${level}>`;
    }
    case "Text":
    case "Label":
      return `<p>${escHtml((p.text as string) ?? "")}</p>`;
    case "RichText":
      return `<div>${(p.content as string) ?? ""}</div>`;
    case "Divider":
      return "<hr/>";
    case "Button":
      return `<p><strong>${escHtml((p.label as string) ?? "Button")}</strong></p>`;
    case "StatCard":
      return `<p><strong>${escHtml((p.label as string) ?? "")}:</strong> ${escHtml((p.value as string) ?? "")}</p>`;
    case "ActionItemCard":
      return `<p>[ ] ${escHtml((p.taskTitle as string) ?? "")} — ${escHtml((p.status as string) ?? "")}</p>`;
    case "AccountCard":
      return `<p>🏢 ${escHtml((p.companyName as string) ?? "")}</p>`;
    case "TeamMemberCard":
      return `<p>👤 ${escHtml((p.fullName as string) ?? "")} — ${escHtml((p.title as string) ?? "")}</p>`;
    default:
      if (n.children.length > 0) return n.children.map(serializeNodeToHtml).join("\n");
      return "";
  }
}

function buildHtmlDocument(nodes: CanvasNode[], title: string): string {
  const body = nodes.map(serializeNodeToHtml).join("\n");
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>${escHtml(title)}</title>
  <style>
    body { font-family: -apple-system, sans-serif; max-width: 820px; margin: 2em auto; color: #222; line-height: 1.6; }
    section { margin: 2em 0; padding: 1.5em; border: 1px solid #e5e7eb; border-radius: 8px; }
    h2 { margin-top: 0; border-bottom: 1px solid #e5e7eb; padding-bottom: 0.5em; }
    hr { border: none; border-top: 1px solid #e5e7eb; margin: 1em 0; }
  </style>
</head>
<body>
${body}
</body>
</html>`;
}

// ── Integration config ────────────────────────────────────────────────────────

const INTEGRATION_DEFS = [
  { provider: "google_drive", label: "Google Drive", icon: "🗂️", action: "Create Google Doc" },
  { provider: "notion",       label: "Notion",        icon: "📝", action: "Export to Notion" },
  { provider: "microsoft",    label: "Microsoft",     icon: "🟦", action: "Export to OneDrive" },
] as const;

type KnownProvider = typeof INTEGRATION_DEFS[number]["provider"];

// ── Component ─────────────────────────────────────────────────────────────────

export default function CanvasExportModal({
  nodes, selectedId, viewportRef, onClose, onDeselectAll,
}: Props) {
  const pageNodes = nodes.filter((n) => n.type === "Page");
  const defaultScope: Scope = pageNodes.length > 0
    ? (`page:${pageNodes[0].id}` as Scope)
    : selectedId ? "selected" : "viewport";

  const [scope, setScope] = useState<Scope>(defaultScope);
  const [exporting, setExporting] = useState<string | null>(null);
  const [connectedProviders, setConnectedProviders] = useState<Set<string>>(new Set());
  const [integrationResult, setIntegrationResult] = useState<{ url: string; provider: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/integrations/status/", { credentials: "include" })
      .then((r) => r.json())
      .then((d) => {
        const providers = (d.connected as { provider: string }[] ?? []).map((c) => c.provider);
        setConnectedProviders(new Set(providers));
      })
      .catch(() => {});
  }, []);

  function getTargetEl(): HTMLElement | null {
    if (scope === "viewport") return viewportRef.current;
    if (scope === "selected" && selectedId) {
      return document.querySelector(`[data-node-id="${selectedId}"]`) as HTMLElement | null;
    }
    if (scope.startsWith("page:")) {
      const id = scope.slice(5);
      return document.querySelector(`[data-node-id="${id}"]`) as HTMLElement | null;
    }
    return null;
  }

  function getScopeNodes(): CanvasNode[] {
    if (scope === "viewport" || scope === "selected") return nodes;
    if (scope.startsWith("page:")) {
      const id = scope.slice(5);
      const page = nodes.find((n) => n.id === id);
      return page ? [page] : nodes;
    }
    return nodes;
  }

  function getScopeTitle(): string {
    if (scope === "viewport") return "Canvas Export";
    if (scope === "selected") {
      const n = nodes.find((nd) => nd.id === selectedId);
      return n ? `${n.type} Export` : "Canvas Export";
    }
    if (scope.startsWith("page:")) {
      const id = scope.slice(5);
      const page = nodes.find((n) => n.id === id);
      return (page?.props.label as string) || "Page Export";
    }
    return "Canvas Export";
  }

  async function exportLocal(format: "png" | "jpg") {
    onDeselectAll();
    await new Promise((r) => requestAnimationFrame(r));
    const el = getTargetEl();
    if (!el) { setError("Could not find the target element."); return; }
    setExporting(format);
    setError(null);
    try {
      const dataUrl = format === "png"
        ? await toPng(el, { cacheBust: true, pixelRatio: 2 })
        : await toJpeg(el, { quality: 0.95, cacheBust: true, pixelRatio: 2 });
      const a = document.createElement("a");
      a.href = dataUrl;
      a.download = `${getScopeTitle().toLowerCase().replace(/\s+/g, "-")}.${format}`;
      a.click();
    } catch (err) {
      console.error("Export failed:", err);
      setError("Image export failed. Try a different scope or reduce canvas size.");
    } finally {
      setExporting(null);
    }
  }

  function exportPrint() {
    const title = getScopeTitle();
    const scopeNodes = getScopeNodes();
    const html = buildHtmlDocument(scopeNodes, title);
    const win = window.open("", "_blank");
    if (!win) { setError("Pop-up blocked — please allow pop-ups and try again."); return; }
    win.document.write(html);
    win.document.close();
    win.focus();
    win.print();
  }

  async function exportIntegration(provider: KnownProvider) {
    const title = getScopeTitle();
    const scopeNodes = getScopeNodes();
    const html = buildHtmlDocument(scopeNodes, title);
    setExporting(provider);
    setError(null);
    setIntegrationResult(null);

    try {
      let endpoint = "";
      let body: Record<string, string> = {};

      if (provider === "google_drive") {
        endpoint = "/api/integrations/canvas-export/google-drive/";
        body = { title, html };
      } else if (provider === "notion") {
        endpoint = "/api/integrations/canvas-export/notion/";
        body = { title, content: scopeNodes.map(serializeNodeToHtml).join("\n") };
      } else if (provider === "microsoft") {
        endpoint = "/api/integrations/canvas-export/microsoft/";
        body = { title, html };
      }

      const res = await fetch(endpoint, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || "Export failed");
      setIntegrationResult({ url: data.url, provider });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Export failed");
    } finally {
      setExporting(null);
    }
  }

  const selectedNode = nodes.find((n) => n.id === selectedId);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-md mx-4 overflow-hidden">

        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
          <h2 className="text-base font-bold text-[var(--twilio-navy)]">Export Canvas Content</h2>
          <button onClick={onClose} className="text-[var(--twilio-gray-40)] hover:text-[var(--twilio-navy)] transition-colors">✕</button>
        </div>

        <div className="p-5 flex flex-col gap-5 max-h-[70vh] overflow-y-auto">

          {/* ── Scope ── */}
          <section>
            <p className="text-xs font-bold uppercase tracking-widest text-[var(--twilio-gray-60)] mb-2">What to Export</p>
            <div className="flex flex-col gap-1.5">
              {/* Page components first */}
              {pageNodes.map((pg) => (
                <label key={pg.id} className="flex items-center gap-2.5 cursor-pointer">
                  <input
                    type="radio" name="scope"
                    checked={scope === `page:${pg.id}`}
                    onChange={() => setScope(`page:${pg.id}` as Scope)}
                    className="text-[var(--twilio-blue)]"
                  />
                  <span className="text-xs">📄 {(pg.props.label as string) || "Page"}</span>
                  <span className="text-[10px] text-[var(--twilio-gray-40)]">
                    {pg.props.width as number}×{pg.props.height as number}px
                  </span>
                </label>
              ))}
              {/* Selected node */}
              {selectedId && selectedNode && (
                <label className="flex items-center gap-2.5 cursor-pointer">
                  <input
                    type="radio" name="scope"
                    checked={scope === "selected"}
                    onChange={() => setScope("selected")}
                    className="text-[var(--twilio-blue)]"
                  />
                  <span className="text-xs">Selected: {selectedNode.type}</span>
                </label>
              )}
              {/* Viewport */}
              <label className="flex items-center gap-2.5 cursor-pointer">
                <input
                  type="radio" name="scope"
                  checked={scope === "viewport"}
                  onChange={() => setScope("viewport")}
                  className="text-[var(--twilio-blue)]"
                />
                <span className="text-xs">Viewport (current view)</span>
              </label>
            </div>
          </section>

          {/* ── Local file export ── */}
          <section>
            <p className="text-xs font-bold uppercase tracking-widest text-[var(--twilio-gray-60)] mb-2">Local File</p>
            <div className="flex gap-2">
              <button
                onClick={() => exportLocal("png")}
                disabled={exporting !== null}
                className="flex-1 px-3 py-2 rounded-lg text-xs font-semibold border border-gray-200 text-[var(--twilio-navy)] hover:bg-gray-50 disabled:opacity-50 transition-colors"
              >
                {exporting === "png" ? "Exporting…" : "PNG"}
              </button>
              <button
                onClick={() => exportLocal("jpg")}
                disabled={exporting !== null}
                className="flex-1 px-3 py-2 rounded-lg text-xs font-semibold border border-gray-200 text-[var(--twilio-navy)] hover:bg-gray-50 disabled:opacity-50 transition-colors"
              >
                {exporting === "jpg" ? "Exporting…" : "JPG"}
              </button>
              <button
                onClick={exportPrint}
                disabled={exporting !== null}
                className="flex-1 px-3 py-2 rounded-lg text-xs font-semibold border border-gray-200 text-[var(--twilio-navy)] hover:bg-gray-50 disabled:opacity-50 transition-colors"
              >
                PDF / Print
              </button>
            </div>
          </section>

          {/* ── Integration export ── */}
          <section>
            <p className="text-xs font-bold uppercase tracking-widest text-[var(--twilio-gray-60)] mb-2">Export to Integration</p>
            <div className="flex flex-col gap-2">
              {INTEGRATION_DEFS.map(({ provider, label, icon, action }) => {
                const connected = connectedProviders.has(provider);
                return (
                  <div key={provider} className="flex items-center gap-3 py-2 px-3 rounded-lg border border-gray-100 bg-[#f9fafb]">
                    <span className="text-base leading-none">{icon}</span>
                    <span className="text-xs font-medium text-[var(--twilio-navy)] flex-1">{label}</span>
                    {connected ? (
                      <button
                        onClick={() => exportIntegration(provider)}
                        disabled={exporting !== null}
                        className="px-3 py-1 rounded-lg text-xs font-semibold bg-[var(--twilio-blue)] text-white hover:opacity-90 disabled:opacity-50 transition-opacity"
                      >
                        {exporting === provider ? "Exporting…" : action}
                      </button>
                    ) : (
                      <a
                        href="/settings"
                        className="text-xs text-[var(--twilio-gray-40)] hover:text-[var(--twilio-blue)] transition-colors"
                      >
                        Connect in Settings →
                      </a>
                    )}
                  </div>
                );
              })}
            </div>
          </section>

          {/* Integration success */}
          {integrationResult && (
            <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
              Export complete.{" "}
              <a
                href={integrationResult.url}
                target="_blank"
                rel="noreferrer"
                className="font-semibold underline"
              >
                Open in {INTEGRATION_DEFS.find((d) => d.provider === integrationResult.provider)?.label}
              </a>
            </div>
          )}

          {/* Error */}
          {error && (
            <p className="text-xs text-red-500">{error}</p>
          )}
        </div>

        <div className="px-5 py-3 border-t border-gray-100 flex justify-end">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-lg text-sm text-[var(--twilio-gray-60)] hover:bg-gray-100 transition-colors"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
