import React, { useState, useEffect, useRef, useCallback } from "react";
import { accountsApi, airtableApi, searchApi } from "../../lib/api";
import type { SearchResult } from "../../lib/api";
import type { AccountArtifact, ActionItemAttachment, GoalSection } from "../../types";
import { resolveEmojiShortcodes } from "../../lib/emojiShortcodes";
import { ArtifactIcon, ArtifactIconImg, type ArtifactIconEntry, ARTIFACT_ICON_CATALOG, getAutoIconKey } from "./ArtifactIcon";
import { ArtifactViewer } from "./ArtifactViewer";

function _stripMentions(text: string) {
  return text.replace(/@\S+/g, "").replace(/\s{2,}/g, " ").trim();
}

export function formatBytes(b: number): string {
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`;
  return `${(b / (1024 * 1024)).toFixed(1)} MB`;
}

type ArtifactView = "all" | "integration" | "project" | "category";
type ViewGroup = { label: string; artifacts: AccountArtifact[]; subGroups?: Array<{ label: string; artifacts: AccountArtifact[] }> };
type ContextMenuTarget = { artifact: AccountArtifact; x: number; y: number };

const GOOGLE_SUBGROUP_LABELS: Record<string, string> = {
  google_docs: "Docs",
  google_sheets: "Sheets",
  google_slides: "Slides",
  google_forms: "Forms",
  google_drive: "Drive",
  google_calendar: "Calendar",
  gmail: "Gmail",
  notebooklm: "NotebookLM",
  google_sites: "Sites",
  gemini: "Gemini",
};

function resolvedIconKey(a: AccountArtifact): string {
  const stored = a.icon_key ?? "";
  return stored && stored !== "link" ? stored : getAutoIconKey(a.url ?? "");
}

function getIntegrationGroup(a: AccountArtifact): string {
  if (a.artifact_type === "file") return "Files";
  const k = resolvedIconKey(a);
  if (k in GOOGLE_SUBGROUP_LABELS) return "Google";
  if (k === "airtable") return "Airtable";
  if (k === "confluence") return "Confluence";
  if (k === "figma") return "Figma";
  if (k === "gemini") return "Google";
  if (k === "github") return "GitHub";
  if (k === "gong") return "Gong";
  if (k === "jira") return "Jira";
  if (k === "loom") return "Loom";
  if (k === "lucidchart") return "Lucidchart";
  if (k === "microsoft_teams") return "Microsoft Teams";
  if (k === "notion") return "Notion";
  if (k === "salesforce") return "Salesforce";
  if (k === "segment") return "Segment";
  if (k === "slack") return "Slack";
  if (k === "twilio") return "Twilio";
  if (k === "zoom") return "Zoom";
  return "Other Links";
}

const CAT_LS_KEY = (accountId: number) => `artifact-categories::${accountId}`;

function loadCats(accountId: number): Record<number, string> {
  try {
    const raw = localStorage.getItem(CAT_LS_KEY(accountId));
    return raw ? (JSON.parse(raw) as Record<number, string>) : {};
  } catch { return {}; }
}

function saveCats(accountId: number, cats: Record<number, string>): void {
  try { localStorage.setItem(CAT_LS_KEY(accountId), JSON.stringify(cats)); } catch {}
}

// ── Context menu ──────────────────────────────────────────────────────────────

function ArtifactContextMenu({
  artifact, x, y, currentCategory,
  onEdit, onDelete, onSetCategory, onCopyLink, onClose,
}: {
  artifact: AccountArtifact;
  x: number;
  y: number;
  currentCategory: string;
  onEdit: () => void;
  onDelete: () => void;
  onSetCategory: (cat: string) => void;
  onCopyLink: () => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [showCatInput, setShowCatInput] = useState(false);
  const [catValue, setCatValue] = useState(currentCategory);

  useEffect(() => {
    function handler(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [onClose]);

  const clampedX = Math.min(x, (typeof window !== "undefined" ? window.innerWidth : 800) - 210);
  const clampedY = Math.min(y, (typeof window !== "undefined" ? window.innerHeight : 600) - 230);

  const menuItemStyle: React.CSSProperties = {
    display: "flex", alignItems: "center", gap: "8px",
    padding: "7px 12px", cursor: "pointer", fontSize: "0.8125rem",
    color: "var(--text-primary, #111)", borderRadius: "4px", userSelect: "none",
    background: "none", border: "none", width: "100%", textAlign: "left",
  };

  return (
    <div
      ref={ref}
      data-testid="artifact-context-menu"
      style={{
        position: "fixed", left: clampedX, top: clampedY, zIndex: 9999,
        background: "var(--surface, #fff)", border: "1px solid var(--border, rgba(0,0,0,0.12))",
        borderRadius: "10px", boxShadow: "0 8px 32px rgba(0,0,0,0.15)", minWidth: "190px",
        padding: "4px",
      }}
    >
      {/* Edit */}
      <button
        style={menuItemStyle}
        onClick={() => { onEdit(); onClose(); }}
        onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = "var(--bg, #f5f5f5)"; }}
        onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = "none"; }}
      >
        <svg viewBox="0 0 16 16" fill="currentColor" style={{ width: 13, height: 13, color: "#6366f1", flexShrink: 0 }}>
          <path d="M11.013 1.427a1.75 1.75 0 012.474 2.474L5.19 12.2a.75.75 0 01-.31.183l-3 1a.75.75 0 01-.928-.928l1-3a.75.75 0 01.183-.31l8.878-8.718zm1.414 1.06a.25.25 0 00-.354 0L3.694 11.26l-.5 1.5 1.5-.5 8.783-8.879a.25.25 0 000-.354l-.95-.94z"/>
        </svg>
        Edit artifact
      </button>

      {/* Category */}
      {!showCatInput ? (
        <button
          style={menuItemStyle}
          onClick={() => setShowCatInput(true)}
          onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = "var(--bg, #f5f5f5)"; }}
          onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = "none"; }}
        >
          <svg viewBox="0 0 16 16" fill="currentColor" style={{ width: 13, height: 13, color: "#f59e0b", flexShrink: 0 }}>
            <path d="M2 2h4.586a1 1 0 01.707.293l5 5a1 1 0 010 1.414l-4.586 4.586a1 1 0 01-1.414 0l-5-5A1 1 0 011 7.586V3a1 1 0 011-1zm3.5 3a1 1 0 100-2 1 1 0 000 2z"/>
          </svg>
          {currentCategory ? `Category: ${currentCategory}` : "Set category…"}
        </button>
      ) : (
        <div style={{ padding: "4px 12px 8px" }}>
          <p style={{ margin: "0 0 4px", fontSize: "0.6875rem", fontWeight: 600, color: "#f59e0b" }}>Category</p>
          <input
            autoFocus
            value={catValue}
            onChange={(e) => setCatValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") { onSetCategory(catValue.trim()); onClose(); }
              if (e.key === "Escape") { setShowCatInput(false); setCatValue(currentCategory); }
            }}
            placeholder="e.g. Finance, Legal…"
            style={{ width: "100%", fontSize: "0.75rem", padding: "5px 8px", borderRadius: "6px", border: "1px solid #a5b4fc", outline: "none", background: "#f5f3ff", boxSizing: "border-box" }}
          />
          <div style={{ display: "flex", gap: "6px", marginTop: "6px" }}>
            <button
              onClick={() => { onSetCategory(catValue.trim()); onClose(); }}
              style={{ flex: 1, fontSize: "0.6875rem", fontWeight: 600, padding: "4px 0", borderRadius: "5px", background: "#6366f1", color: "#fff", border: "none", cursor: "pointer" }}
            >
              Save
            </button>
            <button
              onClick={() => { setShowCatInput(false); setCatValue(currentCategory); }}
              style={{ flex: 1, fontSize: "0.6875rem", padding: "4px 0", borderRadius: "5px", background: "var(--bg, #f5f5f5)", border: "1px solid var(--border, rgba(0,0,0,0.1))", cursor: "pointer", color: "var(--text-secondary, #888)" }}
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Copy link */}
      {(artifact.url || artifact.file_url) && (
        <button
          style={menuItemStyle}
          onClick={() => { onCopyLink(); onClose(); }}
          onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = "var(--bg, #f5f5f5)"; }}
          onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = "none"; }}
        >
          <svg viewBox="0 0 16 16" fill="currentColor" style={{ width: 13, height: 13, color: "#6b7280", flexShrink: 0 }}>
            <path d="M4.715 6.542L3.343 7.914a3 3 0 104.243 4.243l1.828-1.829A3 3 0 008.586 8.4l-.7.7a2 2 0 11-2.83-2.83l1.37-1.37A2 2 0 014.716 6.54zm8.485-2.828a3 3 0 00-4.243 0L7.13 5.542a3 3 0 00.826 4.913l.7-.7a2 2 0 11.83-2.83l1.828-1.828a2 2 0 010 2.828z"/>
          </svg>
          Copy link
        </button>
      )}

      {/* Divider */}
      <div style={{ height: "1px", background: "var(--border, rgba(0,0,0,0.08))", margin: "2px 8px" }} />

      {/* Delete */}
      {!confirmDelete ? (
        <button
          style={{ ...menuItemStyle, color: "#dc2626" }}
          onClick={() => setConfirmDelete(true)}
          onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = "#fef2f2"; }}
          onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = "none"; }}
        >
          <svg viewBox="0 0 16 16" fill="currentColor" style={{ width: 13, height: 13, flexShrink: 0 }}>
            <path d="M5.5 5.5A.5.5 0 016 6v6a.5.5 0 01-1 0V6a.5.5 0 01.5-.5zm2.5 0a.5.5 0 01.5.5v6a.5.5 0 01-1 0V6a.5.5 0 01.5-.5zm3 .5a.5.5 0 00-1 0v6a.5.5 0 001 0V6z"/>
            <path fillRule="evenodd" d="M14.5 3a1 1 0 01-1 1H13v9a2 2 0 01-2 2H5a2 2 0 01-2-2V4h-.5a1 1 0 010-2h4a1 1 0 011-1h2a1 1 0 011 1h4a1 1 0 011 1zM4.118 4L4 4.059V13a1 1 0 001 1h6a1 1 0 001-1V4.059L11.882 4H4.118zM2.5 3a.5.5 0 000 1h11a.5.5 0 000-1h-11z"/>
          </svg>
          Delete artifact
        </button>
      ) : (
        <div style={{ padding: "4px 12px 8px" }}>
          <p style={{ margin: "0 0 6px", fontSize: "0.75rem", color: "#dc2626", fontWeight: 600 }}>Delete this artifact?</p>
          <div style={{ display: "flex", gap: "6px" }}>
            <button
              onClick={() => { onDelete(); onClose(); }}
              style={{ flex: 1, fontSize: "0.6875rem", fontWeight: 600, padding: "4px 0", borderRadius: "5px", background: "#dc2626", color: "#fff", border: "none", cursor: "pointer" }}
            >
              Delete
            </button>
            <button
              onClick={() => setConfirmDelete(false)}
              style={{ flex: 1, fontSize: "0.6875rem", padding: "4px 0", borderRadius: "5px", background: "var(--bg, #f5f5f5)", border: "1px solid var(--border, rgba(0,0,0,0.1))", cursor: "pointer", color: "var(--text-secondary, #888)" }}
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Edit artifact modal ───────────────────────────────────────────────────────

const CODE_EXTS_SET = new Set(["js", "ts", "tsx", "jsx", "mjs", "cjs", "css", "scss", "sass", "less", "html", "htm", "xml", "py", "rb", "go", "java", "c", "cpp", "h", "cs", "php", "rs", "swift", "kt", "json", "yaml", "yml", "toml", "sh", "bash", "zsh", "sql", "graphql", "gql", "vue", "svelte"]);

function iconKeyFromFile(f: File): string {
  const ext = f.name.split(".").pop()?.toLowerCase() ?? "";
  if (f.type.startsWith("image/")) return "file_image";
  if (f.type.includes("spreadsheet") || ext === "xlsx" || ext === "csv") return "file_sheet";
  if (CODE_EXTS_SET.has(ext)) return "file_code";
  return "file_upload";
}

function EditArtifactModal({
  artifact, accountId, currentCategory, existingCategories, onClose, onSaved,
}: {
  artifact: AccountArtifact;
  accountId: number;
  currentCategory: string;
  existingCategories: string[];
  onClose: () => void;
  onSaved: (updated: AccountArtifact, category: string, replacedId?: number) => void;
}) {
  const [name, setName] = useState(artifact.name);
  const [url, setUrl] = useState(artifact.url ?? "");
  const [secondaryUrl, setSecondaryUrl] = useState(artifact.secondary_url ?? "");
  const [iconKey, setIconKey] = useState(artifact.icon_key ?? "link");
  const [category, setCategory] = useState(currentCategory);
  const [showCatDropdown, setShowCatDropdown] = useState(false);
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const catInputRef = useRef<HTMLInputElement>(null);
  const catDropdownRef = useRef<HTMLDivElement>(null);

  const isFile = artifact.artifact_type === "file";
  const isLucidchart = iconKey === "lucidchart";
  const linkIcons = ARTIFACT_ICON_CATALOG.filter((e) => !e.key.startsWith("file_"));
  const fileIcons = ARTIFACT_ICON_CATALOG.filter((e) => e.key.startsWith("file_"));

  useEffect(() => {
    if (!showCatDropdown) return;
    function handler(e: MouseEvent) {
      if (
        catInputRef.current && !catInputRef.current.contains(e.target as Node) &&
        catDropdownRef.current && !catDropdownRef.current.contains(e.target as Node)
      ) setShowCatDropdown(false);
    }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [showCatDropdown]);

  function handleUrlChange(val: string) {
    setUrl(val);
    if (val.trim()) setIconKey(getAutoIconKey(val.trim()));
    else setIconKey("link");
  }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    setPendingFile(f);
    setIconKey(iconKeyFromFile(f));
    if (name === artifact.name) setName(f.name);
  }

  async function handleSave() {
    setSaving(true);
    setError(null);
    try {
      if (isFile && pendingFile) {
        const { data: uploaded } = await accountsApi.uploadArtifactFile(accountId, pendingFile);
        const { data: patched } = await accountsApi.updateArtifact(uploaded.id, {
          name: name.trim() || pendingFile.name,
          icon_key: iconKey,
        });
        await accountsApi.deleteArtifact(artifact.id);
        onSaved(patched, category.trim(), artifact.id);
      } else {
        const patch: Record<string, string | null | undefined> = {
          name: name.trim() || artifact.name,
          icon_key: iconKey,
        };
        if (!isFile) {
          patch.url = url.trim() || null;
          patch.secondary_url = secondaryUrl.trim() || "";
        }
        const { data } = await accountsApi.updateArtifact(artifact.id, patch);
        onSaved(data, category.trim());
      }
    } catch {
      setError("Failed to save — please try again.");
      setSaving(false);
    }
  }

  const inputStyle: React.CSSProperties = { width: "100%", padding: "9px 12px", borderRadius: "8px", border: "1px solid var(--border, rgba(0,0,0,0.12))", fontSize: "0.8125rem", outline: "none", background: "var(--surface, #fff)", color: "var(--text-primary, #111)", boxSizing: "border-box" };
  const labelStyle: React.CSSProperties = { display: "block", fontSize: "0.6875rem", fontWeight: 600, color: "var(--text-secondary, #888)", marginBottom: "4px" };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={onClose}>
      <div
        style={{ background: "var(--surface, #fff)", borderRadius: "12px", padding: "24px", width: "100%", maxWidth: "440px", boxShadow: "0 8px 32px rgba(0,0,0,0.15)", fontFamily: "var(--font-base)" }}
        onClick={(e) => e.stopPropagation()}
      >
        <h3 style={{ margin: "0 0 16px", fontSize: "1rem", fontWeight: 700, color: "var(--text-primary, #111)" }}>Edit artifact</h3>

        {/* File replace button */}
        {isFile && (
          <>
            <button
              className="card-btn"
              onClick={() => fileInputRef.current?.click()}
              style={{ width: "100%", padding: "12px 16px", borderRadius: "8px", border: "1.5px dashed var(--border, rgba(0,0,0,0.15))", background: "var(--bg, #f5f5f5)", color: "var(--text-secondary, #888)", fontSize: "0.8125rem", cursor: "pointer", marginBottom: "16px", display: "flex", alignItems: "center", justifyContent: "center", gap: "8px" }}
            >
              <span>📎</span>
              {pendingFile ? pendingFile.name : "Replace file…"}
            </button>
            <input ref={fileInputRef} type="file" style={{ display: "none" }} onChange={handleFileChange} />
          </>
        )}

        <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
          {/* URL — link artifacts only */}
          {!isFile && (
            <>
              <div>
                <label style={labelStyle}>{isLucidchart ? "Edit link" : "URL"}</label>
                <input
                  type="text"
                  value={url}
                  onChange={(e) => handleUrlChange(e.target.value)}
                  autoFocus
                  style={inputStyle}
                  onKeyDown={(e) => { if (e.key === "Enter") void handleSave(); }}
                />
              </div>
              {isLucidchart && (
                <div>
                  <label style={labelStyle}>Published link <span style={{ fontWeight: 400 }}>(optional)</span></label>
                  <input
                    type="text"
                    value={secondaryUrl}
                    onChange={(e) => setSecondaryUrl(e.target.value)}
                    style={inputStyle}
                  />
                </div>
              )}
            </>
          )}

          {/* Display name */}
          <div>
            <label style={labelStyle}>Display name</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(resolveEmojiShortcodes(e.target.value))}
              autoFocus={isFile}
              style={inputStyle}
              onKeyDown={(e) => { if (e.key === "Enter") void handleSave(); }}
            />
          </div>

          {/* Category */}
          <div style={{ position: "relative" }}>
            <label style={labelStyle}>Category <span style={{ fontWeight: 400 }}>(optional)</span></label>
            <input
              ref={catInputRef}
              type="text"
              placeholder="e.g. Finance, Legal…"
              value={category}
              onChange={(e) => { setCategory(e.target.value); setShowCatDropdown(true); }}
              onFocus={() => setShowCatDropdown(true)}
              onKeyDown={(e) => {
                if (e.key === "Escape") setShowCatDropdown(false);
                if (e.key === "Enter") { e.preventDefault(); setShowCatDropdown(false); }
              }}
              style={inputStyle}
            />
            {showCatDropdown && (() => {
              const q = category.trim().toLowerCase();
              const filtered = existingCategories.filter((c) => !q || c.toLowerCase().includes(q));
              if (filtered.length === 0) return null;
              return (
                <div
                  ref={catDropdownRef}
                  style={{ position: "absolute", top: "calc(100% + 4px)", left: 0, right: 0, background: "var(--surface, #fff)", border: "1px solid var(--border, rgba(0,0,0,0.12))", borderRadius: "8px", boxShadow: "0 4px 16px rgba(0,0,0,0.12)", zIndex: 20, maxHeight: "160px", overflowY: "auto" }}
                >
                  {filtered.map((cat) => (
                    <button
                      key={cat}
                      className="card-btn"
                      onMouseDown={(e) => { e.preventDefault(); setCategory(cat); setShowCatDropdown(false); }}
                      style={{ width: "100%", textAlign: "left", padding: "8px 12px", border: "none", background: "transparent", cursor: "pointer", fontSize: "0.8125rem", color: "var(--text-primary, #111)" }}
                      onMouseEnter={(e) => (e.currentTarget.style.background = "var(--bg, #f5f5f5)")}
                      onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
                    >
                      {cat}
                    </button>
                  ))}
                </div>
              );
            })()}
          </div>
        </div>

        {/* Icon picker */}
        <div style={{ marginTop: "14px" }}>
          <p style={{ margin: "0 0 8px", fontSize: "0.75rem", fontWeight: 600, color: "var(--text-secondary, #888)" }}>Icon</p>
          <div style={{ display: "flex", flexWrap: "wrap", gap: "6px" }}>
            {(isFile ? fileIcons : linkIcons).map((entry: ArtifactIconEntry) => {
              const selected = iconKey === entry.key;
              return (
                <button
                  key={entry.key}
                  title={entry.label}
                  onClick={() => setIconKey(entry.key)}
                  className="card-btn"
                  style={{
                    display: "flex", alignItems: "center", gap: "5px",
                    padding: "5px 8px", borderRadius: "7px", cursor: "pointer",
                    border: selected ? "2px solid var(--twilio-red, #e22)" : "1px solid var(--border, rgba(0,0,0,0.12))",
                    background: selected ? "rgba(226,34,34,0.06)" : "var(--bg, #f5f5f5)",
                    fontSize: "0.6875rem", fontWeight: selected ? 600 : 400,
                    color: "var(--text-primary, #111)", outline: "none",
                  }}
                >
                  <ArtifactIconImg entry={entry} size={14} />
                  <span>{entry.label}</span>
                </button>
              );
            })}
          </div>
        </div>

        {error && (
          <p style={{ margin: "12px 0 0", fontSize: "0.75rem", color: "#dc2626" }}>{error}</p>
        )}
        <div style={{ display: "flex", justifyContent: "flex-end", gap: "8px", marginTop: "18px" }}>
          <button className="card-btn" onClick={onClose} style={{ padding: "8px 16px", borderRadius: "8px", border: "1px solid var(--border, rgba(0,0,0,0.12))", background: "var(--surface, #fff)", fontSize: "0.8125rem", cursor: "pointer", color: "var(--text-secondary, #888)" }}>
            Cancel
          </button>
          <button
            className="card-btn"
            onClick={() => void handleSave()}
            disabled={saving}
            style={{ padding: "8px 16px", borderRadius: "8px", border: "none", background: "var(--twilio-red, #e22)", color: "#fff", fontSize: "0.8125rem", fontWeight: 600, cursor: "pointer", opacity: saving ? 0.5 : 1 }}
          >
            {saving ? "Saving…" : "Save changes"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Project mini drop zones ───────────────────────────────────────────────────

function ProjectDropZones({
  goals,
  artifacts,
  onGoalsChange,
}: {
  goals: GoalSection[];
  artifacts: AccountArtifact[];
  onGoalsChange: (g: GoalSection[]) => void;
}) {
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  if (goals.length === 0) return null;

  return (
    <div style={{ marginBottom: "12px" }}>
      <p className="text-xs font-semibold text-[var(--twilio-gray-60)] uppercase tracking-wide" style={{ margin: "0 0 8px" }}>
        Projects <span style={{ fontWeight: 400, textTransform: "none", letterSpacing: 0, color: "var(--twilio-gray-40, #9ca3af)" }}>— drag artifacts to assign</span>
      </p>
      <div style={{ display: "flex", gap: "8px", overflowX: "auto", paddingBottom: "2px" }}>
        {goals.map((goal) => {
          const assigned = goal.resources.filter((r) => r.id.startsWith("artifact-"));
          const isDrop = dropTarget === goal.id;
          return (
            <div
              key={goal.id}
              onDragOver={(e) => { e.preventDefault(); setDropTarget(goal.id); }}
              onDragLeave={(e) => {
                if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDropTarget(null);
              }}
              onDrop={(e) => {
                e.preventDefault();
                e.stopPropagation();
                setDropTarget(null);
                const artifactData = e.dataTransfer.getData("artifactDrop");
                if (!artifactData) return;
                const unassignRaw = e.dataTransfer.getData("artifactUnassignFrom");
                let next = goals;
                if (unassignRaw) {
                  try {
                    const { goalId: srcId, resourceId: srcResId } = JSON.parse(unassignRaw) as { goalId: string; resourceId: string };
                    if (srcId !== goal.id) {
                      next = next.map((g) => g.id === srcId ? { ...g, resources: g.resources.filter((r) => r.id !== srcResId) } : g);
                    }
                  } catch { /* ignore */ }
                }
                try {
                  const art = JSON.parse(artifactData) as { id: number; name: string; url: string; iconKey?: string };
                  const resourceId = `artifact-${art.id}`;
                  next = next.map((g) => {
                    if (g.id !== goal.id) return g;
                    if (g.resources.some((r) => r.id === resourceId)) return g;
                    return { ...g, resources: [...g.resources, { id: resourceId, label: art.name, url: art.url || "", iconKey: art.iconKey || getAutoIconKey(art.url || "") }] };
                  });
                } catch { /* ignore */ }
                onGoalsChange(next);
              }}
              style={{
                flexShrink: 0,
                width: 168,
                padding: "8px 10px",
                borderRadius: "8px",
                border: isDrop ? "1.5px dashed var(--twilio-red, #e22)" : "1px solid rgba(34,197,94,0.25)",
                background: isDrop ? "rgba(34,197,94,0.08)" : "#f0fdf4",
                transition: "border-color 0.12s, background 0.12s",
              }}
            >
              <p style={{ margin: "0 0 5px", fontSize: "0.6875rem", fontWeight: 700, color: "#121C2D", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {goal.name}
              </p>
              {assigned.length > 0 ? (
                <div style={{ display: "flex", flexDirection: "column", gap: "3px" }}>
                  {assigned.map((r) => {
                    const artifactId = parseInt(r.id.replace("artifact-", ""), 10);
                    const art = artifacts.find((a) => a.id === artifactId);
                    return (
                      <div
                        key={r.id}
                        draggable
                        onDragStart={(e) => {
                          if (art) {
                            e.dataTransfer.setData("artifactDrop", JSON.stringify({ id: art.id, name: art.name, url: art.url ?? art.file_url ?? "", iconKey: art.icon_key ?? "" }));
                            e.dataTransfer.setData("artifactUnassignFrom", JSON.stringify({ goalId: goal.id, resourceId: r.id }));
                          }
                        }}
                        style={{
                          display: "flex", alignItems: "center", gap: "4px",
                          padding: "2px 5px 2px 4px", borderRadius: "4px",
                          background: "var(--surface, #fff)", border: "1px solid var(--border, rgba(0,0,0,0.08))",
                          fontSize: "0.625rem", color: "var(--text-primary, #111)",
                          cursor: "grab", userSelect: "none",
                        }}
                      >
                        {art?.mime_type.toLowerCase().startsWith("image/") && (art.file_url ?? art.url) ? (
                          <img src={art.file_url ?? art.url ?? ""} alt={art.name} style={{ width: 12, height: 12, objectFit: "cover", borderRadius: 2, flexShrink: 0 }} />
                        ) : (
                          <ArtifactIcon artifactType={art?.artifact_type ?? "link"} mime={art?.mime_type ?? ""} name={r.label} url={r.url} iconKey={r.iconKey} size={12} />
                        )}
                        <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.label}</span>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            onGoalsChange(goals.map((g) => g.id === goal.id ? { ...g, resources: g.resources.filter((res) => res.id !== r.id) } : g));
                          }}
                          title="Remove from project"
                          style={{ padding: 0, background: "none", border: "none", cursor: "pointer", color: "#9ca3af", lineHeight: 1, flexShrink: 0, fontSize: "0.75rem" }}
                        >×</button>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <p style={{ margin: 0, fontSize: "0.5625rem", color: isDrop ? "var(--twilio-red, #e22)" : "var(--twilio-gray-40, #9ca3af)", fontStyle: "italic", fontWeight: isDrop ? 600 : 400 }}>
                  {isDrop ? "Release to assign" : "Drop artifacts here"}
                </p>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── ArtifactsPanel ────────────────────────────────────────────────────────────

export function ArtifactsPanel({
  accountId,
  airtableAccountId,
  goals = [],
  onGoalsChange,
}: {
  accountId: number;
  airtableAccountId?: number;
  goals?: GoalSection[];
  onGoalsChange?: (g: GoalSection[]) => void;
}) {
  const [artifacts, setArtifacts] = useState<AccountArtifact[]>([]);
  const [actionItemAttachments, setActionItemAttachments] = useState<ActionItemAttachment[]>([]);
  const [showAddModal, setShowAddModal] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [viewer, setViewer] = useState<AccountArtifact | null>(null);
  const [contextMenu, setContextMenu] = useState<ContextMenuTarget | null>(null);
  const [editTarget, setEditTarget] = useState<AccountArtifact | null>(null);
  const [view, setView] = useState<ArtifactView>("all");
  const [categories, setCategories] = useState<Record<number, string>>(() => loadCats(accountId));
  const fileInputRef = useRef<HTMLInputElement>(null);
  const dragCounterRef = useRef(0);

  const load = useCallback(() => {
    accountsApi.listArtifacts(accountId)
      .then(({ data }) => setArtifacts(data))
      .catch(() => {});
  }, [accountId]);

  const loadActionItemAttachments = useCallback(() => {
    if (!airtableAccountId) return;
    airtableApi.listActionItems({ account: String(airtableAccountId) })
      .then(({ data }) => {
        const all: ActionItemAttachment[] = [];
        for (const item of data) {
          if (item.attachments?.length) all.push(...item.attachments);
        }
        setActionItemAttachments(all);
      })
      .catch(() => {});
  }, [airtableAccountId]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { loadActionItemAttachments(); }, [loadActionItemAttachments]);
  useEffect(() => {
    const handler = () => load();
    window.addEventListener("artifact-added", handler);
    return () => window.removeEventListener("artifact-added", handler);
  }, [load]);

  async function handleFiles(files: FileList | File[]) {
    const arr = Array.from(files);
    if (!arr.length) return;
    setUploading(true);
    try {
      for (const f of arr) {
        await accountsApi.uploadArtifactFile(accountId, f);
      }
      load();
    } finally {
      setUploading(false);
    }
  }

  async function handleDelete(id: number) {
    await accountsApi.deleteArtifact(id);
    setArtifacts((prev) => prev.filter((a) => a.id !== id));
    if (viewer?.id === id) setViewer(null);
  }

  function setArtifactCategory(id: number, cat: string) {
    setCategories((prev) => {
      const next = { ...prev };
      if (cat) next[id] = cat;
      else delete next[id];
      saveCats(accountId, next);
      return next;
    });
  }

  function handleArtifactClick(artifact: AccountArtifact, e: React.MouseEvent) {
    const href = artifact.file_url ?? artifact.url ?? "";
    if (!href) return;
    if (e.metaKey || e.ctrlKey) {
      window.open(href, "_blank", "noopener,noreferrer");
    } else {
      setViewer(artifact);
    }
  }

  const isPreviewable = (a: AccountArtifact) => {
    const mime = a.mime_type.toLowerCase();
    const url = a.file_url ?? a.url ?? "";
    return mime.startsWith("image/") || mime === "application/pdf" || /docs\.google\.com/i.test(url);
  };

  // ── Grouping logic ────────────────────────────────────────────────────────

  const viewGroups: ViewGroup[] | null = (() => {
    if (view === "integration") {
      const topMap = new Map<string, AccountArtifact[]>();
      const googleSubMap = new Map<string, AccountArtifact[]>();
      for (const a of artifacts) {
        const top = getIntegrationGroup(a);
        if (!topMap.has(top)) topMap.set(top, []);
        topMap.get(top)!.push(a);
        if (top === "Google") {
          const sub = GOOGLE_SUBGROUP_LABELS[resolvedIconKey(a)] ?? "Other";
          if (!googleSubMap.has(sub)) googleSubMap.set(sub, []);
          googleSubMap.get(sub)!.push(a);
        }
      }
      const groups: ViewGroup[] = Array.from(topMap.entries()).map(([label, arts]) => {
        if (label === "Google") {
          const subGroups = Array.from(googleSubMap.entries())
            .map(([subLabel, subArts]) => ({ label: subLabel, artifacts: subArts }))
            .sort((x, y) => x.label.localeCompare(y.label));
          return { label, artifacts: arts, subGroups };
        }
        return { label, artifacts: arts };
      });
      groups.sort((a, b) => {
        const aBottom = a.label === "Files" || a.label === "Other Links";
        const bBottom = b.label === "Files" || b.label === "Other Links";
        if (aBottom !== bBottom) return aBottom ? 1 : -1;
        if (aBottom && bBottom) return a.label === "Other Links" ? 1 : -1;
        return a.label.localeCompare(b.label);
      });
      return groups;
    }
    if (view === "project") {
      const groups: Array<{ label: string; artifacts: AccountArtifact[] }> = [];
      const linked = new Set<number>();
      for (const g of goals) {
        const gArtifacts = artifacts.filter((a) => g.resources.some((r) => r.id === `artifact-${a.id}`));
        if (gArtifacts.length > 0) {
          groups.push({ label: g.name, artifacts: gArtifacts });
          gArtifacts.forEach((a) => linked.add(a.id));
        }
      }
      const unlinked = artifacts.filter((a) => !linked.has(a.id));
      if (unlinked.length > 0) groups.push({ label: "Unlinked", artifacts: unlinked });
      return groups;
    }
    if (view === "category") {
      const catMap = new Map<string, AccountArtifact[]>();
      for (const a of artifacts) {
        const key = categories[a.id] || "Uncategorized";
        if (!catMap.has(key)) catMap.set(key, []);
        catMap.get(key)!.push(a);
      }
      const keys = Array.from(catMap.keys()).sort((a, b) => {
        if (a === "Uncategorized") return 1;
        if (b === "Uncategorized") return -1;
        return a.localeCompare(b);
      });
      return keys.map((label) => ({ label, artifacts: catMap.get(label)! }));
    }
    return null;
  })();

  // ── Card renderer ─────────────────────────────────────────────────────────

  function renderCard(a: AccountArtifact) {
    return (
      <div
        key={a.id}
        draggable
        onDragStart={(e) => {
          e.dataTransfer.setData(
            "artifactDrop",
            JSON.stringify({ id: a.id, name: a.name, url: a.url ?? a.file_url ?? "", iconKey: a.icon_key ?? "" })
          );
        }}
        style={{
          position: "relative", display: "flex", alignItems: "center", gap: "7px",
          padding: "7px 10px", borderRadius: "8px",
          background: "var(--bg, #f5f5f5)", border: "1px solid var(--border, rgba(0,0,0,0.08))",
          cursor: "pointer", maxWidth: "260px", userSelect: "none",
        }}
        onClick={(e) => handleArtifactClick(a, e)}
        onContextMenu={(e) => {
          e.preventDefault();
          setContextMenu({ artifact: a, x: e.clientX, y: e.clientY });
        }}
        title="Click to preview · Cmd+Click to open · Right-click for options · Drag to a project"
      >
        {a.mime_type.toLowerCase().startsWith("image/") && (a.file_url ?? a.url) ? (
          <img
            src={a.file_url ?? a.url ?? ""}
            alt={a.name}
            style={{ width: 32, height: 32, objectFit: "cover", borderRadius: 4, flexShrink: 0, border: "1px solid rgba(0,0,0,0.08)" }}
          />
        ) : (
          <ArtifactIcon artifactType={a.artifact_type} mime={a.mime_type} name={a.name} url={a.url} iconKey={a.icon_key} />
        )}
        <div style={{ minWidth: 0, flex: 1 }}>
          <p style={{ margin: 0, fontSize: "0.75rem", fontWeight: 600, color: "var(--text-primary, #111)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {resolveEmojiShortcodes(a.name)}
          </p>
          {categories[a.id] && (
            <p style={{ margin: 0, fontSize: "0.5625rem", color: "#f59e0b", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.04em" }}>
              {categories[a.id]}
            </p>
          )}
          {a.file_size != null && (
            <p style={{ margin: 0, fontSize: "0.625rem", color: "var(--text-secondary, #aaa)" }}>{formatBytes(a.file_size)}</p>
          )}
          {a.icon_key === "lucidchart" && (a.url || a.secondary_url) && (
            <div style={{ display: "flex", gap: "6px", marginTop: "3px" }} onClick={(e) => e.stopPropagation()}>
              {a.url && (
                <a href={a.url} target="_blank" rel="noreferrer"
                  style={{ fontSize: "0.625rem", fontWeight: 600, color: "#6366f1", textDecoration: "none", background: "rgba(99,102,241,0.08)", borderRadius: "4px", padding: "1px 5px" }}
                  title="Open edit link">Edit</a>
              )}
              {a.secondary_url && (
                <a href={a.secondary_url} target="_blank" rel="noreferrer"
                  style={{ fontSize: "0.625rem", fontWeight: 600, color: "#0891b2", textDecoration: "none", background: "rgba(8,145,178,0.08)", borderRadius: "4px", padding: "1px 5px" }}
                  title="Open published link">Published</a>
              )}
            </div>
          )}
        </div>
      </div>
    );
  }

  // ── View switcher options ────────────────────────────────────────────────

  const viewOptions: Array<{ key: ArtifactView; label: string }> = [
    { key: "all", label: "All" },
    { key: "integration", label: "By Integration" },
    { key: "project", label: "By Project" },
    { key: "category", label: "By Category" },
  ];

  return (
    <div
      className="rounded-lg px-5 py-4"
      style={{
        position: "relative", background: "var(--surface, #fff)",
        border: dragOver ? "1px solid var(--twilio-red, #e22)" : "1px solid var(--border, rgba(0,0,0,0.08))",
        boxShadow: dragOver ? "0 0 0 3px rgba(226,34,34,0.10)" : "0 1px 4px rgba(0,0,0,0.04)",
        transition: "border-color 0.15s, box-shadow 0.15s",
      }}
      onDragEnter={(e) => {
        e.preventDefault();
        if (!e.dataTransfer.types.includes("artifactdrop")) {
          dragCounterRef.current += 1;
          if (dragCounterRef.current === 1) setDragOver(true);
        }
      }}
      onDragOver={(e) => { e.preventDefault(); }}
      onDragLeave={() => {
        dragCounterRef.current -= 1;
        if (dragCounterRef.current <= 0) { dragCounterRef.current = 0; setDragOver(false); }
      }}
      onDrop={(e) => {
        e.preventDefault();
        dragCounterRef.current = 0;
        setDragOver(false);
        if (e.dataTransfer.getData("artifactDrop")) return;
        const noteText = e.dataTransfer.getData("noteText");
        if (noteText) {
          accountsApi.addArtifactLink(accountId, _stripMentions(noteText).slice(0, 255) || "Note", "")
            .then(() => load())
            .catch(() => {});
          return;
        }
        if (e.dataTransfer.files.length) void handleFiles(e.dataTransfer.files);
      }}
    >
      {/* Drop overlay */}
      {dragOver && (
        <div style={{ position: "absolute", inset: 0, zIndex: 20, borderRadius: "inherit", display: "flex", alignItems: "center", justifyContent: "center", background: "rgba(226,34,34,0.06)", border: "2px dashed var(--twilio-red, #e22)", pointerEvents: "none" }}>
          <p style={{ fontSize: "0.9375rem", fontWeight: 700, color: "var(--twilio-red, #e22)" }}>Drop files to upload</p>
        </div>
      )}

      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "10px" }}>
        <p className="text-xs font-semibold text-[var(--twilio-gray-60)] uppercase tracking-wide" style={{ margin: 0 }}>
          Artifacts {artifacts.length > 0 && <span style={{ fontWeight: 400, textTransform: "none", letterSpacing: 0 }}>({artifacts.length})</span>}
        </p>
        <div style={{ display: "flex", gap: 6 }}>
          <button
            className="card-btn"
            onClick={() => fileInputRef.current?.click()}
            title="Click to pick a file, or drag a file from your computer anywhere onto this section"
            style={{ fontSize: "0.75rem", fontWeight: 600, padding: "4px 10px", borderRadius: "6px", background: "var(--bg, #f5f5f5)", border: "1px solid var(--border, rgba(0,0,0,0.08))", color: "var(--text-secondary, #888)", cursor: "pointer" }}
          >
            + File
          </button>
          <button
            className="card-btn"
            onClick={() => setShowAddModal(true)}
            style={{ fontSize: "0.75rem", fontWeight: 600, padding: "4px 10px", borderRadius: "6px", background: "var(--bg, #f5f5f5)", border: "1px solid var(--border, rgba(0,0,0,0.08))", color: "var(--text-secondary, #888)", cursor: "pointer" }}
          >
            + Link
          </button>
        </div>
      </div>

      {/* View switcher */}
      {artifacts.length > 0 && (
        <div style={{ display: "flex", gap: "4px", marginBottom: "12px" }}>
          {viewOptions.map(({ key, label }) => (
            <button
              key={key}
              onClick={() => setView(key)}
              className="card-btn"
              style={{
                fontSize: "0.6875rem", fontWeight: view === key ? 600 : 400,
                padding: "3px 8px", borderRadius: "5px", cursor: "pointer",
                border: view === key ? "1px solid var(--twilio-red, #e22)" : "1px solid transparent",
                background: view === key ? "rgba(226,34,34,0.06)" : "transparent",
                color: view === key ? "var(--twilio-red, #e22)" : "var(--text-secondary, #888)",
              }}
            >
              {label}
            </button>
          ))}
        </div>
      )}

      {/* Project drop zones — below view switcher, above artifact list */}
      {onGoalsChange && (
        <ProjectDropZones goals={goals} artifacts={artifacts} onGoalsChange={onGoalsChange} />
      )}

      {/* Artifact list */}
      {artifacts.length === 0 ? (
        <button
          className="card-btn"
          onClick={() => fileInputRef.current?.click()}
          style={{ width: "100%", padding: "20px", border: "1.5px dashed var(--border, rgba(0,0,0,0.15))", borderRadius: "8px", background: "transparent", color: "var(--text-secondary, #aaa)", fontSize: "0.8125rem", cursor: "pointer", textAlign: "center" }}
        >
          Drop files here, or click to upload · Supports images, PDFs, docs, spreadsheets, and code files (.js, .ts, .css, …)
        </button>
      ) : viewGroups ? (
        <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
          {viewGroups.map(({ label, artifacts: group, subGroups }) => (
            <div key={label}>
              <p style={{ margin: "0 0 8px", fontSize: "0.6875rem", fontWeight: 700, color: "var(--twilio-gray-60, #6b7280)", textTransform: "uppercase", letterSpacing: "0.05em" }}>
                {label} <span style={{ fontWeight: 400, textTransform: "none", letterSpacing: 0 }}>({group.length})</span>
              </p>
              {subGroups ? (
                <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
                  {subGroups.map(({ label: subLabel, artifacts: subGroup }) => (
                    <div key={subLabel} style={{ paddingLeft: "14px", borderLeft: "2px solid rgba(0,0,0,0.06)" }}>
                      <p style={{ margin: "0 0 6px", fontSize: "0.625rem", fontWeight: 700, color: "var(--twilio-gray-40, #9ca3af)", textTransform: "uppercase", letterSpacing: "0.05em" }}>
                        {subLabel} <span style={{ fontWeight: 400, textTransform: "none", letterSpacing: 0 }}>({subGroup.length})</span>
                      </p>
                      <div style={{ display: "flex", flexWrap: "wrap", gap: "8px" }}>
                        {subGroup.map(renderCard)}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div style={{ display: "flex", flexWrap: "wrap", gap: "8px" }}>
                  {group.map(renderCard)}
                </div>
              )}
            </div>
          ))}
        </div>
      ) : (
        <div style={{ display: "flex", flexWrap: "wrap", gap: "8px" }}>
          {artifacts.map(renderCard)}
        </div>
      )}

      {uploading && (
        <p style={{ marginTop: "8px", fontSize: "0.75rem", color: "var(--twilio-red, #e22)" }}>Uploading…</p>
      )}

      <input
        ref={fileInputRef}
        type="file"
        multiple
        accept=".js,.ts,.tsx,.jsx,.mjs,.css,.scss,.html,.py,.rb,.go,.java,.c,.cpp,.cs,.php,.rs,.json,.yaml,.yml,.sh,.sql,.md,image/*,application/pdf,.doc,.docx,.xls,.xlsx,.csv,.zip"
        style={{ display: "none" }}
        onChange={(e) => { if (e.target.files) void handleFiles(e.target.files); e.target.value = ""; }}
      />

      {showAddModal && (
        <AddArtifactModal
          accountId={accountId}
          existingCategories={[...new Set(Object.values(categories))].filter(Boolean)}
          onClose={() => setShowAddModal(false)}
          onAdded={(a, cat) => {
            setArtifacts((prev) => [a, ...prev]);
            if (cat) setArtifactCategory(a.id, cat);
            setShowAddModal(false);
          }}
          onFileRequest={() => { setShowAddModal(false); setTimeout(() => fileInputRef.current?.click(), 50); }}
        />
      )}

      {viewer && (
        <ArtifactViewer
          artifact={viewer}
          onClose={() => setViewer(null)}
          canPreview={isPreviewable(viewer)}
        />
      )}

      {contextMenu && (
        <ArtifactContextMenu
          artifact={contextMenu.artifact}
          x={contextMenu.x}
          y={contextMenu.y}
          currentCategory={categories[contextMenu.artifact.id] ?? ""}
          onEdit={() => { setEditTarget(contextMenu.artifact); setContextMenu(null); }}
          onDelete={() => void handleDelete(contextMenu.artifact.id)}
          onSetCategory={(cat) => setArtifactCategory(contextMenu.artifact.id, cat)}
          onCopyLink={() => {
            const href = contextMenu.artifact.url ?? contextMenu.artifact.file_url ?? "";
            if (href) navigator.clipboard.writeText(href).catch(() => {});
          }}
          onClose={() => setContextMenu(null)}
        />
      )}

      {editTarget && (
        <EditArtifactModal
          artifact={editTarget}
          accountId={accountId}
          currentCategory={categories[editTarget.id] ?? ""}
          existingCategories={[...new Set(Object.values(categories))].filter(Boolean)}
          onClose={() => setEditTarget(null)}
          onSaved={(updated, cat, replacedId) => {
            setArtifacts((prev) => {
              const base = replacedId !== undefined ? prev.filter((a) => a.id !== replacedId) : prev;
              return base.some((a) => a.id === updated.id)
                ? base.map((a) => a.id === updated.id ? updated : a)
                : [updated, ...base];
            });
            if (replacedId !== undefined) {
              if (viewer?.id === replacedId) setViewer(updated);
              setCategories((prev) => { const n = { ...prev }; delete n[replacedId]; return n; });
            } else {
              if (viewer?.id === updated.id) setViewer(updated);
            }
            if (cat) setArtifactCategory(updated.id, cat);
            setEditTarget(null);
          }}
        />
      )}

      {actionItemAttachments.length > 0 && (
        <div style={{ marginTop: "20px", borderTop: "1px solid var(--border, rgba(0,0,0,0.07))", paddingTop: "14px" }}>
          <p className="text-xs font-semibold text-[var(--twilio-gray-60)] uppercase tracking-wide" style={{ margin: "0 0 10px" }}>
            Artifacts from Action Items <span style={{ fontWeight: 400, textTransform: "none", letterSpacing: 0 }}>({actionItemAttachments.length})</span>
          </p>
          <div style={{ display: "flex", flexWrap: "wrap", gap: "8px" }}>
            {actionItemAttachments.map((a) => {
              const href = a.file_url ?? a.url ?? "";
              return (
                <a
                  key={a.id}
                  href={href || undefined}
                  target="_blank"
                  rel="noopener noreferrer"
                  draggable
                  onDragStart={(e) => {
                    e.dataTransfer.setData(
                      "artifactDrop",
                      JSON.stringify({ id: a.id, name: a.name, url: href, iconKey: a.icon_key ?? "" })
                    );
                  }}
                  style={{ display: "flex", alignItems: "center", gap: "7px", padding: "7px 10px", borderRadius: "8px", background: "var(--bg, #f5f5f5)", border: "1px solid var(--border, rgba(0,0,0,0.08))", maxWidth: "220px", textDecoration: "none", color: "inherit", cursor: href ? "pointer" : "default" }}
                  title="Click to open · Drag to assign to a project"
                >
                  {a.mime_type.toLowerCase().startsWith("image/") && href ? (
                    <img src={href} alt={a.name} style={{ width: 32, height: 32, objectFit: "cover", borderRadius: 4, flexShrink: 0, border: "1px solid rgba(0,0,0,0.08)" }} />
                  ) : (
                    <ArtifactIcon artifactType={a.artifact_type} mime={a.mime_type} name={a.name} url={a.url} iconKey={a.icon_key} />
                  )}
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <p style={{ margin: 0, fontSize: "0.75rem", fontWeight: 600, color: "var(--text-primary, #111)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{resolveEmojiShortcodes(a.name)}</p>
                    {a.file_size != null && (
                      <p style={{ margin: 0, fontSize: "0.625rem", color: "var(--text-secondary, #aaa)" }}>{formatBytes(a.file_size)}</p>
                    )}
                  </div>
                </a>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

// ── AddArtifactModal ──────────────────────────────────────────────────────────

function AddArtifactModal({
  accountId,
  existingCategories,
  onClose,
  onAdded,
  onFileRequest,
}: {
  accountId: number;
  existingCategories: string[];
  onClose: () => void;
  onAdded: (a: AccountArtifact, category: string) => void;
  onFileRequest: () => void;
}) {
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [secondaryUrl, setSecondaryUrl] = useState("");
  const [iconKey, setIconKey] = useState("link");
  const [category, setCategory] = useState("");
  const [showCatDropdown, setShowCatDropdown] = useState(false);
  const catInputRef = useRef<HTMLInputElement>(null);
  const catDropdownRef = useRef<HTMLDivElement>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [searchQ, setSearchQ] = useState("");
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const searchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
    if (!searchQ.trim()) { setSearchResults([]); return; }
    searchTimerRef.current = setTimeout(async () => {
      setSearchLoading(true);
      try {
        const { data } = await searchApi.search(searchQ.trim());
        setSearchResults(data.results.filter((r) => r.type === "artifact"));
      } catch { setSearchResults([]); }
      finally { setSearchLoading(false); }
    }, 300);
  }, [searchQ]);

  useEffect(() => {
    if (!showCatDropdown) return;
    function handler(e: MouseEvent) {
      if (
        catInputRef.current && !catInputRef.current.contains(e.target as Node) &&
        catDropdownRef.current && !catDropdownRef.current.contains(e.target as Node)
      ) setShowCatDropdown(false);
    }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [showCatDropdown]);

  function applyExistingArtifact(r: SearchResult) {
    const resolvedUrl = r.url && !r.url.startsWith("/") ? r.url : (r.detail ?? "");
    setUrl(resolvedUrl);
    setName(r.title);
    if (resolvedUrl) setIconKey(getAutoIconKey(resolvedUrl));
    setSearchQ("");
    setSearchResults([]);
  }

  const isLucidchart = iconKey === "lucidchart";

  function handleUrlChange(val: string) {
    setUrl(val);
    if (val.trim()) setIconKey(getAutoIconKey(val.trim()));
    else setIconKey("link");
  }

  async function handleSave() {
    if (!url.trim()) return;
    setSaving(true);
    setError(null);
    try {
      const displayName = name.trim() || url.trim();
      const { data } = await accountsApi.addArtifactLink(accountId, displayName, url.trim(), iconKey, secondaryUrl.trim() || undefined);
      onAdded(data, category.trim());
    } catch {
      setError("Failed to add link — please try again.");
      setSaving(false);
    }
  }

  const linkIcons = ARTIFACT_ICON_CATALOG.filter((e) => !e.key.startsWith("file_"));

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={onClose}>
      <div
        style={{ background: "var(--surface, #fff)", borderRadius: "12px", padding: "24px", width: "100%", maxWidth: "440px", boxShadow: "0 8px 32px rgba(0,0,0,0.15)", fontFamily: "var(--font-base)" }}
        onClick={(e) => e.stopPropagation()}
      >
        <h3 style={{ margin: "0 0 16px", fontSize: "1rem", fontWeight: 700, color: "var(--text-primary, #111)" }}>Add artifact</h3>

        <div style={{ position: "relative", marginBottom: "16px" }}>
          <input
            type="text"
            placeholder="Search existing artifacts…"
            value={searchQ}
            onChange={(e) => setSearchQ(e.target.value)}
            style={{ width: "100%", padding: "9px 12px", borderRadius: "8px", border: "1px solid var(--border, rgba(0,0,0,0.12))", fontSize: "0.8125rem", outline: "none", background: "var(--surface, #fff)", color: "var(--text-primary, #111)", boxSizing: "border-box" }}
          />
          {(searchResults.length > 0 || searchLoading) && (
            <div style={{ position: "absolute", top: "calc(100% + 4px)", left: 0, right: 0, background: "var(--surface, #fff)", border: "1px solid var(--border, rgba(0,0,0,0.12))", borderRadius: "8px", boxShadow: "0 4px 16px rgba(0,0,0,0.12)", zIndex: 10, maxHeight: "200px", overflowY: "auto" }}>
              {searchLoading && (
                <p style={{ margin: 0, padding: "10px 12px", fontSize: "0.75rem", color: "var(--text-secondary, #aaa)" }}>Searching…</p>
              )}
              {searchResults.map((r) => (
                <button
                  key={r.id}
                  className="card-btn"
                  onClick={() => applyExistingArtifact(r)}
                  style={{ width: "100%", textAlign: "left", padding: "8px 12px", border: "none", background: "transparent", cursor: "pointer", display: "flex", alignItems: "center", gap: "8px", fontSize: "0.8125rem", color: "var(--text-primary, #111)" }}
                  onMouseEnter={(e) => (e.currentTarget.style.background = "var(--bg, #f5f5f5)")}
                  onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
                >
                  <ArtifactIcon artifactType={r.meta === "file" ? "file" : "link"} mime="" name={r.title} url={r.detail} size={14} />
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <p style={{ margin: 0, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.title}</p>
                    {r.account && <p style={{ margin: 0, fontSize: "0.6875rem", color: "var(--text-secondary, #aaa)" }}>{r.account}</p>}
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "16px" }}>
          <div style={{ flex: 1, height: "1px", background: "var(--border, rgba(0,0,0,0.08))" }} />
          <span style={{ fontSize: "0.75rem", color: "var(--text-secondary, #aaa)" }}>or add new</span>
          <div style={{ flex: 1, height: "1px", background: "var(--border, rgba(0,0,0,0.08))" }} />
        </div>

        <button
          className="card-btn"
          onClick={onFileRequest}
          style={{ width: "100%", padding: "12px 16px", borderRadius: "8px", border: "1.5px dashed var(--border, rgba(0,0,0,0.15))", background: "var(--bg, #f5f5f5)", color: "var(--text-secondary, #888)", fontSize: "0.8125rem", cursor: "pointer", marginBottom: "16px", display: "flex", alignItems: "center", justifyContent: "center", gap: "8px" }}
        >
          <span>📎</span> Upload a file from your computer
        </button>

        <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
          <div>
            <label style={{ display: "block", fontSize: "0.6875rem", fontWeight: 600, color: "var(--text-secondary, #888)", marginBottom: "4px" }}>
              {isLucidchart ? "Edit link" : "URL"}
            </label>
            <input
              type="text"
              placeholder="https://…"
              value={url}
              onChange={(e) => handleUrlChange(e.target.value)}
              onPaste={(e) => {
                const pasted = e.clipboardData.getData("text");
                if (pasted) { e.preventDefault(); handleUrlChange(pasted.trim()); }
              }}
              autoFocus
              style={{ width: "100%", padding: "9px 12px", borderRadius: "8px", border: "1px solid var(--border, rgba(0,0,0,0.12))", fontSize: "0.8125rem", outline: "none", background: "var(--surface, #fff)", color: "var(--text-primary, #111)", boxSizing: "border-box" }}
              onKeyDown={(e) => { if (e.key === "Enter") void handleSave(); }}
            />
          </div>
          {isLucidchart && (
            <div>
              <label style={{ display: "block", fontSize: "0.6875rem", fontWeight: 600, color: "var(--text-secondary, #888)", marginBottom: "4px" }}>
                Published link <span style={{ fontWeight: 400 }}>(optional)</span>
              </label>
              <input
                type="text"
                placeholder="https://lucid.app/documents/published/…"
                value={secondaryUrl}
                onChange={(e) => setSecondaryUrl(e.target.value)}
                style={{ width: "100%", padding: "9px 12px", borderRadius: "8px", border: "1px solid var(--border, rgba(0,0,0,0.12))", fontSize: "0.8125rem", outline: "none", background: "var(--surface, #fff)", color: "var(--text-primary, #111)", boxSizing: "border-box" }}
              />
            </div>
          )}
          <input
            type="text"
            placeholder="Display name (optional)"
            value={name}
            onChange={(e) => setName(resolveEmojiShortcodes(e.target.value))}
            style={{ width: "100%", padding: "9px 12px", borderRadius: "8px", border: "1px solid var(--border, rgba(0,0,0,0.12))", fontSize: "0.8125rem", outline: "none", background: "var(--surface, #fff)", color: "var(--text-primary, #111)", boxSizing: "border-box" }}
          />

          {/* Category field */}
          <div style={{ position: "relative" }}>
            <label style={{ display: "block", fontSize: "0.6875rem", fontWeight: 600, color: "var(--text-secondary, #888)", marginBottom: "4px" }}>
              Category <span style={{ fontWeight: 400 }}>(optional)</span>
            </label>
            <input
              ref={catInputRef}
              type="text"
              placeholder="e.g. Finance, Legal…"
              value={category}
              onChange={(e) => { setCategory(e.target.value); setShowCatDropdown(true); }}
              onFocus={() => setShowCatDropdown(true)}
              onKeyDown={(e) => {
                if (e.key === "Escape") setShowCatDropdown(false);
                if (e.key === "Enter") { e.preventDefault(); setShowCatDropdown(false); }
              }}
              style={{ width: "100%", padding: "9px 12px", borderRadius: "8px", border: "1px solid var(--border, rgba(0,0,0,0.12))", fontSize: "0.8125rem", outline: "none", background: "var(--surface, #fff)", color: "var(--text-primary, #111)", boxSizing: "border-box" }}
            />
            {showCatDropdown && (() => {
              const q = category.trim().toLowerCase();
              const filtered = existingCategories.filter((c) => !q || c.toLowerCase().includes(q));
              if (filtered.length === 0) return null;
              return (
                <div
                  ref={catDropdownRef}
                  style={{ position: "absolute", top: "calc(100% + 4px)", left: 0, right: 0, background: "var(--surface, #fff)", border: "1px solid var(--border, rgba(0,0,0,0.12))", borderRadius: "8px", boxShadow: "0 4px 16px rgba(0,0,0,0.12)", zIndex: 20, maxHeight: "160px", overflowY: "auto" }}
                >
                  {filtered.map((cat) => (
                    <button
                      key={cat}
                      className="card-btn"
                      onMouseDown={(e) => { e.preventDefault(); setCategory(cat); setShowCatDropdown(false); }}
                      style={{ width: "100%", textAlign: "left", padding: "8px 12px", border: "none", background: "transparent", cursor: "pointer", fontSize: "0.8125rem", color: "var(--text-primary, #111)" }}
                      onMouseEnter={(e) => (e.currentTarget.style.background = "var(--bg, #f5f5f5)")}
                      onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
                    >
                      {cat}
                    </button>
                  ))}
                </div>
              );
            })()}
          </div>
        </div>

        <div style={{ marginTop: "14px" }}>
          <p style={{ margin: "0 0 8px", fontSize: "0.75rem", fontWeight: 600, color: "var(--text-secondary, #888)" }}>Icon</p>
          <div style={{ display: "flex", flexWrap: "wrap", gap: "6px" }}>
            {linkIcons.map((entry: ArtifactIconEntry) => {
              const selected = iconKey === entry.key;
              return (
                <button
                  key={entry.key}
                  title={entry.label}
                  onClick={() => setIconKey(entry.key)}
                  className="card-btn"
                  style={{
                    display: "flex", alignItems: "center", gap: "5px",
                    padding: "5px 8px", borderRadius: "7px", cursor: "pointer",
                    border: selected ? "2px solid var(--twilio-red, #e22)" : "1px solid var(--border, rgba(0,0,0,0.12))",
                    background: selected ? "rgba(226,34,34,0.06)" : "var(--bg, #f5f5f5)",
                    fontSize: "0.6875rem", fontWeight: selected ? 600 : 400,
                    color: "var(--text-primary, #111)", outline: "none",
                  }}
                >
                  <ArtifactIconImg entry={entry} size={14} />
                  <span>{entry.label}</span>
                </button>
              );
            })}
          </div>
        </div>

        {error && (
          <p style={{ margin: "12px 0 0", fontSize: "0.75rem", color: "#dc2626" }}>{error}</p>
        )}
        <div style={{ display: "flex", justifyContent: "flex-end", gap: "8px", marginTop: "18px" }}>
          <button className="card-btn" onClick={onClose} style={{ padding: "8px 16px", borderRadius: "8px", border: "1px solid var(--border, rgba(0,0,0,0.12))", background: "var(--surface, #fff)", fontSize: "0.8125rem", cursor: "pointer", color: "var(--text-secondary, #888)" }}>
            Cancel
          </button>
          <button
            className="card-btn"
            onClick={() => void handleSave()}
            disabled={!url.trim() || saving}
            style={{ padding: "8px 16px", borderRadius: "8px", border: "none", background: "var(--twilio-red, #e22)", color: "#fff", fontSize: "0.8125rem", fontWeight: 600, cursor: "pointer", opacity: (!url.trim() || saving) ? 0.5 : 1 }}
          >
            {saving ? "Adding…" : "Add link"}
          </button>
        </div>
      </div>
    </div>
  );
}
