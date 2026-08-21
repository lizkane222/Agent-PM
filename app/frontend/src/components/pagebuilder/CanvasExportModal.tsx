import { useState, useEffect } from "react";
import { toPng, toJpeg } from "html-to-image";
import { integrationsApi } from "../../lib/api";
import type { CanvasNode } from "./types";

interface Props {
  nodes: CanvasNode[];
  selectedId: string | null;
  viewportRef: React.RefObject<HTMLDivElement | null>;
  onClose: () => void;
  onDeselectAll: () => void;
}

type Scope = "viewport" | "selected" | "all-pages" | `page:${string}`;

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
    case "RecordCard": {
      // Without an explicit case this falls to `default`, and since RecordCard has
      // no children that returns "" — a dropped record would vanish from the
      // exported document while still being visible on the canvas.
      const parts = [
        `<strong>${escHtml((p.recordTitle as string) ?? "")}</strong>`,
        (p.typeLabel as string) ? `(${escHtml(p.typeLabel as string)})` : "",
        (p.accountName as string) ? `— ${escHtml(p.accountName as string)}` : "",
      ].filter(Boolean).join(" ");
      const summary = (p.summary as string) ? `<br/>${escHtml(p.summary as string)}` : "";
      const url = (p.url as string) ? `<br/><a href="${escHtml(p.url as string)}">${escHtml(p.url as string)}</a>` : "";
      return `<p>${parts}${summary}${url}</p>`;
    }
    default:
      if (n.children.length > 0) return n.children.map(serializeNodeToHtml).join("\n");
      return "";
  }
}

/**
 * Markdown counterpart of `serializeNodeToHtml`. Kept as a sibling switch rather
 * than an HTML→Markdown conversion so each node type controls its own output —
 * and so a node with no meaningful text (shapes, dividers) can contribute nothing
 * instead of leaving stray markup.
 */
function serializeNodeToMarkdown(n: CanvasNode, depth = 0): string {
  const p = n.props;
  const kids = (d = depth) => n.children.map((c) => serializeNodeToMarkdown(c, d)).filter(Boolean).join("\n\n");
  switch (n.type) {
    case "Page": {
      const label = (p.label as string) || "Page";
      const inner = kids(depth + 1);
      return `# ${label}\n\n${inner}`.trimEnd();
    }
    case "Heading": {
      const level = Math.min(6, Math.max(1, ((p.level as number) ?? 1) + 1));
      return `${"#".repeat(level)} ${(p.text as string) ?? ""}`;
    }
    case "Text":
    case "Label":
      return (p.text as string) ?? "";
    case "RichText":
      // Strip tags; a full HTML→MD conversion isn't worth a dependency here.
      return ((p.content as string) ?? "").replace(/<[^>]+>/g, "").trim();
    case "Divider":
      return "---";
    case "Button":
      return `**[${(p.label as string) ?? "Button"}]**`;
    case "Badge":
    case "Pill":
      return `\`${(p.text as string) ?? ""}\``;
    case "StatCard":
      return `**${(p.label as string) ?? ""}:** ${(p.value as string) ?? ""}`;
    case "ActionItemCard":
      return `- [ ] ${(p.taskTitle as string) ?? ""} — ${(p.status as string) ?? ""}`;
    case "AccountCard":
      return `- 🏢 ${(p.companyName as string) ?? ""}`;
    case "TeamMemberCard":
      return `- 👤 ${(p.fullName as string) ?? ""} — ${(p.title as string) ?? ""}`;
    case "RecordCard": {
      const head = [
        `**${(p.recordTitle as string) ?? ""}**`,
        (p.typeLabel as string) ? `_(${p.typeLabel as string})_` : "",
        (p.accountName as string) ? `— ${p.accountName as string}` : "",
      ].filter(Boolean).join(" ");
      const body = (p.summary as string) ? `\n\n${p.summary as string}` : "";
      const url = (p.url as string) ? `\n\n<${p.url as string}>` : "";
      return `${head}${body}${url}`;
    }
    default:
      return kids();
  }
}

function buildMarkdownDocument(nodes: CanvasNode[], title: string): string {
  const body = nodes.map((n) => serializeNodeToMarkdown(n)).filter(Boolean).join("\n\n");
  // A Page already emits its own `# label` heading, so don't double up.
  const needsTitle = !nodes.some((n) => n.type === "Page");
  return needsTitle ? `# ${title}\n\n${body}\n` : `${body}\n`;
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
    // Via integrationsApi, not a bare fetch: this used to call
    // "/api/integrations/status/" while the app serves "/api/v1/…", so it 404'd
    // into the silent catch below and every provider read as disconnected
    // forever. Going through the shared client means the prefix can't drift.
    integrationsApi.getStatus()
      .then(({ data }) => {
        const providers = ((data as { connected?: { provider: string }[] }).connected ?? [])
          .map((c) => c.provider);
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
    if (scope === "all-pages") return pageNodes.length > 0 ? pageNodes : nodes;
    if (scope === "viewport" || scope === "selected") return nodes;
    if (scope.startsWith("page:")) {
      const id = scope.slice(5);
      const page = nodes.find((n) => n.id === id);
      return page ? [page] : nodes;
    }
    return nodes;
  }

  function getScopeTitle(): string {
    if (scope === "all-pages") return "All Pages";
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

  function fileStem(name: string): string {
    return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "export";
  }

  function downloadBlob(contents: string, filename: string, mime: string) {
    const url = URL.createObjectURL(new Blob([contents], { type: mime }));
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function renderImage(el: HTMLElement, format: "png" | "jpg"): Promise<string> {
    return format === "png"
      ? await toPng(el, { cacheBust: true, pixelRatio: 2 })
      : await toJpeg(el, { quality: 0.95, cacheBust: true, pixelRatio: 2 });
  }

  async function exportLocal(format: "png" | "jpg") {
    onDeselectAll();
    await new Promise((r) => requestAnimationFrame(r));
    setExporting(format);
    setError(null);
    try {
      // "All pages" as an image means one file per page: the pages live on a
      // zero-size transform layer, so there is no single element that contains
      // them all to rasterise.
      if (scope === "all-pages" && pageNodes.length > 0) {
        for (const pg of pageNodes) {
          const el = document.querySelector(`[data-node-id="${pg.id}"]`) as HTMLElement | null;
          if (!el) continue;
          const dataUrl = await renderImage(el, format);
          const a = document.createElement("a");
          a.href = dataUrl;
          a.download = `${fileStem((pg.props.label as string) || "page")}.${format}`;
          a.click();
        }
        return;
      }

      const el = getTargetEl();
      if (!el) { setError("Could not find the target element."); return; }
      const dataUrl = await renderImage(el, format);
      const a = document.createElement("a");
      a.href = dataUrl;
      a.download = `${fileStem(getScopeTitle())}.${format}`;
      a.click();
    } catch (err) {
      console.error("Export failed:", err);
      setError("Image export failed. Try a different scope or reduce canvas size.");
    } finally {
      setExporting(null);
    }
  }

  function exportText(format: "md" | "html") {
    const title = getScopeTitle();
    const scopeNodes = getScopeNodes();
    setError(null);
    if (format === "md") {
      downloadBlob(buildMarkdownDocument(scopeNodes, title), `${fileStem(title)}.md`, "text/markdown");
    } else {
      downloadBlob(buildHtmlDocument(scopeNodes, title), `${fileStem(title)}.html`, "text/html");
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
              {/* All pages, when there is more than one to distinguish */}
              {pageNodes.length > 1 && (
                <label className="flex items-center gap-2.5 cursor-pointer">
                  <input
                    type="radio" name="scope"
                    checked={scope === "all-pages"}
                    onChange={() => setScope("all-pages")}
                    className="text-[var(--twilio-blue)]"
                  />
                  <span className="text-xs font-semibold">📚 All pages</span>
                  <span className="text-[10px] text-[var(--twilio-gray-40)]">
                    {pageNodes.length} pages · images export one file each
                  </span>
                </label>
              )}
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
            <div className="flex gap-2 mt-2">
              <button
                onClick={() => exportText("md")}
                disabled={exporting !== null}
                className="flex-1 px-3 py-2 rounded-lg text-xs font-semibold border border-gray-200 text-[var(--twilio-navy)] hover:bg-gray-50 disabled:opacity-50 transition-colors"
              >
                Markdown
              </button>
              <button
                onClick={() => exportText("html")}
                disabled={exporting !== null}
                className="flex-1 px-3 py-2 rounded-lg text-xs font-semibold border border-gray-200 text-[var(--twilio-navy)] hover:bg-gray-50 disabled:opacity-50 transition-colors"
              >
                HTML
              </button>
            </div>
          </section>

          {/* ── Integration export ── */}
          <section>
            <p className="text-xs font-bold uppercase tracking-widest text-[var(--twilio-gray-60)] mb-2">Export to Integration</p>
            {/* These POST to /integrations/canvas-export/… which does not exist in
                the backend yet (only the OAuth connect/callback routes do), so the
                buttons are held disabled rather than shipped to 404. */}
            <div className="mb-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] text-amber-800">
              Sending a page straight to Drive, Notion or OneDrive isn’t available yet — the
              server side of it hasn’t been built. Use Markdown or HTML above and upload the
              file, or PNG for an image.
            </div>
            <div className="flex flex-col gap-2 opacity-60">
              {INTEGRATION_DEFS.map(({ provider, label, icon, action }) => {
                const connected = connectedProviders.has(provider);
                return (
                  <div key={provider} className="flex items-center gap-3 py-2 px-3 rounded-lg border border-gray-100 bg-[#f9fafb]">
                    <span className="text-base leading-none">{icon}</span>
                    <span className="text-xs font-medium text-[var(--twilio-navy)] flex-1">{label}</span>
                    {connected ? (
                      <button
                        onClick={() => exportIntegration(provider)}
                        disabled
                        title="Not available yet — no server endpoint"
                        className="px-3 py-1 rounded-lg text-xs font-semibold bg-[var(--twilio-blue)] text-white hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed transition-opacity"
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
