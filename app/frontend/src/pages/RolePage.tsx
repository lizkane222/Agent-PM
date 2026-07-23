import {
  useCallback, useEffect, useRef, useState, type ReactNode,
} from "react";
import { useParams, Navigate, Link, useNavigate } from "react-router-dom";
import {
  DndContext,
  PointerSensor,
  pointerWithin,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import { CSS } from "@dnd-kit/utilities";
import {
  agentSkillsApi, skillsApi, accountsApi, teamApi,
  schedulerApi, commentsApi, layoutsApi,
  userPageNoteApi, workingSessionApi,
} from "../lib/api";
import type {
  AgentSkill, ClaudeSkill, Account, AccountArtifact, TeamMember,
  ActionItem, Reminder, Comment, PageLayout,
  UserPageNote, WorkingSession, ExportItemSnapshot,
} from "../types";
import { ROLE_META, SLUG_TO_ROLE, ROLED_PAGES } from "../lib/titleRoles";
import type { TitleRole } from "../lib/titleRoles";
import { useLogGlow } from "../hooks/useLogGlow";
import { useCurrentUser } from "../context/CurrentUserContext";
import TimeAllocationPanel from "../components/TimeAllocationPanel";

// ─────────────────────────────────────────────────────────────────────────────
// Artifact icon helpers (self-contained copy)
// ─────────────────────────────────────────────────────────────────────────────

interface ArtifactIconEntry { key: string; label: string; faviconDomain?: string; emoji?: string; }

const ARTIFACT_ICON_CATALOG: ArtifactIconEntry[] = [
  { key: "google_docs",     label: "Google Docs",     faviconDomain: "docs.google.com" },
  { key: "google_sheets",   label: "Google Sheets",   faviconDomain: "sheets.google.com" },
  { key: "google_slides",   label: "Google Slides",   faviconDomain: "slides.google.com" },
  { key: "google_drive",    label: "Google Drive",    faviconDomain: "drive.google.com" },
  { key: "slack",           label: "Slack",           faviconDomain: "slack.com" },
  { key: "airtable",        label: "Airtable",        faviconDomain: "airtable.com" },
  { key: "salesforce",      label: "Salesforce",      faviconDomain: "salesforce.com" },
  { key: "github",          label: "GitHub",          faviconDomain: "github.com" },
  { key: "notion",          label: "Notion",          faviconDomain: "notion.so" },
  { key: "confluence",      label: "Confluence",      faviconDomain: "confluence.atlassian.net" },
  { key: "jira",            label: "Jira",            faviconDomain: "jira.atlassian.com" },
  { key: "figma",           label: "Figma",           faviconDomain: "figma.com" },
  { key: "loom",            label: "Loom",            faviconDomain: "loom.com" },
  { key: "lucidchart",      label: "Lucidchart",      faviconDomain: "lucidchart.com" },
  { key: "zoom",            label: "Zoom",            faviconDomain: "zoom.us" },
  { key: "gong",            label: "Gong",            faviconDomain: "gong.io" },
  { key: "notebooklm",      label: "NotebookLM",      faviconDomain: "notebooklm.google.com" },
  { key: "link",            label: "Link",            emoji: "🔗" },
];

const CATALOG_BY_KEY = Object.fromEntries(ARTIFACT_ICON_CATALOG.map(e => [e.key, e]));

function getAutoIconKey(url: string): string {
  try {
    const h = new URL(url).hostname.replace(/^www\./, "");
    const p = new URL(url).pathname;
    if (h === "docs.google.com") {
      if (p.startsWith("/spreadsheets/")) return "google_sheets";
      if (p.startsWith("/presentation/")) return "google_slides";
      return "google_docs";
    }
    if (h === "drive.google.com") return "google_drive";
    if (h.endsWith("slack.com")) return "slack";
    if (h.endsWith("airtable.com")) return "airtable";
    if (h.endsWith("salesforce.com")) return "salesforce";
    if (h.endsWith("github.com")) return "github";
    if (h.endsWith("notion.so")) return "notion";
    if (h.endsWith("atlassian.net") || h.endsWith("atlassian.com")) {
      return p.includes("wiki") || p.includes("confluence") ? "confluence" : "jira";
    }
    if (h.endsWith("figma.com")) return "figma";
    if (h.endsWith("loom.com")) return "loom";
    if (h.endsWith("lucidchart.com")) return "lucidchart";
    if (h.endsWith("zoom.us")) return "zoom";
    if (h.endsWith("gong.io")) return "gong";
  } catch { /* ignore */ }
  return "link";
}

function ArtifactFavicon({ entry, size = 16 }: { entry: ArtifactIconEntry; size?: number }) {
  const [failed, setFailed] = useState(false);
  if (entry.faviconDomain && !failed) {
    return (
      <img
        src={`https://www.google.com/s2/favicons?sz=32&domain=${entry.faviconDomain}`}
        alt={entry.label}
        width={size} height={size}
        style={{ borderRadius: 3, objectFit: "contain", display: "block", flexShrink: 0 }}
        onError={() => setFailed(true)}
      />
    );
  }
  return <span style={{ fontSize: size, lineHeight: 1 }}>{entry.emoji ?? "🔗"}</span>;
}

function ArtifactIconBadge({ artifact, size = 16 }: { artifact: AccountArtifact; size?: number }) {
  const key = artifact.icon_key || getAutoIconKey(artifact.url ?? "");
  const entry = CATALOG_BY_KEY[key] ?? CATALOG_BY_KEY["link"];
  return <ArtifactFavicon entry={entry} size={size} />;
}

// ─────────────────────────────────────────────────────────────────────────────
// New Artifact Modal
// ─────────────────────────────────────────────────────────────────────────────

function NewArtifactModal({
  accounts,
  onClose,
  onAdded,
}: {
  accounts: Account[];
  onClose: () => void;
  onAdded: (a: AccountArtifact) => void;
}) {
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [iconKey, setIconKey] = useState("link");
  const [accountId, setAccountId] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function handleUrlChange(val: string) {
    setUrl(val);
    setIconKey(val.trim() ? getAutoIconKey(val.trim()) : "link");
  }

  async function handleSave() {
    if (!url.trim()) { setError("URL is required."); return; }
    setSaving(true);
    setError(null);
    try {
      const { data } = await accountsApi.createUserArtifact({
        name: name.trim() || url.trim(),
        url: url.trim(),
        icon_key: iconKey,
        account: accountId,
      });
      onAdded(data);
    } catch {
      setError("Failed to save — please try again.");
      setSaving(false);
    }
  }

  const linkIcons = ARTIFACT_ICON_CATALOG.filter(e => !e.key.startsWith("file_"));

  return (
    <div
      style={{ position: "fixed", inset: 0, zIndex: 9999, background: "rgba(0,0,0,0.45)", backdropFilter: "blur(2px)", display: "flex", alignItems: "center", justifyContent: "center" }}
      onClick={onClose}
    >
      <div
        style={{ background: "var(--surface, #fff)", borderRadius: 14, padding: 24, width: "100%", maxWidth: 440, boxShadow: "0 8px 40px rgba(0,0,0,0.18)", fontFamily: "var(--font-base)" }}
        onClick={e => e.stopPropagation()}
      >
        <h3 style={{ margin: "0 0 18px", fontSize: "1rem", fontWeight: 700, color: "var(--text-primary, #111)" }}>
          New artifact
        </h3>

        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {/* URL */}
          <div>
            <label style={{ display: "block", fontSize: "0.6875rem", fontWeight: 600, color: "var(--text-secondary, #888)", marginBottom: 4, textTransform: "uppercase", letterSpacing: "0.04em" }}>URL *</label>
            <input
              type="text"
              autoFocus
              placeholder="https://…"
              value={url}
              onChange={e => handleUrlChange(e.target.value)}
              onPaste={e => { const v = e.clipboardData.getData("text"); if (v) { e.preventDefault(); handleUrlChange(v.trim()); } }}
              onKeyDown={e => { if (e.key === "Enter") void handleSave(); }}
              style={{ width: "100%", boxSizing: "border-box", padding: "9px 12px", borderRadius: 8, border: "1px solid var(--border, rgba(0,0,0,0.15))", fontSize: "0.8125rem", outline: "none", background: "var(--surface, #fff)", color: "var(--text-primary, #111)" }}
            />
          </div>

          {/* Display name */}
          <div>
            <label style={{ display: "block", fontSize: "0.6875rem", fontWeight: 600, color: "var(--text-secondary, #888)", marginBottom: 4, textTransform: "uppercase", letterSpacing: "0.04em" }}>Display name <span style={{ fontWeight: 400 }}>(optional)</span></label>
            <input
              type="text"
              placeholder="My document"
              value={name}
              onChange={e => setName(e.target.value)}
              style={{ width: "100%", boxSizing: "border-box", padding: "9px 12px", borderRadius: 8, border: "1px solid var(--border, rgba(0,0,0,0.15))", fontSize: "0.8125rem", outline: "none", background: "var(--surface, #fff)", color: "var(--text-primary, #111)" }}
            />
          </div>

          {/* Account */}
          <div>
            <label style={{ display: "block", fontSize: "0.6875rem", fontWeight: 600, color: "var(--text-secondary, #888)", marginBottom: 4, textTransform: "uppercase", letterSpacing: "0.04em" }}>Account <span style={{ fontWeight: 400 }}>(optional — can be set later)</span></label>
            <select
              value={accountId ?? ""}
              onChange={e => setAccountId(e.target.value ? Number(e.target.value) : null)}
              style={{ width: "100%", boxSizing: "border-box", padding: "9px 12px", borderRadius: 8, border: "1px solid var(--border, rgba(0,0,0,0.15))", fontSize: "0.8125rem", outline: "none", background: "var(--surface, #fff)", color: accountId ? "var(--text-primary, #111)" : "var(--text-secondary, #aaa)", fontFamily: "var(--font-base)" }}
            >
              <option value="">No account (personal artifact)</option>
              {accounts.map(a => <option key={a.id} value={a.id}>{a.company_name}</option>)}
            </select>
          </div>

          {/* Icon picker */}
          <div>
            <label style={{ display: "block", fontSize: "0.6875rem", fontWeight: 600, color: "var(--text-secondary, #888)", marginBottom: 6, textTransform: "uppercase", letterSpacing: "0.04em" }}>Icon</label>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
              {linkIcons.map(entry => (
                <button
                  key={entry.key}
                  title={entry.label}
                  onClick={() => setIconKey(entry.key)}
                  style={{
                    display: "flex", alignItems: "center", gap: 5,
                    padding: "4px 8px", borderRadius: 7, cursor: "pointer",
                    border: iconKey === entry.key ? "2px solid var(--twilio-red, #e22)" : "1px solid var(--border, rgba(0,0,0,0.12))",
                    background: iconKey === entry.key ? "rgba(226,34,34,0.06)" : "var(--bg, #f5f5f5)",
                    fontSize: "0.6875rem", fontWeight: iconKey === entry.key ? 600 : 400,
                    color: "var(--text-primary, #111)", outline: "none",
                  }}
                >
                  <ArtifactFavicon entry={entry} size={13} />
                  <span>{entry.label}</span>
                </button>
              ))}
            </div>
          </div>
        </div>

        {error && <p style={{ margin: "12px 0 0", fontSize: "0.75rem", color: "#dc2626" }}>{error}</p>}

        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 20 }}>
          <button onClick={onClose} style={{ padding: "8px 16px", borderRadius: 8, border: "1px solid var(--border, rgba(0,0,0,0.12))", background: "var(--surface, #fff)", fontSize: "0.8125rem", cursor: "pointer", color: "var(--text-secondary, #888)", fontFamily: "var(--font-base)" }}>
            Cancel
          </button>
          <button
            onClick={() => void handleSave()}
            disabled={!url.trim() || saving}
            style={{ padding: "8px 16px", borderRadius: 8, border: "none", background: "var(--twilio-red, #e22)", color: "#fff", fontSize: "0.8125rem", fontWeight: 600, cursor: !url.trim() || saving ? "not-allowed" : "pointer", opacity: !url.trim() || saving ? 0.5 : 1, fontFamily: "var(--font-base)" }}
          >
            {saving ? "Saving…" : "Save artifact"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Edit Artifact Modal (right-click)
// ─────────────────────────────────────────────────────────────────────────────

function EditArtifactModal({
  artifact,
  accounts,
  onClose,
  onSaved,
}: {
  artifact: AccountArtifact;
  accounts: Account[];
  onClose: () => void;
  onSaved: (a: AccountArtifact) => void;
}) {
  const [name, setName] = useState(artifact.name);
  const [url, setUrl] = useState(artifact.url ?? "");
  const [iconKey, setIconKey] = useState(artifact.icon_key || getAutoIconKey(artifact.url ?? ""));
  const [accountId, setAccountId] = useState<number | null>(artifact.account ?? null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSave() {
    setSaving(true); setError(null);
    try {
      const { data } = await accountsApi.updateArtifact(artifact.id, {
        name: name.trim() || url.trim(),
        url: url.trim(),
        icon_key: iconKey,
        account: accountId,
      });
      onSaved(data);
    } catch {
      setError("Failed to save — please try again.");
      setSaving(false);
    }
  }

  const linkIcons = ARTIFACT_ICON_CATALOG.filter(e => !e.key.startsWith("file_"));

  return (
    <div
      style={{ position: "fixed", inset: 0, zIndex: 9999, background: "rgba(0,0,0,0.45)", backdropFilter: "blur(2px)", display: "flex", alignItems: "center", justifyContent: "center" }}
      onClick={onClose}
    >
      <div
        style={{ background: "var(--surface, #fff)", borderRadius: 14, padding: 24, width: "100%", maxWidth: 440, boxShadow: "0 8px 40px rgba(0,0,0,0.18)", fontFamily: "var(--font-base)" }}
        onClick={e => e.stopPropagation()}
      >
        <h3 style={{ margin: "0 0 18px", fontSize: "1rem", fontWeight: 700, color: "var(--text-primary, #111)" }}>
          Edit artifact
        </h3>

        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <div>
            <label style={{ display: "block", fontSize: "0.6875rem", fontWeight: 600, color: "var(--text-secondary, #888)", marginBottom: 4, textTransform: "uppercase", letterSpacing: "0.04em" }}>URL</label>
            <input type="text" value={url} onChange={e => { setUrl(e.target.value); if (e.target.value.trim()) setIconKey(getAutoIconKey(e.target.value.trim())); }}
              style={{ width: "100%", boxSizing: "border-box", padding: "9px 12px", borderRadius: 8, border: "1px solid var(--border, rgba(0,0,0,0.15))", fontSize: "0.8125rem", outline: "none", background: "var(--surface, #fff)", color: "var(--text-primary, #111)" }} />
          </div>
          <div>
            <label style={{ display: "block", fontSize: "0.6875rem", fontWeight: 600, color: "var(--text-secondary, #888)", marginBottom: 4, textTransform: "uppercase", letterSpacing: "0.04em" }}>Display name</label>
            <input type="text" value={name} onChange={e => setName(e.target.value)}
              style={{ width: "100%", boxSizing: "border-box", padding: "9px 12px", borderRadius: 8, border: "1px solid var(--border, rgba(0,0,0,0.15))", fontSize: "0.8125rem", outline: "none", background: "var(--surface, #fff)", color: "var(--text-primary, #111)" }} />
          </div>
          <div>
            <label style={{ display: "block", fontSize: "0.6875rem", fontWeight: 600, color: "var(--text-secondary, #888)", marginBottom: 4, textTransform: "uppercase", letterSpacing: "0.04em" }}>Account</label>
            <select value={accountId ?? ""} onChange={e => setAccountId(e.target.value ? Number(e.target.value) : null)}
              style={{ width: "100%", boxSizing: "border-box", padding: "9px 12px", borderRadius: 8, border: "1px solid var(--border, rgba(0,0,0,0.15))", fontSize: "0.8125rem", outline: "none", background: "var(--surface, #fff)", color: accountId ? "var(--text-primary, #111)" : "var(--text-secondary, #aaa)", fontFamily: "var(--font-base)" }}>
              <option value="">No account (personal artifact)</option>
              {accounts.map(a => <option key={a.id} value={a.id}>{a.company_name}</option>)}
            </select>
          </div>
          <div>
            <label style={{ display: "block", fontSize: "0.6875rem", fontWeight: 600, color: "var(--text-secondary, #888)", marginBottom: 6, textTransform: "uppercase", letterSpacing: "0.04em" }}>Icon</label>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
              {linkIcons.map(entry => (
                <button key={entry.key} title={entry.label} onClick={() => setIconKey(entry.key)}
                  style={{ display: "flex", alignItems: "center", gap: 5, padding: "4px 8px", borderRadius: 7, cursor: "pointer", border: iconKey === entry.key ? "2px solid var(--twilio-red, #e22)" : "1px solid var(--border, rgba(0,0,0,0.12))", background: iconKey === entry.key ? "rgba(226,34,34,0.06)" : "var(--bg, #f5f5f5)", fontSize: "0.6875rem", fontWeight: iconKey === entry.key ? 600 : 400, color: "var(--text-primary, #111)", outline: "none" }}>
                  <ArtifactFavicon entry={entry} size={13} />
                  <span>{entry.label}</span>
                </button>
              ))}
            </div>
          </div>
        </div>

        {error && <p style={{ margin: "12px 0 0", fontSize: "0.75rem", color: "#dc2626" }}>{error}</p>}

        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 20 }}>
          <button onClick={onClose} style={{ padding: "8px 16px", borderRadius: 8, border: "1px solid var(--border, rgba(0,0,0,0.12))", background: "var(--surface, #fff)", fontSize: "0.8125rem", cursor: "pointer", color: "var(--text-secondary, #888)", fontFamily: "var(--font-base)" }}>
            Cancel
          </button>
          <button onClick={() => void handleSave()} disabled={saving}
            style={{ padding: "8px 16px", borderRadius: 8, border: "none", background: "var(--twilio-red, #e22)", color: "#fff", fontSize: "0.8125rem", fontWeight: 600, cursor: saving ? "not-allowed" : "pointer", opacity: saving ? 0.5 : 1, fontFamily: "var(--font-base)" }}>
            {saving ? "Saving…" : "Save changes"}
          </button>
        </div>
      </div>
    </div>
  );
}
import { COMPONENT_REGISTRY } from "../components/pagebuilder/registry";
import { MINI_CANVAS_HANDOFF_KEY } from "../components/pagebuilder/useCanvasState";
import type { CanvasNode } from "../components/pagebuilder/types";

// ─────────────────────────────────────────────────────────────────────────────
// Mini-canvas — a self-contained pared-down page builder embedded in the role page
// ─────────────────────────────────────────────────────────────────────────────

interface MiniNode {
  id: string;
  type: string;
  icon: string;
  label: string;
  x: number;
  y: number;
  w: number;
  h: number;
  fields?: Record<string, string>;
  children?: MiniNode[];
}

// ── Mini-canvas field catalog (spans all entity types in the app) ─────────────

interface MiniFieldDef {
  key: string;
  label: string;
  fieldType: "text" | "textarea" | "date" | "select" | "number" | "url";
  options?: string[];
}
interface MiniFieldCategory { category: string; icon: string; fields: MiniFieldDef[]; }

const MINI_FIELD_CATALOG: MiniFieldCategory[] = [
  {
    category: "General", icon: "📝",
    fields: [
      { key: "g_title",       label: "Title",       fieldType: "text" },
      { key: "g_description", label: "Description", fieldType: "textarea" },
      { key: "g_notes",       label: "Notes",       fieldType: "textarea" },
      { key: "g_url",         label: "URL",         fieldType: "url" },
      { key: "g_date",        label: "Date",        fieldType: "date" },
      { key: "g_tags",        label: "Tags",        fieldType: "text" },
      { key: "g_status",      label: "Status",      fieldType: "text" },
      { key: "g_priority",    label: "Priority",    fieldType: "select", options: ["urgent", "high", "normal", "low"] },
    ],
  },
  {
    category: "Action Item", icon: "✅",
    fields: [
      { key: "ai_title",    label: "Title",    fieldType: "text" },
      { key: "ai_notes",    label: "Notes",    fieldType: "textarea" },
      { key: "ai_priority", label: "Priority", fieldType: "select", options: ["urgent", "high", "normal", "low"] },
      { key: "ai_status",   label: "Status",   fieldType: "select", options: ["open", "in_progress", "done", "dismissed"] },
      { key: "ai_due_date", label: "Due Date", fieldType: "date" },
      { key: "ai_assignee", label: "Assignee", fieldType: "text" },
      { key: "ai_account",  label: "Account",  fieldType: "text" },
      { key: "ai_est_time", label: "Est. Time (h)", fieldType: "number" },
    ],
  },
  {
    category: "Meeting", icon: "🗓",
    fields: [
      { key: "m_title",       label: "Title",          fieldType: "text" },
      { key: "m_date",        label: "Date",           fieldType: "date" },
      { key: "m_duration",    label: "Duration (min)", fieldType: "number" },
      { key: "m_location",    label: "Location",       fieldType: "text" },
      { key: "m_description", label: "Description",    fieldType: "textarea" },
      { key: "m_attendees",   label: "Attendees",      fieldType: "text" },
      { key: "m_status",      label: "Status",         fieldType: "select", options: ["confirmed", "tentative", "cancelled"] },
      { key: "m_meet_link",   label: "Meet Link",      fieldType: "url" },
      { key: "m_account",     label: "Account",        fieldType: "text" },
    ],
  },
  {
    category: "Account", icon: "🏢",
    fields: [
      { key: "acct_name",     label: "Company Name", fieldType: "text" },
      { key: "acct_website",  label: "Website",      fieldType: "url" },
      { key: "acct_industry", label: "Industry",     fieldType: "text" },
      { key: "acct_status",   label: "Status",       fieldType: "select", options: ["prospect", "active", "inactive", "churned"] },
      { key: "acct_arr",      label: "ARR ($)",      fieldType: "number" },
      { key: "acct_owner",    label: "Owner",        fieldType: "text" },
    ],
  },
  {
    category: "Task", icon: "📋",
    fields: [
      { key: "t_title",       label: "Title",       fieldType: "text" },
      { key: "t_description", label: "Description", fieldType: "textarea" },
      { key: "t_priority",    label: "Priority",    fieldType: "select", options: ["urgent", "high", "normal", "low"] },
      { key: "t_status",      label: "Status",      fieldType: "select", options: ["backlog", "todo", "in_progress", "review", "done", "archived"] },
      { key: "t_due_date",    label: "Due Date",    fieldType: "date" },
      { key: "t_tags",        label: "Tags",        fieldType: "text" },
      { key: "t_assignee",    label: "Assignee",    fieldType: "text" },
    ],
  },
  {
    category: "Reminder", icon: "🔔",
    fields: [
      { key: "r_title",  label: "Title",  fieldType: "text" },
      { key: "r_body",   label: "Body",   fieldType: "textarea" },
      { key: "r_due_at", label: "Due At", fieldType: "date" },
      { key: "r_status", label: "Status", fieldType: "select", options: ["pending", "sent", "dismissed", "snoozed"] },
    ],
  },
  {
    category: "Calendar Event", icon: "📅",
    fields: [
      { key: "ce_title",       label: "Title",         fieldType: "text" },
      { key: "ce_start",       label: "Start",         fieldType: "date" },
      { key: "ce_end",         label: "End",           fieldType: "date" },
      { key: "ce_location",    label: "Location",      fieldType: "text" },
      { key: "ce_description", label: "Description",   fieldType: "textarea" },
      { key: "ce_attendees",   label: "Attendees",     fieldType: "text" },
      { key: "ce_status",      label: "Status",        fieldType: "select", options: ["confirmed", "tentative", "cancelled"] },
      { key: "ce_meet_link",   label: "Meet Link",     fieldType: "url" },
      { key: "ce_account",     label: "Account",       fieldType: "text" },
    ],
  },
];

const ALL_FIELD_DEFS: MiniFieldDef[] = MINI_FIELD_CATALOG.flatMap(c => c.fields);

let _miniId = 0;
function mkMiniId() { return `mini-${++_miniId}`; }

function miniNodesToCanvasNodes(nodes: MiniNode[]): CanvasNode[] {
  function convert(n: MiniNode): CanvasNode {
    const def = COMPONENT_REGISTRY.find(c => c.type === n.type);
    return {
      id: n.id,
      type: n.type,
      props: {
        ...(def?.defaultProps ?? {}),
        x: n.x,
        y: n.y,
        width: n.w,
        height: n.h,
        ...(n.text ? { text: n.text } : {}),
      },
      children: (n.children ?? []).map(convert),
    };
  }
  return nodes.map(convert);
}

function addChildToMiniTree(nodes: MiniNode[], parentId: string, child: MiniNode): MiniNode[] {
  return nodes.map(n => {
    if (n.id === parentId) return { ...n, children: [...(n.children ?? []), child] };
    return { ...n, children: n.children ? addChildToMiniTree(n.children, parentId, child) : n.children };
  });
}

function updateMiniNodeFields(nodes: MiniNode[], id: string, fields: Record<string, string>): MiniNode[] {
  return nodes.map(n => {
    if (n.id === id) return { ...n, fields };
    return { ...n, children: n.children ? updateMiniNodeFields(n.children, id, fields) : n.children };
  });
}

function findMiniNode(nodes: MiniNode[], id: string): MiniNode | null {
  for (const n of nodes) {
    if (n.id === id) return n;
    const found = n.children ? findMiniNode(n.children, id) : null;
    if (found) return found;
  }
  return null;
}

// ── Component edit modal ──────────────────────────────────────────────────────

function MiniNodeEditModal({
  node,
  onSave,
  onClose,
}: {
  node: MiniNode;
  onSave: (fields: Record<string, string>) => void;
  onClose: () => void;
}) {
  const [fields, setFields] = useState<Record<string, string>>(node.fields ?? {});
  const [activeCategory, setActiveCategory] = useState(MINI_FIELD_CATALOG[0].category);
  const [addedKeys, setAddedKeys] = useState<Set<string>>(() => new Set(Object.keys(node.fields ?? {})));

  const activeFields = MINI_FIELD_CATALOG.find(c => c.category === activeCategory)?.fields ?? [];

  const setField = (key: string, val: string) => {
    setFields(prev => ({ ...prev, [key]: val }));
  };

  const toggleKey = (key: string) => {
    setAddedKeys(prev => {
      const next = new Set(prev);
      if (next.has(key)) { next.delete(key); setFields(f => { const copy = { ...f }; delete copy[key]; return copy; }); }
      else next.add(key);
      return next;
    });
  };

  return (
    <div
      style={{
        position: "fixed", inset: 0, zIndex: 9000,
        background: "rgba(0,0,0,0.4)",
        display: "flex", alignItems: "center", justifyContent: "center",
      }}
      onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div style={{
        background: "var(--surface, #fff)",
        borderRadius: 14,
        width: 600, maxWidth: "95vw", maxHeight: "85vh",
        boxShadow: "0 12px 48px rgba(0,0,0,0.18)",
        display: "flex", flexDirection: "column",
        overflow: "hidden",
        fontFamily: "var(--font-base)",
      }}>
        {/* Header */}
        <div style={{
          display: "flex", alignItems: "center", gap: 10,
          padding: "14px 18px", borderBottom: "1px solid var(--border, rgba(0,0,0,0.08))",
        }}>
          <span style={{ fontSize: "1.25rem" }}>{node.icon}</span>
          <div>
            <p style={{ margin: 0, fontWeight: 700, fontSize: "0.9375rem" }}>{node.label}</p>
            <p style={{ margin: 0, fontSize: "0.75rem", color: "var(--text-secondary, #888)" }}>
              Add fields to this component
            </p>
          </div>
          <button
            onClick={onClose}
            style={{ marginLeft: "auto", background: "none", border: "none", cursor: "pointer", fontSize: "1.1rem", color: "var(--text-secondary, #888)", lineHeight: 1 }}
          >✕</button>
        </div>

        <div style={{ display: "flex", flex: 1, overflow: "hidden" }}>
          {/* Category sidebar */}
          <div style={{
            width: 150, flexShrink: 0,
            borderRight: "1px solid var(--border, rgba(0,0,0,0.08))",
            overflowY: "auto",
            padding: "8px 0",
          }}>
            {MINI_FIELD_CATALOG.map(cat => {
              const addedCount = cat.fields.filter(f => addedKeys.has(f.key)).length;
              return (
                <button
                  key={cat.category}
                  onClick={() => setActiveCategory(cat.category)}
                  style={{
                    width: "100%", display: "flex", alignItems: "center", gap: 7,
                    padding: "7px 14px", border: "none", cursor: "pointer", textAlign: "left",
                    background: activeCategory === cat.category ? "rgba(2,99,224,0.07)" : "transparent",
                    color: activeCategory === cat.category ? "#0263E0" : "var(--text-primary, #111)",
                    fontWeight: activeCategory === cat.category ? 600 : 400,
                    fontSize: "0.8125rem", fontFamily: "var(--font-base)",
                    borderLeft: activeCategory === cat.category ? "3px solid #0263E0" : "3px solid transparent",
                  }}
                >
                  <span>{cat.icon}</span>
                  <span style={{ flex: 1 }}>{cat.category}</span>
                  {addedCount > 0 && (
                    <span style={{
                      fontSize: "0.625rem", fontWeight: 700,
                      background: "#0263E0", color: "#fff",
                      borderRadius: "50%", width: 16, height: 16,
                      display: "flex", alignItems: "center", justifyContent: "center",
                    }}>{addedCount}</span>
                  )}
                </button>
              );
            })}
          </div>

          {/* Field list */}
          <div style={{ flex: 1, overflowY: "auto", padding: 16 }}>
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {activeFields.map(fieldDef => {
                const isAdded = addedKeys.has(fieldDef.key);
                return (
                  <div key={fieldDef.key} style={{
                    border: `1px solid ${isAdded ? "#0263E0" : "var(--border, rgba(0,0,0,0.1))"}`,
                    borderRadius: 8,
                    background: isAdded ? "rgba(2,99,224,0.03)" : "var(--bg, #fafafa)",
                    padding: "10px 12px",
                    transition: "all 0.1s",
                  }}>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: isAdded ? 8 : 0 }}>
                      <span style={{ fontSize: "0.8125rem", fontWeight: 600, color: isAdded ? "#0263E0" : "var(--text-primary, #111)" }}>
                        {fieldDef.label}
                      </span>
                      <button
                        onClick={() => toggleKey(fieldDef.key)}
                        style={{
                          fontSize: "0.6875rem", fontWeight: 600,
                          padding: "3px 10px", borderRadius: 6,
                          border: `1px solid ${isAdded ? "#0263E0" : "var(--border, rgba(0,0,0,0.15))"}`,
                          background: isAdded ? "#0263E0" : "transparent",
                          color: isAdded ? "#fff" : "var(--text-secondary, #666)",
                          cursor: "pointer", fontFamily: "var(--font-base)",
                        }}
                      >
                        {isAdded ? "Remove" : "+ Add"}
                      </button>
                    </div>
                    {isAdded && (
                      fieldDef.fieldType === "textarea" ? (
                        <textarea
                          value={fields[fieldDef.key] ?? ""}
                          onChange={e => setField(fieldDef.key, e.target.value)}
                          placeholder={`Enter ${fieldDef.label.toLowerCase()}…`}
                          rows={3}
                          style={{
                            width: "100%", boxSizing: "border-box",
                            border: "1px solid var(--border, rgba(0,0,0,0.12))",
                            borderRadius: 6, padding: "6px 8px",
                            fontSize: "0.8125rem", fontFamily: "var(--font-base)",
                            resize: "vertical", outline: "none",
                            background: "var(--surface, #fff)",
                          }}
                        />
                      ) : fieldDef.fieldType === "select" ? (
                        <select
                          value={fields[fieldDef.key] ?? ""}
                          onChange={e => setField(fieldDef.key, e.target.value)}
                          style={{
                            width: "100%", boxSizing: "border-box",
                            border: "1px solid var(--border, rgba(0,0,0,0.12))",
                            borderRadius: 6, padding: "6px 8px",
                            fontSize: "0.8125rem", fontFamily: "var(--font-base)",
                            outline: "none", background: "var(--surface, #fff)",
                          }}
                        >
                          <option value="">— select —</option>
                          {(fieldDef.options ?? []).map(o => <option key={o} value={o}>{o}</option>)}
                        </select>
                      ) : (
                        <input
                          type={fieldDef.fieldType === "date" ? "date" : fieldDef.fieldType === "number" ? "number" : fieldDef.fieldType === "url" ? "url" : "text"}
                          value={fields[fieldDef.key] ?? ""}
                          onChange={e => setField(fieldDef.key, e.target.value)}
                          placeholder={`Enter ${fieldDef.label.toLowerCase()}…`}
                          style={{
                            width: "100%", boxSizing: "border-box",
                            border: "1px solid var(--border, rgba(0,0,0,0.12))",
                            borderRadius: 6, padding: "6px 8px",
                            fontSize: "0.8125rem", fontFamily: "var(--font-base)",
                            outline: "none", background: "var(--surface, #fff)",
                          }}
                        />
                      )
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div style={{
          display: "flex", justifyContent: "flex-end", gap: 8,
          padding: "12px 18px", borderTop: "1px solid var(--border, rgba(0,0,0,0.08))",
        }}>
          <button
            onClick={onClose}
            style={{ padding: "8px 18px", borderRadius: 8, border: "1px solid var(--border, rgba(0,0,0,0.12))", background: "transparent", fontSize: "0.8125rem", cursor: "pointer", fontFamily: "var(--font-base)" }}
          >
            Cancel
          </button>
          <button
            onClick={() => { onSave(fields); onClose(); }}
            style={{ padding: "8px 18px", borderRadius: 8, border: "none", background: "#0263E0", color: "#fff", fontSize: "0.8125rem", fontWeight: 600, cursor: "pointer", fontFamily: "var(--font-base)" }}
          >
            Save
          </button>
        </div>
      </div>
    </div>
  );
}

function MiniPaletteItem({ type, label, icon }: { type: string; label: string; icon: string }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `mini-palette:${type}`,
    data: { kind: "mini-palette", type, label, icon },
  });
  return (
    <div
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      title={`Drag ${label} to canvas`}
      style={{
        display: "flex", alignItems: "center", gap: 6,
        padding: "4px 8px", borderRadius: 6,
        fontSize: "0.75rem", fontFamily: "var(--font-base)",
        color: "var(--text-primary, #111)",
        background: isDragging ? "rgba(2,99,224,0.08)" : "transparent",
        cursor: isDragging ? "grabbing" : "grab",
        opacity: isDragging ? 0.5 : 1,
        userSelect: "none",
        transition: "background 0.1s",
        whiteSpace: "nowrap",
      }}
      onMouseEnter={e => { if (!isDragging) (e.currentTarget as HTMLDivElement).style.background = "rgba(0,0,0,0.04)"; }}
      onMouseLeave={e => { (e.currentTarget as HTMLDivElement).style.background = isDragging ? "rgba(2,99,224,0.08)" : "transparent"; }}
    >
      <span style={{ fontSize: "0.875rem", flexShrink: 0 }}>{icon}</span>
      <span>{label}</span>
    </div>
  );
}

function MiniCanvasNode({
  node, selected, onSelect, onDelete, onResize, onOpenEdit, depth,
}: {
  node: MiniNode;
  selected: boolean;
  onSelect: () => void;
  onDelete: () => void;
  onResize: (id: string, w: number, h: number) => void;
  onOpenEdit: (id: string) => void;
  depth?: number;
}) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: `mini-canvas:${node.id}`,
    data: { kind: "mini-canvas", nodeId: node.id },
  });

  const resizeStartRef = useRef<{ mx: number; my: number; w: number; h: number } | null>(null);

  // Must use onPointerDown (not onMouseDown) to intercept before dnd-kit's
  // PointerSensor activates — stopping propagation here prevents the drag
  // from starting, which is what caused the node to move during resize.
  const handleResizePointerDown = (e: React.PointerEvent) => {
    e.stopPropagation();
    e.preventDefault();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    resizeStartRef.current = { mx: e.clientX, my: e.clientY, w: node.w, h: node.h };
    const onMove = (ev: PointerEvent) => {
      if (!resizeStartRef.current) return;
      const newW = Math.max(40, resizeStartRef.current.w + (ev.clientX - resizeStartRef.current.mx));
      const newH = Math.max(24, resizeStartRef.current.h + (ev.clientY - resizeStartRef.current.my));
      onResize(node.id, Math.round(newW), Math.round(newH));
    };
    const onUp = () => {
      resizeStartRef.current = null;
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };

  const filledFields = Object.entries(node.fields ?? {}).filter(([, v]) => v !== "");
  const fieldLabels = filledFields.map(([k]) => ALL_FIELD_DEFS.find(f => f.key === k)?.label ?? k);

  return (
    <div
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      style={{
        position: "absolute",
        left: node.x,
        top: node.y,
        width: node.w,
        height: node.h,
        transform: CSS.Translate.toString(transform),
        zIndex: isDragging ? 50 : selected ? 10 : (1 + (depth ?? 0)),
        opacity: isDragging ? 0.5 : 1,
        cursor: isDragging ? "grabbing" : "default",
      }}
      data-mini-node-id={node.id}
      onClick={e => { e.stopPropagation(); onSelect(); }}
      onDoubleClick={e => { e.stopPropagation(); onOpenEdit(node.id); }}
      onContextMenu={e => { e.preventDefault(); e.stopPropagation(); onOpenEdit(node.id); }}
    >
      <div style={{
        width: "100%", height: "100%",
        borderRadius: 6,
        border: `1.5px solid ${selected ? "#0263E0" : "rgba(0,0,0,0.12)"}`,
        boxShadow: selected ? "0 0 0 2px rgba(2,99,224,0.2)" : "0 1px 4px rgba(0,0,0,0.07)",
        background: "var(--surface, #fff)",
        display: "flex", flexDirection: "column",
        alignItems: "flex-start", justifyContent: "flex-start", gap: 2,
        padding: "5px 6px",
        fontSize: "0.5625rem", color: "var(--text-secondary, #888)",
        overflow: "hidden",
        position: "relative",
        boxSizing: "border-box",
      }}>
        {/* Header row: icon + label */}
        <div style={{ display: "flex", alignItems: "center", gap: 4, width: "100%" }}>
          <span style={{ fontSize: "0.875rem", flexShrink: 0 }}>{node.icon}</span>
          <span style={{ fontWeight: 700, fontSize: "0.6rem", color: "var(--text-primary, #111)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {node.label}
          </span>
        </div>
        {/* Field chips */}
        {fieldLabels.length > 0 && (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 2, marginTop: 2 }}>
            {fieldLabels.slice(0, 6).map(label => (
              <span key={label} style={{
                fontSize: "0.5rem", fontWeight: 500,
                background: "rgba(2,99,224,0.08)", color: "#0263E0",
                borderRadius: 3, padding: "1px 4px",
                whiteSpace: "nowrap",
              }}>{label}</span>
            ))}
            {fieldLabels.length > 6 && (
              <span style={{ fontSize: "0.5rem", color: "var(--text-secondary, #aaa)", padding: "1px 2px" }}>
                +{fieldLabels.length - 6}
              </span>
            )}
          </div>
        )}
        {fieldLabels.length === 0 && (
          <span style={{ fontSize: "0.5rem", color: "var(--text-secondary, #ccc)", fontStyle: "italic" }}>
            dbl-click to add fields
          </span>
        )}
        {/* Nested children */}
        {(node.children ?? []).map(child => (
          <div key={child.id} style={{
            position: "absolute",
            left: child.x - node.x,
            top: child.y - node.y,
            width: child.w,
            height: child.h,
            border: "1px dashed rgba(2,99,224,0.4)",
            borderRadius: 4,
            background: "rgba(2,99,224,0.04)",
            display: "flex", alignItems: "center", justifyContent: "center",
            fontSize: "0.5rem", color: "#0263E0", pointerEvents: "none",
          }}>
            {child.icon} {child.label}
          </div>
        ))}
      </div>

      {/* Delete button */}
      {selected && (
        <button
          onPointerDown={e => e.stopPropagation()}
          onClick={e => { e.stopPropagation(); onDelete(); }}
          style={{
            position: "absolute", top: -7, right: -7,
            width: 16, height: 16, borderRadius: "50%",
            background: "#ef4444", color: "#fff",
            border: "none", cursor: "pointer",
            fontSize: "9px", lineHeight: 1,
            display: "flex", alignItems: "center", justifyContent: "center",
            zIndex: 20,
          }}
        >✕</button>
      )}

      {/* Resize handle — bottom-right corner, pointer events intercept before dnd-kit */}
      {selected && (
        <div
          onPointerDown={handleResizePointerDown}
          style={{
            position: "absolute", right: -4, bottom: -4,
            width: 12, height: 12,
            background: "#0263E0", borderRadius: 3,
            cursor: "nwse-resize",
            zIndex: 25,
            touchAction: "none",
          }}
        />
      )}
    </div>
  );
}

function MiniCanvasDropArea({
  nodes, selectedId, onSelect, onDelete, onResize, onOpenEdit, canvasRef, accentColor,
}: {
  nodes: MiniNode[];
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  onDelete: (id: string) => void;
  onResize: (id: string, w: number, h: number) => void;
  onOpenEdit: (id: string) => void;
  canvasRef: React.RefObject<HTMLDivElement | null>;
  accentColor: string;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: "mini-canvas-drop" });

  const mergedRef = useCallback((el: HTMLDivElement | null) => {
    setNodeRef(el);
    (canvasRef as React.MutableRefObject<HTMLDivElement | null>).current = el;
  }, [setNodeRef, canvasRef]);

  return (
    <div
      ref={mergedRef}
      onClick={() => onSelect(null)}
      style={{
        position: "relative",
        flex: 1,
        minHeight: 200,
        background: isOver ? `${accentColor}06` : "var(--bg, #f9f9f9)",
        backgroundImage: "radial-gradient(circle, #AEBBC1 1px, transparent 1px)",
        backgroundSize: "20px 20px",
        border: `1.5px dashed ${isOver ? accentColor : "var(--border, rgba(0,0,0,0.12))"}`,
        borderRadius: 8,
        overflow: "hidden",
        transition: "all 0.15s",
      }}
    >
      {nodes.length === 0 && !isOver && (
        <div style={{
          position: "absolute", inset: 0,
          display: "flex", flexDirection: "column",
          alignItems: "center", justifyContent: "center",
          pointerEvents: "none",
        }}>
          <p style={{ margin: 0, fontSize: "0.6875rem", color: "var(--text-secondary, #ccc)", fontWeight: 600, letterSpacing: "0.08em", textTransform: "uppercase" }}>
            Drag components here
          </p>
        </div>
      )}
      {nodes.map(n => (
        <MiniCanvasNode
          key={n.id}
          node={n}
          selected={selectedId === n.id}
          onSelect={() => onSelect(n.id)}
          onDelete={() => onDelete(n.id)}
          onResize={onResize}
          onOpenEdit={onOpenEdit}
          depth={0}
        />
      ))}
    </div>
  );
}

function MiniCanvasPanel({ accentColor, textColor }: { accentColor: string; textColor: string }) {
  const [nodes, setNodes] = useState<MiniNode[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editNodeId, setEditNodeId] = useState<string | null>(null);
  const canvasRef = useRef<HTMLDivElement | null>(null);
  const navigate = useNavigate();

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));

  const handleDragEnd = useCallback((e: DragEndEvent) => {
    const { active, over, delta } = e;
    if (!over) return;
    const activeData = active.data.current as Record<string, unknown>;

    if (activeData.kind === "mini-palette") {
      const dropId = over.id as string;
      const canvas = canvasRef.current;
      let x = 60, y = 60;
      if (canvas && e.activatorEvent instanceof PointerEvent) {
        const rect = canvas.getBoundingClientRect();
        x = Math.max(4, Math.round((e.activatorEvent as PointerEvent).clientX + delta.x - rect.left - 40));
        y = Math.max(4, Math.round((e.activatorEvent as PointerEvent).clientY + delta.y - rect.top  - 24));
      }
      const newNode: MiniNode = {
        id: mkMiniId(),
        type: activeData.type as string,
        icon: activeData.icon as string,
        label: activeData.label as string,
        x, y, w: 120, h: 72,
      };
      if (dropId.startsWith("mini-nest:")) {
        setNodes(prev => addChildToMiniTree(prev, dropId.replace("mini-nest:", ""), newNode));
      } else {
        setNodes(prev => [...prev, newNode]);
      }
      setSelectedId(newNode.id);
      return;
    }

    if (activeData.kind === "mini-canvas" && over.id === "mini-canvas-drop") {
      const nodeId = activeData.nodeId as string;
      setNodes(prev => prev.map(n =>
        n.id === nodeId
          ? { ...n, x: Math.max(0, n.x + Math.round(delta.x)), y: Math.max(0, n.y + Math.round(delta.y)) }
          : n
      ));
    }
  }, []);

  const handleResize = useCallback((id: string, w: number, h: number) => {
    setNodes(prev => prev.map(n =>
      n.id === id ? { ...n, w: Math.max(40, Math.round(w)), h: Math.max(24, Math.round(h)) } : n
    ));
  }, []);

  const handleOpenFullBuilder = useCallback(() => {
    if (nodes.length > 0) {
      sessionStorage.setItem(MINI_CANVAS_HANDOFF_KEY, JSON.stringify(miniNodesToCanvasNodes(nodes)));
    }
    navigate("/edit-preview");
  }, [nodes, navigate]);

  const editNode = editNodeId ? findMiniNode(nodes, editNodeId) : null;

  const PALETTE_ITEMS = COMPONENT_REGISTRY.filter(c =>
    c.category === "Layout" || c.category === "Content"
  ).slice(0, 20);

  return (
    <>
      <DndContext sensors={sensors} collisionDetection={pointerWithin} onDragEnd={handleDragEnd}>
        <div style={{
          display: "flex",
          border: "1px solid var(--border, rgba(0,0,0,0.08))",
          borderRadius: 12,
          overflow: "hidden",
          background: "var(--surface, #fff)",
          marginBottom: 28,
        }}>
          {/* Left palette */}
          <div style={{
            width: 140, flexShrink: 0,
            borderRight: "1px solid var(--border, rgba(0,0,0,0.08))",
            overflowY: "auto", background: "var(--surface, #fff)",
          }}>
            <div style={{ padding: "8px 8px 4px" }}>
              <p style={{
                margin: "0 0 6px 8px", fontSize: "0.625rem", fontWeight: 700,
                letterSpacing: "0.08em", textTransform: "uppercase", color: textColor,
              }}>Components</p>
              {PALETTE_ITEMS.map(c => (
                <MiniPaletteItem key={c.type} type={c.type} label={c.label} icon={c.icon} />
              ))}
            </div>
          </div>

          {/* Canvas area */}
          <div style={{ flex: 1, padding: 10, display: "flex", flexDirection: "column" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
              <span style={{ fontSize: "0.625rem", fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: textColor }}>
                Canvas
              </span>
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                {nodes.length > 0 && (
                  <button
                    onClick={() => { setNodes([]); setSelectedId(null); }}
                    style={{ fontSize: "0.6875rem", color: "#ef4444", background: "none", border: "none", cursor: "pointer" }}
                  >Clear</button>
                )}
                <button
                  onClick={handleOpenFullBuilder}
                  style={{ fontSize: "0.6875rem", color: accentColor, background: "none", border: "none", cursor: "pointer", fontWeight: 600, padding: 0 }}
                >Open full builder →</button>
              </div>
            </div>
            <MiniCanvasDropArea
              nodes={nodes}
              selectedId={selectedId}
              onSelect={setSelectedId}
              onDelete={id => { setNodes(p => p.filter(n => n.id !== id)); setSelectedId(null); }}
              onResize={handleResize}
              onOpenEdit={id => { setSelectedId(id); setEditNodeId(id); }}
              canvasRef={canvasRef}
              accentColor={accentColor}
            />
          </div>
        </div>
      </DndContext>

      {editNode && (
        <MiniNodeEditModal
          node={editNode}
          onSave={fields => setNodes(prev => updateMiniNodeFields(prev, editNode.id, fields))}
          onClose={() => setEditNodeId(null)}
        />
      )}
    </>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Working Session canvas — card-based free-position drop area
// ─────────────────────────────────────────────────────────────────────────────

type AnnotatedRef = ExportItemSnapshot & { _note?: string; _x?: number; _y?: number };

const TYPE_COLORS: Record<string, string> = {
  action_item: "#f97316", account: "#3b82f6", meeting: "#8b5cf6",
  artifact: "#06b6d4", reminder: "#f59e0b", calendar_event: "#10b981",
};

function SessionRecordCard({
  item, selected, onSelect, onRemove, onNoteChange,
}: {
  item: AnnotatedRef;
  selected: boolean;
  onSelect: () => void;
  onRemove: () => void;
  onNoteChange: (note: string) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: `sess-card:${item.id}`,
    data: { kind: "sess-card", refId: item.id },
  });
  const [note, setNote] = useState(item._note ?? "");
  const color = TYPE_COLORS[item.type] ?? (item.accent ?? "#9ca3af");
  const x = item._x ?? 0;
  const y = item._y ?? 0;

  return (
    <div
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      style={{
        position: "absolute",
        left: x,
        top: y,
        width: 220,
        transform: CSS.Translate.toString(transform),
        zIndex: isDragging ? 50 : selected ? 10 : 1,
        opacity: isDragging ? 0.5 : 1,
        cursor: isDragging ? "grabbing" : "default",
      }}
      onClick={e => { e.stopPropagation(); onSelect(); }}
    >
      <div style={{
        background: "var(--surface, #fff)",
        border: `1.5px solid ${selected ? color : "var(--border, rgba(0,0,0,0.1))"}`,
        borderLeft: `4px solid ${color}`,
        borderRadius: 8,
        padding: "8px 10px",
        boxShadow: selected
          ? `0 0 0 3px ${color}22, 0 2px 8px rgba(0,0,0,0.1)`
          : "0 1px 4px rgba(0,0,0,0.07)",
      }}>
        <div style={{ display: "flex", alignItems: "flex-start", gap: 6 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <span style={{
              fontSize: "0.5625rem", fontWeight: 700, padding: "1px 5px",
              borderRadius: 8, background: `${color}18`,
              color, textTransform: "uppercase", letterSpacing: "0.05em",
              display: "inline-block", marginBottom: 4,
            }}>
              {item.type.replace(/_/g, " ")}
            </span>
            {item.url ? (
              <a href={item.url} target="_blank" rel="noopener noreferrer"
                style={{ display: "block", fontSize: "0.8125rem", fontWeight: 600, color: "var(--text-primary, #111)", textDecoration: "none", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {item.label}
              </a>
            ) : (
              <p style={{ margin: 0, fontSize: "0.8125rem", fontWeight: 600, color: "var(--text-primary, #111)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {item.label}
              </p>
            )}
            {item.accountName && (
              <p style={{ margin: "2px 0 0", fontSize: "0.6875rem", color: "var(--text-secondary, #aaa)" }}>
                {item.accountName}
              </p>
            )}
          </div>
          <button
            onMouseDown={e => e.stopPropagation()}
            onClick={e => { e.stopPropagation(); onRemove(); }}
            style={{
              background: "none", border: "none", cursor: "pointer",
              color: "var(--text-secondary, #ccc)", fontSize: "0.75rem",
              padding: "0 2px", flexShrink: 0,
            }}
          >✕</button>
        </div>
        <textarea
          value={note}
          onChange={e => setNote(e.target.value)}
          onBlur={() => onNoteChange(note)}
          onMouseDown={e => e.stopPropagation()}
          placeholder="Add a note…"
          rows={2}
          style={{
            marginTop: 6, width: "100%", boxSizing: "border-box",
            padding: "4px 6px", borderRadius: 4,
            border: "1px solid var(--border, rgba(0,0,0,0.1))",
            background: "var(--bg, #f9f9f9)",
            fontFamily: "var(--font-base)", fontSize: "0.6875rem",
            lineHeight: 1.5, outline: "none", resize: "vertical",
            color: "var(--text-primary, #111)",
          }}
        />
      </div>
    </div>
  );
}

function SessionCanvas({
  session,
  scratchRefs,
  onRefsChange,
  accentColor,
}: {
  session: WorkingSession | null;
  scratchRefs?: AnnotatedRef[];
  onRefsChange: (refs: AnnotatedRef[]) => void;
  accentColor: string;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: "session-canvas-drop" });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const refs: AnnotatedRef[] = scratchRefs ?? ((session?.record_refs ?? []) as AnnotatedRef[]);

  // Compute canvas height to fit all cards + some padding
  const maxY = refs.reduce((m, r) => Math.max(m, (r._y ?? 0) + 160), 280);
  const canvasH = Math.max(280, maxY + 40);

  function removeRef(id: string) {
    onRefsChange(refs.filter(r => r.id !== id));
  }
  function updateNote(id: string, note: string) {
    onRefsChange(refs.map(r => r.id === id ? { ...r, _note: note } : r));
  }
  function updatePos(id: string, dx: number, dy: number) {
    onRefsChange(refs.map(r =>
      r.id === id
        ? { ...r, _x: Math.max(0, (r._x ?? 0) + Math.round(dx)), _y: Math.max(0, (r._y ?? 0) + Math.round(dy)) }
        : r
    ));
  }

  return (
    <div
      ref={setNodeRef}
      onClick={() => setSelectedId(null)}
      style={{
        position: "relative",
        height: canvasH,
        background: isOver ? `${accentColor}06` : "var(--bg, #f9f9f9)",
        backgroundImage: "radial-gradient(circle, #AEBBC1 1px, transparent 1px)",
        backgroundSize: "20px 20px",
        border: `1.5px dashed ${isOver ? accentColor : "var(--border, rgba(0,0,0,0.12))"}`,
        borderRadius: 8,
        overflow: "hidden",
        transition: "all 0.15s",
      }}
    >
      {refs.length === 0 && !isOver && (
        <div style={{
          position: "absolute", inset: 0,
          display: "flex", flexDirection: "column",
          alignItems: "center", justifyContent: "center",
          pointerEvents: "none", gap: 6,
        }}>
          <p style={{ margin: 0, fontSize: "0.6875rem", fontWeight: 700, color: "var(--text-secondary, #ccc)", letterSpacing: "0.08em", textTransform: "uppercase" }}>
            Drop records here
          </p>
          <p style={{ margin: 0, fontSize: "0.6875rem", color: "var(--text-secondary, #ccc)" }}>
            Drag from the export tray or search modal
          </p>
        </div>
      )}
      {refs.map(item => (
        <SessionRecordCard
          key={item.id}
          item={item}
          selected={selectedId === item.id}
          onSelect={() => setSelectedId(item.id)}
          onRemove={() => removeRef(item.id)}
          onNoteChange={note => updateNote(item.id, note)}
        />
      ))}
      {/* Expose updatePos to DndContext handler via data-attr trick */}
      <div
        data-session-pos-updater
        ref={el => {
          if (el) (el as HTMLDivElement & { __updatePos?: typeof updatePos }).__updatePos = updatePos;
        }}
        style={{ display: "none" }}
      />
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Expand handle — drag up/left from the bottom-right corner to grow the panel
// ─────────────────────────────────────────────────────────────────────────────

function ExpandHandle({
  onDelta,
}: {
  onDelta: (dw: number, dh: number) => void;
}) {
  const handleRef = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);
  const last = useRef({ x: 0, y: 0 });

  function onMouseDown(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    dragging.current = true;
    last.current = { x: e.clientX, y: e.clientY };

    function onMove(ev: MouseEvent) {
      if (!dragging.current) return;
      const dx = ev.clientX - last.current.x;
      const dy = ev.clientY - last.current.y;
      last.current = { x: ev.clientX, y: ev.clientY };
      onDelta(dx, dy);
    }
    function onUp() {
      dragging.current = false;
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    }
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }

  return (
    <div
      ref={handleRef}
      onMouseDown={onMouseDown}
      title="Drag to expand"
      style={{
        position: "absolute",
        bottom: 4,
        right: 4,
        width: 20,
        height: 20,
        cursor: "nwse-resize",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 10,
        borderRadius: 4,
        background: "rgba(0,0,0,0.06)",
        color: "var(--text-secondary, #aaa)",
        userSelect: "none",
      }}
    >
      <svg width="10" height="10" viewBox="0 0 10 10" fill="currentColor">
        <path d="M10 0L0 10h3L10 3V0zm0 4L4 10h3l3-3V4zm0 3l-3 3h3V7z"/>
      </svg>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Working Sessions area — tabs + canvas
// ─────────────────────────────────────────────────────────────────────────────

function WorkingSessionsArea({
  sessions,
  setSessions,
  accentColor,
  textColor,
  currentUser,
}: {
  sessions: WorkingSession[];
  setSessions: React.Dispatch<React.SetStateAction<WorkingSession[]>>;
  accentColor: string;
  textColor: string;
  currentUser: import("../types").UserProfile | null;
}) {
  // activeId = null means "unsaved scratch session" shown immediately
  const [activeId, setActiveId] = useState<number | "scratch" | null>("scratch");
  const [scratchRefs, setScratchRefs] = useState<AnnotatedRef[]>([]);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editName, setEditName] = useState("");
  const [extraW, setExtraW] = useState(0);
  const [extraH, setExtraH] = useState(0);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const creatingRef = useRef(false);

  // Auto-switch to first session when sessions are loaded and we're on scratch
  useEffect(() => {
    if (sessions.length > 0 && activeId === "scratch") {
      setActiveId(sessions[sessions.length - 1].id);
    }
  }, [sessions.length]);

  const activeSession = typeof activeId === "number" ? (sessions.find(s => s.id === activeId) ?? null) : null;

  function autoName(): string {
    const name = currentUser?.display_name || currentUser?.username || "Session";
    const now = new Date();
    const date = now.toLocaleDateString("en-US", { month: "short", day: "numeric" });
    const time = now.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
    return `${name} — ${date} ${time}`;
  }

  function scheduleSave(sessionId: number, refs: AnnotatedRef[]) {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      workingSessionApi.update(sessionId, { record_refs: refs as ExportItemSnapshot[] }).catch(() => {});
    }, 800);
  }

  function handleRefsChange(refs: AnnotatedRef[]) {
    if (activeId === "scratch") {
      setScratchRefs(refs);
      return;
    }
    if (!activeSession) return;
    setSessions(prev => prev.map(s => s.id === activeSession.id ? { ...s, record_refs: refs as ExportItemSnapshot[] } : s));
    scheduleSave(activeSession.id, refs);
  }

  // Create a real session — used both when user explicitly clicks "+ New Session"
  // and when first item is dropped into the scratch canvas.
  async function ensureSession(initialRefs: AnnotatedRef[] = []): Promise<WorkingSession | null> {
    if (creatingRef.current) return null;
    creatingRef.current = true;
    try {
      const res = await workingSessionApi.create({ name: autoName(), record_refs: initialRefs as ExportItemSnapshot[] });
      const newSession = res.data;
      setSessions(prev => [...prev, newSession]);
      setActiveId(newSession.id);
      setScratchRefs([]);
      return newSession;
    } catch (err) {
      console.error("Failed to create working session", err);
      return null;
    } finally {
      creatingRef.current = false;
    }
  }

  async function addNewSession() {
    await ensureSession([]);
  }

  async function renameSession() {
    if (!editingId || !editName.trim()) { setEditingId(null); return; }
    try {
      await workingSessionApi.update(editingId, { name: editName.trim() });
      setSessions(prev => prev.map(s => s.id === editingId ? { ...s, name: editName.trim() } : s));
    } finally {
      setEditingId(null);
    }
  }

  async function deleteSession(id: number) {
    try { await workingSessionApi.destroy(id); } catch {/* best-effort */}
    setSessions(prev => prev.filter(s => s.id !== id));
    if (activeId === id) setActiveId(sessions.find(s => s.id !== id)?.id ?? "scratch");
  }

  // Called by parent DndContext when export-pill is dropped onto session canvas
  const addRef = useCallback(async (item: ExportItemSnapshot) => {
    const newRef: AnnotatedRef = {
      ...item,
      _note: "",
      _x: 16 + (Math.random() * 60 | 0),
      _y: 16 + (Math.random() * 40 | 0),
    };

    if (activeId === "scratch") {
      // Auto-create session on first drop into scratch
      const existing = scratchRefs;
      if (existing.some(r => r.id === item.id)) return;
      const staggered = existing.map((r, i) => ({ ...r, _x: 16 + (i % 3) * 240, _y: 16 + Math.floor(i / 3) * 180 }));
      const idx = existing.length;
      const positioned: AnnotatedRef = { ...newRef, _x: 16 + (idx % 3) * 240, _y: 16 + Math.floor(idx / 3) * 180 };
      const all = [...staggered, positioned];
      setScratchRefs(all);
      // Persist automatically on first item
      await ensureSession(all);
      return;
    }

    if (!activeSession) return;
    const refs = (activeSession.record_refs ?? []) as AnnotatedRef[];
    if (refs.some(r => r.id === item.id)) return;
    const idx = refs.length;
    const positioned: AnnotatedRef = { ...newRef, _x: 16 + (idx % 3) * 240, _y: 16 + Math.floor(idx / 3) * 180 };
    const updated = [...refs, positioned];
    setSessions(prev => prev.map(s => s.id === activeSession.id ? { ...s, record_refs: updated as ExportItemSnapshot[] } : s));
    scheduleSave(activeSession.id, updated);
  }, [activeId, activeSession, scratchRefs, setSessions]);

  // Surface addRef via DOM for parent DndContext
  useEffect(() => {
    const el = document.querySelector("[data-session-adder]") as (HTMLDivElement & { __addRef?: typeof addRef }) | null;
    if (el) el.__addRef = addRef;
  }, [addRef]);

  const currentRefs: AnnotatedRef[] = activeId === "scratch"
    ? scratchRefs
    : (activeSession?.record_refs as AnnotatedRef[] ?? []);

  return (
    <div style={{
      background: "var(--surface, #fff)",
      border: "1px solid var(--border, rgba(0,0,0,0.08))",
      borderRadius: 12,
      overflow: "visible",
      marginBottom: 40,
      position: "relative",
      width: extraW > 0 ? `calc(100% + ${extraW}px)` : undefined,
    }}>
      {/* Header */}
      <div style={{ padding: "12px 16px 0", borderBottom: "1px solid var(--border, rgba(0,0,0,0.08))" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
          <span style={{ fontSize: "0.6875rem", fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: textColor }}>
            Working Sessions
          </span>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <span style={{ fontSize: "0.6875rem", color: "var(--text-secondary, #aaa)" }}>
              Drag any record here · drop export-tray items onto the canvas
            </span>
            <button
              onClick={() => void addNewSession()}
              style={{
                fontSize: "0.75rem", fontWeight: 600,
                padding: "3px 10px", borderRadius: 6,
                border: `1px solid ${accentColor}`,
                background: "transparent", color: accentColor,
                cursor: "pointer", fontFamily: "var(--font-base)",
              }}
            >+ New Session</button>
          </div>
        </div>

        {/* Session tabs */}
        <div style={{ display: "flex", gap: 4, overflowX: "auto", flexWrap: "nowrap", paddingBottom: 1, alignItems: "flex-end" }}>
          {/* Scratch tab — always shown if no sessions yet */}
          {sessions.length === 0 && (
            <div style={{
              padding: "6px 12px", borderRadius: "6px 6px 0 0",
              border: `1px solid ${activeId === "scratch" ? accentColor : "var(--border, rgba(0,0,0,0.08))"}`,
              borderBottom: activeId === "scratch" ? "1px solid var(--surface, #fff)" : undefined,
              background: activeId === "scratch" ? "var(--surface, #fff)" : "var(--bg, #f9f9f9)",
              color: activeId === "scratch" ? textColor : "var(--text-secondary, #888)",
              fontSize: "0.8125rem", fontFamily: "var(--font-base)",
              fontWeight: activeId === "scratch" ? 600 : 400,
              marginBottom: activeId === "scratch" ? -1 : 0,
              whiteSpace: "nowrap",
              cursor: "default",
              fontStyle: "italic",
            }}>
              New session{scratchRefs.length > 0 ? ` (${scratchRefs.length})` : " — drop items to start"}
            </div>
          )}

          {sessions.map(s => (
            <div key={s.id} style={{ display: "flex", alignItems: "center", flexShrink: 0 }}>
              {editingId === s.id ? (
                <input
                  autoFocus
                  value={editName}
                  onChange={e => setEditName(e.target.value)}
                  onBlur={() => void renameSession()}
                  onKeyDown={e => { if (e.key === "Enter") void renameSession(); if (e.key === "Escape") setEditingId(null); }}
                  style={{
                    padding: "4px 8px", borderRadius: "4px 0 0 0",
                    border: `1px solid ${accentColor}`,
                    fontSize: "0.8125rem", fontFamily: "var(--font-base)", outline: "none", width: 160,
                  }}
                />
              ) : (
                <button
                  onClick={() => setActiveId(s.id)}
                  onDoubleClick={() => { setEditingId(s.id); setEditName(s.name); }}
                  title="Click to select · Double-click to rename"
                  style={{
                    padding: "6px 12px", borderRadius: "6px 6px 0 0",
                    border: `1px solid ${activeId === s.id ? accentColor : "var(--border, rgba(0,0,0,0.08))"}`,
                    borderBottom: activeId === s.id ? "1px solid var(--surface, #fff)" : undefined,
                    background: activeId === s.id ? "var(--surface, #fff)" : "var(--bg, #f9f9f9)",
                    color: activeId === s.id ? textColor : "var(--text-secondary, #888)",
                    fontSize: "0.8125rem", fontFamily: "var(--font-base)",
                    fontWeight: activeId === s.id ? 600 : 400,
                    cursor: "pointer", whiteSpace: "nowrap",
                    marginBottom: activeId === s.id ? -1 : 0,
                    maxWidth: 200, overflow: "hidden", textOverflow: "ellipsis",
                  }}
                >{s.name}</button>
              )}
              <button
                onClick={() => void deleteSession(s.id)}
                style={{ padding: "4px 5px", background: "none", border: "none", cursor: "pointer", color: "var(--text-secondary, #ccc)", fontSize: "0.75rem", lineHeight: 1 }}
              >×</button>
            </div>
          ))}
        </div>
      </div>

      {/* Session canvas — always visible */}
      <div style={{ padding: 12, minHeight: 160 + extraH }}>
        <SessionCanvas
          key={typeof activeId === "number" ? activeId : "scratch"}
          session={activeId === "scratch" ? null : activeSession}
          scratchRefs={activeId === "scratch" ? scratchRefs : undefined}
          onRefsChange={handleRefsChange}
          accentColor={accentColor}
        />
      </div>

      {/* Hidden DOM node for parent DndContext addRef */}
      <div data-session-adder style={{ display: "none" }} />

      <ExpandHandle onDelta={(dw, dh) => {
        setExtraW(prev => Math.max(0, prev + dw));
        setExtraH(prev => Math.max(0, prev + dh));
      }} />
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Shared sub-components
// ─────────────────────────────────────────────────────────────────────────────

const ALL_SECTION_TILES = [
  { id: "skills",          label: "My Skills",       icon: "⚡" },
  { id: "accounts",        label: "My Accounts",     icon: "🏢" },
  { id: "artifacts",       label: "My Artifacts",    icon: "📎" },
  { id: "time_allocation", label: "Time Allocation", icon: "📊" },
  { id: "notepad",         label: "Notepad",         icon: "📝" },
  { id: "mini_canvas",     label: "Mini Canvas",     icon: "⬜" },
  { id: "action_items",    label: "Action Items",    icon: "✅" },
  { id: "reminders",       label: "Reminders",       icon: "🔔" },
  { id: "comments",        label: "Comments",        icon: "💬" },
] as const;
type SectionTileId = typeof ALL_SECTION_TILES[number]["id"];

function CollapsibleSection({
  title, accentColor, textColor, defaultOpen = true, headerRight, children,
}: {
  title: string; accentColor: string; textColor: string;
  defaultOpen?: boolean; headerRight?: ReactNode; children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section style={{ marginBottom: 28 }}>
      <button
        onClick={() => setOpen(v => !v)}
        style={{
          display: "flex", alignItems: "center", gap: 8,
          background: "none", border: "none", cursor: "pointer",
          padding: 0, marginBottom: open ? 10 : 0, width: "100%", textAlign: "left",
        }}
      >
        <span style={{ fontSize: "0.6875rem", fontWeight: 700, letterSpacing: "0.08em", color: textColor, textTransform: "uppercase", flex: 1 }}>
          {title}
        </span>
        {headerRight && <span onClick={e => e.stopPropagation()}>{headerRight}</span>}
        <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke={accentColor} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
          style={{ transition: "transform 0.18s", transform: open ? "rotate(0deg)" : "rotate(-90deg)", flexShrink: 0 }}>
          <path d="M4 6l4 4 4-4"/>
        </svg>
      </button>
      {open && children}
    </section>
  );
}

function SkillRunSidebar({ skill, meta, onClose }: {
  skill: ClaudeSkill; meta: typeof ROLE_META[TitleRole]; onClose: () => void;
}) {
  const params = (skill.input_schema as { properties?: Record<string, { type?: string; description?: string }> })?.properties ?? {};
  const paramKeys = Object.keys(params);
  const [args, setArgs] = useState<Record<string, string>>(() => Object.fromEntries(paramKeys.map(k => [k, ""])));
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleRun() {
    setRunning(true); setResult(null); setError(null);
    try {
      const parsed: Record<string, unknown> = {};
      for (const k of paramKeys) {
        const s = params[k];
        parsed[k] = (s?.type === "number" || s?.type === "integer") ? Number(args[k]) : args[k];
      }
      const { data } = await skillsApi.invoke(skill.id, parsed);
      setResult(typeof data.result === "string" ? data.result : JSON.stringify(data.result, null, 2));
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string; detail?: string } } })?.response?.data?.error
        ?? (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail ?? "Invocation failed.";
      setError(msg);
    } finally { setRunning(false); }
  }

  return (
    <div style={{
      position: "absolute", top: 0, right: 0, height: "100%", width: 380,
      background: "var(--surface, #fff)", borderLeft: "1px solid var(--border, rgba(0,0,0,0.08))",
      boxShadow: "-4px 0 24px rgba(0,0,0,0.08)", display: "flex", flexDirection: "column", zIndex: 25,
    }}>
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", padding: "20px 20px 16px", borderBottom: "1px solid var(--border, rgba(0,0,0,0.08))" }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: "0.9375rem", fontWeight: 700, color: "var(--twilio-navy, #0d1b2e)", marginBottom: 4 }}>{skill.name}</div>
          <div style={{ fontSize: "0.8125rem", color: "var(--text-secondary, #666)", lineHeight: 1.5 }}>{skill.description}</div>
        </div>
        <button onClick={onClose} style={{ marginLeft: 12, flexShrink: 0, background: "transparent", border: "none", cursor: "pointer", color: "var(--text-secondary, #888)", padding: 2 }}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
      </div>
      <div style={{ flex: 1, overflowY: "auto", padding: "16px 20px", display: "flex", flexDirection: "column", gap: 14 }}>
        {paramKeys.length === 0 ? (
          <p style={{ fontSize: "0.8125rem", color: "var(--text-secondary, #888)", fontStyle: "italic" }}>No parameters required.</p>
        ) : paramKeys.map(k => (
          <div key={k}>
            <label style={{ display: "block", fontSize: "0.75rem", fontWeight: 600, color: "var(--text-secondary, #666)", marginBottom: 5, textTransform: "uppercase", letterSpacing: "0.04em" }}>{k}</label>
            {params[k]?.description && <p style={{ fontSize: "0.75rem", color: "var(--text-secondary, #aaa)", marginBottom: 5 }}>{params[k].description}</p>}
            <textarea value={args[k] ?? ""} onChange={e => setArgs(prev => ({ ...prev, [k]: e.target.value }))} rows={3}
              style={{ width: "100%", boxSizing: "border-box", padding: "8px 10px", borderRadius: 6, fontSize: "0.8125rem", border: "1px solid var(--border, rgba(0,0,0,0.15))", background: "var(--surface, #fff)", fontFamily: "var(--font-base)", resize: "vertical", outline: "none" }} />
          </div>
        ))}
        {result !== null && (
          <div style={{ marginTop: 4 }}>
            <div style={{ fontSize: "0.75rem", fontWeight: 600, color: "#059669", marginBottom: 6, textTransform: "uppercase", letterSpacing: "0.04em" }}>Result</div>
            <pre style={{ background: "rgba(5,150,105,0.06)", border: "1px solid rgba(5,150,105,0.2)", borderRadius: 6, padding: "10px 12px", fontSize: "0.75rem", lineHeight: 1.6, color: "var(--text-primary, #111)", fontFamily: "var(--font-mono, monospace)", whiteSpace: "pre-wrap", wordBreak: "break-word", margin: 0 }}>{result}</pre>
          </div>
        )}
        {error && (
          <div style={{ background: "rgba(220,38,38,0.06)", border: "1px solid rgba(220,38,38,0.2)", borderRadius: 6, padding: "10px 12px" }}>
            <p style={{ margin: 0, fontSize: "0.8125rem", color: "#dc2626" }}>{error}</p>
          </div>
        )}
      </div>
      <div style={{ padding: "16px 20px", borderTop: "1px solid var(--border, rgba(0,0,0,0.08))" }}>
        <button onClick={handleRun} disabled={running || skill.status !== "approved"}
          style={{ width: "100%", padding: 10, borderRadius: 8, fontSize: "0.875rem", fontWeight: 600, background: skill.status === "approved" ? meta.border : "var(--bg, #eee)", color: skill.status === "approved" ? "#fff" : "var(--text-secondary, #888)", border: "none", cursor: running || skill.status !== "approved" ? "not-allowed" : "pointer", opacity: running ? 0.7 : 1, fontFamily: "var(--font-base)", transition: "opacity 0.15s" }}>
          {running ? "Running…" : skill.status !== "approved" ? `Not available (${skill.status.replace("_", " ")})` : "Run Skill"}
        </button>
      </div>
    </div>
  );
}

function NewBadge({ onClick }: { onClick: () => void }) {
  return (
    <button onClick={onClick} style={{ fontSize: "0.6rem", fontWeight: 700, letterSpacing: "0.06em", padding: "2px 8px", borderRadius: 20, background: "rgba(0,0,0,0.06)", color: "var(--text-secondary, #666)", border: "none", cursor: "pointer", textTransform: "uppercase" }}>
      NEW
    </button>
  );
}

function QuickCreateRow({ icon, label, href }: { icon: ReactNode; label: string; href: string }) {
  return (
    <a href={href} target="_blank" rel="noopener noreferrer"
      style={{ display: "flex", alignItems: "center", gap: 10, padding: "7px 10px", borderRadius: 8, textDecoration: "none", color: "var(--text-primary, #111)", fontSize: "0.8125rem", fontWeight: 500, transition: "background 0.12s" }}
      onMouseEnter={e => { (e.currentTarget as HTMLAnchorElement).style.background = "rgba(0,0,0,0.04)"; }}
      onMouseLeave={e => { (e.currentTarget as HTMLAnchorElement).style.background = "transparent"; }}>
      <span style={{ width: 28, height: 28, borderRadius: 6, background: "var(--bg, #f5f5f5)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
        {icon}
      </span>
      {label}
    </a>
  );
}

function NotepadSection({ meta, accounts }: { meta: typeof ROLE_META[TitleRole]; accounts: Account[] }) {
  const [notes, setNotes] = useState<UserPageNote[]>([]);
  const [activeNoteId, setActiveNoteId] = useState<number | "new">("new");
  const [content, setContent] = useState("");
  const [accountContext, setAccountContext] = useState("");
  const [saveStatus, setSaveStatus] = useState<"idle" | "saving" | "saved">("idle");

  useEffect(() => {
    userPageNoteApi.list().then(r => {
      setNotes(r.data);
      if (r.data.length > 0) { setActiveNoteId(r.data[0].id); setContent(r.data[0].content); setAccountContext(r.data[0].account_ref_label ?? ""); }
    }).catch(() => {});
  }, []);

  function selectNote(note: UserPageNote) { setActiveNoteId(note.id); setContent(note.content); setAccountContext(note.account_ref_label ?? ""); }
  function startNew() { setActiveNoteId("new"); setContent(""); setAccountContext(""); }

  async function handleBlur() {
    if (!content.trim() && activeNoteId === "new") return;
    setSaveStatus("saving");
    try {
      if (activeNoteId === "new") {
        const { data } = await userPageNoteApi.create({ content, account_ref_label: accountContext });
        setNotes(prev => [data, ...prev]); setActiveNoteId(data.id);
      } else {
        const { data } = await userPageNoteApi.update(activeNoteId as number, { content, account_ref_label: accountContext });
        setNotes(prev => prev.map(n => n.id === data.id ? data : n));
      }
      setSaveStatus("saved"); setTimeout(() => setSaveStatus("idle"), 2000);
    } catch { setSaveStatus("idle"); }
  }

  async function deleteNote(id: number) {
    await userPageNoteApi.destroy(id);
    const rem = notes.filter(n => n.id !== id); setNotes(rem);
    if (rem.length > 0) selectNote(rem[0]); else startNew();
  }

  return (
    <div style={{ background: "var(--surface, #fff)", border: "1px solid var(--border, rgba(0,0,0,0.08))", borderRadius: 12, padding: "14px 16px", display: "flex", flexDirection: "column" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
        <span style={{ fontSize: "0.6875rem", fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: meta.text }}>NOTEPAD</span>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          {saveStatus === "saving" && <span style={{ fontSize: "0.6875rem", color: "var(--text-secondary, #aaa)" }}>Saving…</span>}
          {saveStatus === "saved" && <span style={{ fontSize: "0.6875rem", color: "#059669" }}>Saved</span>}
          <button onClick={startNew} style={{ fontSize: "0.6875rem", fontWeight: 700, letterSpacing: "0.06em", padding: "2px 8px", borderRadius: 20, background: "rgba(0,0,0,0.06)", color: "var(--text-secondary, #666)", border: "none", cursor: "pointer", textTransform: "uppercase" }}>+ New</button>
        </div>
      </div>
      {notes.length > 0 && (
        <div style={{ display: "flex", gap: 4, marginBottom: 8, flexWrap: "wrap" }}>
          {notes.map(n => (
            <div key={n.id} style={{ display: "flex", alignItems: "center" }}>
              <button onClick={() => selectNote(n)} style={{ padding: "3px 8px", borderRadius: "4px 0 0 4px", border: `1px solid ${activeNoteId === n.id ? meta.border : "var(--border, rgba(0,0,0,0.1))"}`, background: activeNoteId === n.id ? `${meta.border}12` : "transparent", color: activeNoteId === n.id ? meta.text : "var(--text-secondary, #888)", fontSize: "0.75rem", fontFamily: "var(--font-base)", cursor: "pointer", maxWidth: 100, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {n.account_ref_label || n.content.slice(0, 20) || "Note"}
              </button>
              <button onClick={() => void deleteNote(n.id)} style={{ padding: "3px 5px", borderRadius: "0 4px 4px 0", border: `1px solid ${activeNoteId === n.id ? meta.border : "var(--border, rgba(0,0,0,0.1))"}`, borderLeft: "none", background: "transparent", color: "var(--text-secondary, #ccc)", fontSize: "0.625rem", cursor: "pointer" }}>×</button>
            </div>
          ))}
          <button onClick={startNew} style={{ padding: "3px 8px", borderRadius: 4, border: `1px dashed ${activeNoteId === "new" ? meta.border : "var(--border, rgba(0,0,0,0.1))"}`, background: activeNoteId === "new" ? `${meta.border}08` : "transparent", color: "var(--text-secondary, #aaa)", fontSize: "0.75rem", fontFamily: "var(--font-base)", cursor: "pointer" }}>+ new</button>
        </div>
      )}
      <select value={accountContext} onChange={e => setAccountContext(e.target.value)}
        style={{ padding: "5px 8px", borderRadius: 6, border: "1px solid var(--border, rgba(0,0,0,0.1))", background: "var(--bg, #f9f9f9)", fontFamily: "var(--font-base)", fontSize: "0.75rem", color: accountContext ? "var(--text-primary, #111)" : "var(--text-secondary, #aaa)", marginBottom: 8, outline: "none" }}>
        <option value="">For my page (general note)</option>
        {accounts.map(a => <option key={a.id} value={a.company_name}>{a.company_name}</option>)}
      </select>
      <textarea value={content} onChange={e => setContent(e.target.value)} onBlur={() => void handleBlur()} placeholder="Your notes…"
        style={{ flex: 1, minHeight: 140, width: "100%", boxSizing: "border-box", resize: "vertical", padding: 10, borderRadius: 8, border: "1px solid var(--border, rgba(0,0,0,0.1))", background: "var(--bg, #f9f9f9)", fontFamily: "var(--font-base)", fontSize: "0.8125rem", lineHeight: 1.6, outline: "none", color: "var(--text-primary, #111)" }} />
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Mini-layouts sidebar (toggle panel)
// ─────────────────────────────────────────────────────────────────────────────

function PageSectionsSidebar({
  open, onClose, accentColor, textColor, onAddSection,
}: {
  open: boolean; onClose: () => void; accentColor: string; textColor: string;
  onAddSection: (id: SectionTileId) => void;
}) {
  if (!open) return null;
  return (
    <div style={{ position: "absolute", top: 0, right: 0, height: "100%", width: 240, background: "var(--surface, #fff)", borderLeft: "1px solid var(--border, rgba(0,0,0,0.08))", boxShadow: "-4px 0 24px rgba(0,0,0,0.07)", display: "flex", flexDirection: "column", zIndex: 30 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "14px 16px 12px", borderBottom: "1px solid var(--border, rgba(0,0,0,0.08))" }}>
        <span style={{ fontSize: "0.6875rem", fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: textColor }}>Page Sections</span>
        <button onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer", color: "var(--text-secondary, #888)", padding: 2 }}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
      </div>
      <p style={{ margin: "10px 16px 8px", fontSize: "0.75rem", color: "var(--text-secondary, #888)", lineHeight: 1.5 }}>
        Click + to add a section to your page.
      </p>
      <div style={{ flex: 1, overflowY: "auto", padding: "0 12px 12px", display: "flex", flexDirection: "column", gap: 5 }}>
        {ALL_SECTION_TILES.map(tile => (
          <div key={tile.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "7px 10px", borderRadius: 8, background: "var(--bg, #f9f9f9)", border: "1px solid var(--border, rgba(0,0,0,0.07))" }}>
            <span style={{ fontSize: "0.9rem", flexShrink: 0 }}>{tile.icon}</span>
            <span style={{ flex: 1, fontSize: "0.8125rem", fontFamily: "var(--font-base)", color: "var(--text-primary, #111)" }}>{tile.label}</span>
            <button onClick={() => onAddSection(tile.id)} title={`Add ${tile.label}`}
              style={{ width: 24, height: 24, borderRadius: 5, border: `1px solid ${accentColor}44`, background: `${accentColor}12`, color: accentColor, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "1rem", fontWeight: 700, flexShrink: 0 }}>
              +
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// RolePageInner
// ─────────────────────────────────────────────────────────────────────────────

function RolePageInner({ titleRole }: { titleRole: TitleRole }) {
  const meta = ROLE_META[titleRole];
  const currentUser = useCurrentUser();
  const navigate = useNavigate();
  const { roleSlug } = useParams<{ roleSlug: string }>();

  const [skills, setSkills] = useState<ClaudeSkill[]>([]);
  const [openSkill, setOpenSkill] = useState<ClaudeSkill | null>(null);
  const [agentSkills, setAgentSkills] = useState<AgentSkill[]>([]);
  const [myAccounts, setMyAccounts] = useState<Account[]>([]);
  const [artifacts, setArtifacts] = useState<AccountArtifact[]>([]);
  const [actionItems, setActionItems] = useState<ActionItem[]>([]);
  const [reminders, setReminders] = useState<Reminder[]>([]);
  const [comments, setComments] = useState<Comment[]>([]);
  const [pinnedLayouts, setPinnedLayouts] = useState<PageLayout[]>([]);
  const [sessions, setSessions] = useState<WorkingSession[]>([]);
  const [layoutSidebarOpen, setLayoutSidebarOpen] = useState(false);
  const [showNewArtifact, setShowNewArtifact] = useState(false);
  const [editArtifact, setEditArtifact] = useState<AccountArtifact | null>(null);
  const [visibleSections, setVisibleSections] = useState<SectionTileId[]>([
    "skills", "accounts", "artifacts", "time_allocation",
  ]);

  const pageRef = useRef<HTMLDivElement>(null);
  useLogGlow(pageRef);

  // Suppress unused variable warning
  void roleSlug;

  useEffect(() => {
    skillsApi.list().then(({ data }) => {
      setSkills(data.results.filter(s => (s.roles ?? []).includes(meta.label)));
    }).catch(() => {});
    agentSkillsApi.list().then(({ data }) => {
      setAgentSkills(data.results.filter(s => (s.pinned_to_roles ?? []).includes(meta.label) && s.status === "approved"));
    }).catch(() => {});
    layoutsApi.listPinned().then(({ data }) => setPinnedLayouts(data)).catch(() => {});
    workingSessionApi.list().then(({ data }) => setSessions(data)).catch(() => {});
  }, [meta.label]);

  useEffect(() => {
    if (!currentUser) return;
    Promise.all([
      teamApi.listMembers({ page_size: "200" }),
      accountsApi.listAccounts({ page_size: "500" }),
      schedulerApi.listActionItems({ status: "in_progress", page_size: "20" }),
      schedulerApi.listReminders({ status: "pending", page_size: "20" }),
      commentsApi.listAll(),
    ]).then(([membersRes, accountsRes, aiRes, remRes, comRes]) => {
      const member = membersRes.data.results.find(m => m.user === currentUser.id) ?? null;
      const accounts = member
        ? accountsRes.data.results.filter(a => (a.team_members ?? []).some((m: { id: number }) => m.id === member.id))
        : [];
      setMyAccounts(accounts);
      setActionItems(aiRes.data.results.filter(ai => ai.assigned_to === currentUser.id));
      setReminders(remRes.data.results);
      setComments(comRes.data.results.slice(0, 5));
      Promise.all(accounts.map(a => accountsApi.listArtifacts(a.id).then(r => r.data).catch(() => [] as AccountArtifact[])))
        .then(all => setArtifacts(all.flat()));
    }).catch(() => {});
  }, [currentUser]);

  useEffect(() => { setOpenSkill(null); }, [titleRole]);

  function addSection(id: SectionTileId) {
    setVisibleSections(prev => prev.includes(id) ? prev : [...prev, id]);
  }
  function removeSection(id: SectionTileId) {
    setVisibleSections(prev => prev.filter(s => s !== id));
  }

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));

  const handleDragEnd = useCallback((event: DragEndEvent) => {
    const { active, over } = event;
    if (!over) return;
    // Record ref dropped onto session canvas
    if (over.id === "session-canvas-drop") {
      const item = (active.data.current as { item?: ExportItemSnapshot })?.item;
      if (item) {
        const el = document.querySelector("[data-session-adder]") as (HTMLDivElement & { __addRef?: (i: ExportItemSnapshot) => void }) | null;
        el?.__addRef?.(item);
      }
    }
    // Session card repositioned within canvas
    if (active.id.toString().startsWith("sess-card:") && over.id === "session-canvas-drop") {
      const nodeId = (active.data.current as { refId?: string })?.refId;
      if (nodeId) {
        const el = document.querySelector("[data-session-pos-updater]") as (HTMLDivElement & { __updatePos?: (id: string, dx: number, dy: number) => void }) | null;
        el?.__updatePos?.(nodeId, event.delta.x, event.delta.y);
      }
    }
  }, []);

  const now = new Date();
  const tomorrow = new Date(now); tomorrow.setDate(now.getDate() + 1);
  const nearReminders = reminders.filter(r => new Date(r.due_at) <= tomorrow);

  const initials = currentUser
    ? (currentUser.display_name || currentUser.username || currentUser.email || "?")
        .split(" ").map(n => n[0]).join("").toUpperCase().slice(0, 2)
    : "?";

  // SVG icons for quick-create row
  const gdocsIcon = <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#4285F4" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>;
  const sheetIcon = <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#0F9D58" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><line x1="3" y1="9" x2="21" y2="9"/><line x1="3" y1="15" x2="21" y2="15"/><line x1="9" y1="3" x2="9" y2="21"/></svg>;
  const slidesIcon = <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#F4B400" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="4" width="20" height="16" rx="2"/></svg>;
  const jiraIcon = <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#0052CC" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2L2 12l10 10 10-10z"/></svg>;
  const figmaIcon = <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#A259FF" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M5 5.5A3.5 3.5 0 018.5 2H12v7H8.5A3.5 3.5 0 015 5.5z"/><path d="M12 2h3.5a3.5 3.5 0 010 7H12z"/><path d="M12 12.5a3.5 3.5 0 017 0 3.5 3.5 0 01-7 0z"/><path d="M5 19.5A3.5 3.5 0 018.5 16H12v3.5a3.5 3.5 0 01-7 0z"/></svg>;
  const notionIcon = <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#111" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M7 7h10M7 12h6M7 17h4"/></svg>;

  function renderSection(id: SectionTileId) {
    const removeBtn = (
      <button onClick={() => removeSection(id)} style={{ background: "none", border: "none", cursor: "pointer", color: "var(--text-secondary, #ccc)", fontSize: "0.75rem", padding: "2px 4px" }}>✕</button>
    );

    switch (id) {
      case "skills": return (
        <CollapsibleSection key="skills" title="My Skills" accentColor={meta.border} textColor={meta.text} headerRight={
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <button
              onClick={() => navigate("/skills")}
              style={{ fontSize: "0.6rem", fontWeight: 700, letterSpacing: "0.06em", padding: "2px 8px", borderRadius: 20, background: meta.bg, color: meta.text, border: `1px solid ${meta.border}44`, cursor: "pointer", textTransform: "uppercase" }}
            >
              + New
            </button>
            {removeBtn}
          </div>
        }>
          {skills.length === 0 ? (
            <div style={{ padding: "16px 20px", borderRadius: 10, background: "var(--surface, #fff)", border: "1.5px dashed var(--border, rgba(0,0,0,0.12))", fontSize: "0.8125rem", color: "var(--text-secondary, #888)" }}>
              No skills assigned to this role yet. Open a skill on the <a href="/skills" style={{ color: meta.border }}>Claude Skills page</a> and select <strong>{meta.label}</strong>.
            </div>
          ) : (
            <div style={{ background: "var(--surface, #fff)", border: "1px solid var(--border, rgba(0,0,0,0.08))", borderRadius: 10, padding: "14px 16px", display: "flex", flexWrap: "wrap", gap: 8 }}>
              {skills.map(skill => {
                const isOpen = openSkill?.id === skill.id;
                return (
                  <button key={skill.id} onClick={() => setOpenSkill(isOpen ? null : skill)}
                    style={{ display: "inline-flex", alignItems: "center", gap: 8, padding: "8px 16px", borderRadius: 8, fontSize: "0.8125rem", fontWeight: 600, fontFamily: "var(--font-base)", cursor: "pointer", transition: "all 0.12s", border: isOpen ? `2px solid ${meta.border}` : "2px solid var(--border, rgba(0,0,0,0.10))", background: isOpen ? meta.bg : "var(--bg, #f9f9f9)", color: isOpen ? meta.text : "var(--text-primary, #111)" }}>
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>
                    {skill.name}
                    {skill.status !== "approved" && <span style={{ fontSize: "0.625rem", padding: "1px 5px", borderRadius: 4, background: "rgba(0,0,0,0.07)", color: "var(--text-secondary, #888)" }}>{skill.status.replace("_", " ")}</span>}
                  </button>
                );
              })}
              {agentSkills.map(skill => (
                <button key={`a-${skill.id}`}
                  onClick={() => { agentSkillsApi.run(skill.id).then(({ data }) => { window.dispatchEvent(new CustomEvent("chat-inject", { detail: { text: data.prompt } })); }).catch(() => {}); }}
                  style={{ display: "inline-flex", alignItems: "center", gap: 8, padding: "8px 16px", borderRadius: 8, fontSize: "0.8125rem", fontWeight: 600, fontFamily: "var(--font-base)", cursor: "pointer", border: "2px solid var(--border, rgba(0,0,0,0.10))", background: "var(--bg, #f9f9f9)", color: "var(--text-primary, #111)" }}
                  title={skill.description}>
                  {skill.name.replace(/-/g, " ").replace(/\b\w/g, c => c.toUpperCase())}
                </button>
              ))}
            </div>
          )}
        </CollapsibleSection>
      );

      case "accounts": return (
        <CollapsibleSection key="accounts" title={`My Accounts${myAccounts.length ? ` (${myAccounts.length})` : ""}`} accentColor={meta.border} textColor={meta.text} headerRight={removeBtn}>
          {myAccounts.length === 0 ? (
            <div style={{ padding: "16px 20px", borderRadius: 10, background: "var(--surface, #fff)", border: "1.5px dashed var(--border, rgba(0,0,0,0.12))", fontSize: "0.8125rem", color: "var(--text-secondary, #888)" }}>No accounts linked to your profile yet.</div>
          ) : (
            <div style={{ background: "var(--surface, #fff)", border: "1px solid var(--border, rgba(0,0,0,0.08))", borderRadius: 10, padding: 12, display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))", gap: 10 }}>
              {myAccounts.map(account => (
                <Link key={account.id} to={`/accounts/${account.id}`} style={{ textDecoration: "none" }}>
                  <div style={{ background: "var(--bg, #f9f9f9)", border: "1px solid var(--border, rgba(0,0,0,0.06))", borderTop: `3px solid ${meta.border}`, borderRadius: 8, padding: "10px 12px", transition: "box-shadow 0.15s" }}
                    onMouseEnter={e => { (e.currentTarget as HTMLDivElement).style.boxShadow = "0 4px 12px rgba(0,0,0,0.1)"; }}
                    onMouseLeave={e => { (e.currentTarget as HTMLDivElement).style.boxShadow = "none"; }}>
                    <p style={{ margin: 0, fontSize: "0.8125rem", fontWeight: 700, color: "var(--twilio-navy, #0d1b2e)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{account.company_name}</p>
                    {account.industry && <p style={{ margin: "3px 0 0", fontSize: "0.6875rem", color: "var(--text-secondary, #888)" }}>{account.industry}</p>}
                  </div>
                </Link>
              ))}
            </div>
          )}
        </CollapsibleSection>
      );

      case "artifacts": return (
        <CollapsibleSection key="artifacts" title={`My Artifacts${artifacts.length ? ` (${artifacts.length})` : ""}`} accentColor={meta.border} textColor={meta.text} defaultOpen={false} headerRight={
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <button
              onClick={() => setShowNewArtifact(true)}
              style={{ fontSize: "0.6rem", fontWeight: 700, letterSpacing: "0.06em", padding: "2px 8px", borderRadius: 20, background: meta.bg, color: meta.text, border: `1px solid ${meta.border}44`, cursor: "pointer", textTransform: "uppercase" }}
            >
              + New
            </button>
            {removeBtn}
          </div>
        }>
          {artifacts.length === 0 ? (
            <div style={{ padding: "16px 20px", borderRadius: 10, background: "var(--surface, #fff)", border: "1.5px dashed var(--border, rgba(0,0,0,0.12))", fontSize: "0.8125rem", color: "var(--text-secondary, #888)" }}>
              No artifacts yet.{" "}
              <button onClick={() => setShowNewArtifact(true)} style={{ background: "none", border: "none", cursor: "pointer", color: meta.border, fontWeight: 600, fontSize: "0.8125rem", padding: 0 }}>
                Add one
              </button>
            </div>
          ) : (
            <div style={{ background: "var(--surface, #fff)", border: "1px solid var(--border, rgba(0,0,0,0.08))", borderRadius: 10, padding: 12, display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", gap: 8 }}>
              {artifacts.map(artifact => {
                const account = myAccounts.find(a => a.id === artifact.account);
                return (
                  <a
                    key={artifact.id}
                    href={artifact.url ?? artifact.file_url ?? "#"}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{ textDecoration: "none" }}
                    onContextMenu={e => { e.preventDefault(); setEditArtifact(artifact); }}
                  >
                    <div style={{ display: "flex", alignItems: "center", gap: 10, background: "var(--bg, #f9f9f9)", border: "1px solid var(--border, rgba(0,0,0,0.06))", borderRadius: 7, padding: "9px 12px", transition: "box-shadow 0.15s" }}
                      onMouseEnter={e => { (e.currentTarget as HTMLDivElement).style.boxShadow = "0 4px 12px rgba(0,0,0,0.08)"; }}
                      onMouseLeave={e => { (e.currentTarget as HTMLDivElement).style.boxShadow = "none"; }}>
                      <div style={{ width: 28, height: 28, borderRadius: 6, flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center", background: meta.bg }}>
                        <ArtifactIconBadge artifact={artifact} size={16} />
                      </div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <p style={{ margin: 0, fontSize: "0.75rem", fontWeight: 600, color: "var(--text-primary, #111)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{artifact.name}</p>
                        {account
                          ? <p style={{ margin: "2px 0 0", fontSize: "0.6875rem", color: "var(--text-secondary, #888)" }}>{account.company_name}</p>
                          : <p style={{ margin: "2px 0 0", fontSize: "0.6875rem", color: "var(--text-secondary, #bbb)", fontStyle: "italic" }}>No account</p>
                        }
                      </div>
                    </div>
                    <p style={{ margin: "2px 4px 0", fontSize: "0.625rem", color: "var(--text-secondary, #ccc)" }}>Right-click to edit</p>
                  </a>
                );
              })}
            </div>
          )}
        </CollapsibleSection>
      );

      case "time_allocation": return (
        <CollapsibleSection key="time_allocation" title="Time Allocation" accentColor={meta.border} textColor={meta.text} headerRight={removeBtn}>
          <div style={{ background: "var(--surface, #fff)", borderRadius: 10, border: "1px solid var(--border, rgba(0,0,0,0.08))", padding: "4px 20px 16px" }}>
            <TimeAllocationPanel />
          </div>
        </CollapsibleSection>
      );

      case "notepad": return (
        <div key="notepad" style={{ marginBottom: 28 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
            <span style={{ fontSize: "0.6875rem", fontWeight: 700, letterSpacing: "0.08em", color: meta.text, textTransform: "uppercase" }}>Notepad</span>
            {removeBtn}
          </div>
          <NotepadSection meta={meta} accounts={myAccounts} />
        </div>
      );

      case "mini_canvas": return (
        <div key="mini_canvas" style={{ marginBottom: 28 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
            <span style={{ fontSize: "0.6875rem", fontWeight: 700, letterSpacing: "0.08em", color: meta.text, textTransform: "uppercase" }}>Mini Canvas</span>
            {removeBtn}
          </div>
          <MiniCanvasPanel accentColor={meta.border} textColor={meta.text} />
        </div>
      );

      case "action_items": return (
        <CollapsibleSection key="action_items" title="Action Items (In Progress)" accentColor={meta.border} textColor={meta.text} headerRight={removeBtn}>
          <div style={{ background: "var(--surface, #fff)", border: "1px solid var(--border, rgba(0,0,0,0.08))", borderRadius: 10, padding: "10px 12px" }}>
            {actionItems.length === 0 ? <p style={{ margin: 0, fontSize: "0.75rem", color: "var(--text-secondary, #aaa)", fontStyle: "italic" }}>No action items in progress.</p>
              : actionItems.slice(0, 8).map(ai => <div key={ai.id} style={{ padding: "7px 10px", borderRadius: 7, marginBottom: 5, background: "var(--bg, #f9f9f9)", border: "1px solid var(--border, rgba(0,0,0,0.06))", fontSize: "0.8125rem", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={ai.title}>{ai.title}</div>)}
          </div>
        </CollapsibleSection>
      );

      case "reminders": return (
        <CollapsibleSection key="reminders" title="Reminders (Today / Tomorrow)" accentColor={meta.border} textColor={meta.text} headerRight={removeBtn}>
          <div style={{ background: "var(--surface, #fff)", border: "1px solid var(--border, rgba(0,0,0,0.08))", borderRadius: 10, padding: "10px 12px" }}>
            {nearReminders.length === 0 ? <p style={{ margin: 0, fontSize: "0.75rem", color: "var(--text-secondary, #aaa)", fontStyle: "italic" }}>No reminders due soon.</p>
              : nearReminders.slice(0, 5).map(r => <div key={r.id} style={{ padding: "7px 10px", borderRadius: 7, marginBottom: 5, background: "var(--bg, #f9f9f9)", border: "1px solid var(--border, rgba(0,0,0,0.06))", fontSize: "0.8125rem", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={r.title}>{r.title}</div>)}
          </div>
        </CollapsibleSection>
      );

      case "comments": return (
        <CollapsibleSection key="comments" title="Comments" accentColor={meta.border} textColor={meta.text} headerRight={removeBtn}>
          <div style={{ background: "var(--surface, #fff)", border: "1px solid var(--border, rgba(0,0,0,0.08))", borderRadius: 10, padding: "10px 12px" }}>
            {comments.length === 0 ? <p style={{ margin: 0, fontSize: "0.75rem", color: "var(--text-secondary, #aaa)", fontStyle: "italic" }}>No recent comments.</p>
              : comments.map(c => (
                <div key={c.id} style={{ padding: "7px 10px", borderRadius: 7, marginBottom: 5, background: "var(--bg, #f9f9f9)", border: "1px solid var(--border, rgba(0,0,0,0.06))", fontSize: "0.75rem", color: "var(--text-secondary, #555)", overflow: "hidden", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical" }}>
                  <span style={{ fontWeight: 600, color: "var(--text-primary, #111)", marginRight: 4 }}>{c.author_display}:</span>{c.content}
                </div>
              ))}
          </div>
        </CollapsibleSection>
      );

      default: return null;
    }
  }

  return (
    <DndContext sensors={sensors} collisionDetection={pointerWithin} onDragEnd={handleDragEnd}>
      <div ref={pageRef} className="relative h-full overflow-hidden">
        <div className="h-full overflow-auto px-6 pt-8 pb-4">
          <div className="max-w-7xl mx-auto">

            {/* Header */}
            <div style={{ marginBottom: 28 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 16, flexWrap: "wrap" }}>
                {currentUser?.avatar_url ? (
                  <img src={currentUser.avatar_url} alt={currentUser.display_name} style={{ width: 48, height: 48, borderRadius: 12, objectFit: "cover", flexShrink: 0 }} />
                ) : (
                  <div style={{ width: 48, height: 48, borderRadius: 12, flexShrink: 0, background: meta.bg, color: meta.text, display: "flex", alignItems: "center", justifyContent: "center", fontSize: "1rem", fontWeight: 700, fontFamily: "var(--font-base)" }}>
                    {initials}
                  </div>
                )}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", marginBottom: 3 }}>
                    <h1 style={{ margin: 0, fontSize: "1.375rem", fontWeight: 700, fontFamily: "var(--font-base)", color: "var(--twilio-navy, #0d1b2e)" }}>
                      {currentUser?.display_name || currentUser?.username || meta.label}
                    </h1>
                    <span style={{ fontSize: "0.6875rem", fontWeight: 700, letterSpacing: "0.06em", padding: "3px 10px", borderRadius: 20, textTransform: "uppercase", background: meta.bg, color: meta.text }}>
                      {meta.label}
                    </span>
                  </div>
                  {currentUser?.title && <p style={{ margin: 0, fontSize: "0.8125rem", color: "var(--text-secondary, #666)" }}>{currentUser.title}</p>}
                </div>
                <button
                  onClick={() => setLayoutSidebarOpen(v => !v)}
                  style={{ display: "flex", alignItems: "center", gap: 6, padding: "7px 14px", borderRadius: 8, border: `1px solid ${layoutSidebarOpen ? meta.border : "var(--border, rgba(0,0,0,0.1))"}`, background: layoutSidebarOpen ? `${meta.border}12` : "var(--surface, #fff)", color: layoutSidebarOpen ? meta.text : "var(--text-secondary, #666)", fontSize: "0.8125rem", fontFamily: "var(--font-base)", fontWeight: 600, cursor: "pointer", transition: "all 0.15s" }}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/></svg>
                  Sections
                </button>
              </div>
            </div>

            {/* Two-column layout */}
            <div style={{ display: "flex", gap: 24, alignItems: "flex-start" }}>

              {/* LEFT column */}
              <div style={{ width: 260, flexShrink: 0 }}>
                {/* Action items */}
                <div style={{ background: "var(--surface, #fff)", border: "1px solid var(--border, rgba(0,0,0,0.08))", borderRadius: 12, padding: 14, marginBottom: 12 }}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
                    <span style={{ fontSize: "0.6875rem", fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: meta.text }}>
                      ACTION ITEMS <span style={{ fontWeight: 400, color: "var(--text-secondary, #888)", textTransform: "none", letterSpacing: 0 }}>In Progress</span>
                    </span>
                    <NewBadge onClick={() => window.dispatchEvent(new CustomEvent("open-new-action-item"))} />
                  </div>
                  {actionItems.length === 0
                    ? <p style={{ margin: 0, fontSize: "0.75rem", color: "var(--text-secondary, #aaa)", fontStyle: "italic" }}>No action items in progress.</p>
                    : actionItems.slice(0, 5).map(ai => <div key={ai.id} style={{ padding: "8px 10px", borderRadius: 8, marginBottom: 6, background: "var(--bg, #f9f9f9)", border: "1px solid var(--border, rgba(0,0,0,0.06))", fontSize: "0.8125rem", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={ai.title}>{ai.title}</div>)
                  }
                </div>

                {/* Reminders */}
                <div style={{ background: "var(--surface, #fff)", border: "1px solid var(--border, rgba(0,0,0,0.08))", borderRadius: 12, padding: 14, marginBottom: 12 }}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
                    <span style={{ fontSize: "0.6875rem", fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: meta.text }}>
                      REMINDERS <span style={{ fontWeight: 400, color: "var(--text-secondary, #888)", textTransform: "none", letterSpacing: 0 }}>Today / Tomorrow</span>
                    </span>
                    <NewBadge onClick={() => window.dispatchEvent(new CustomEvent("open-new-reminder"))} />
                  </div>
                  {nearReminders.length === 0
                    ? <p style={{ margin: 0, fontSize: "0.75rem", color: "var(--text-secondary, #aaa)", fontStyle: "italic" }}>No reminders due soon.</p>
                    : nearReminders.slice(0, 4).map(r => <div key={r.id} style={{ padding: "7px 10px", borderRadius: 8, marginBottom: 6, background: "var(--bg, #f9f9f9)", border: "1px solid var(--border, rgba(0,0,0,0.06))", fontSize: "0.8125rem", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={r.title}>{r.title}</div>)
                  }
                </div>

                {/* Comments */}
                <div style={{ background: "var(--surface, #fff)", border: "1px solid var(--border, rgba(0,0,0,0.08))", borderRadius: 12, padding: 14, marginBottom: 12 }}>
                  <div style={{ marginBottom: 10 }}>
                    <span style={{ fontSize: "0.6875rem", fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: meta.text }}>COMMENTS</span>
                  </div>
                  {comments.length === 0
                    ? <p style={{ margin: 0, fontSize: "0.75rem", color: "var(--text-secondary, #aaa)", fontStyle: "italic" }}>No recent comments.</p>
                    : comments.slice(0, 3).map(c => (
                      <div key={c.id} style={{ padding: "7px 10px", borderRadius: 8, marginBottom: 6, background: "var(--bg, #f9f9f9)", border: "1px solid var(--border, rgba(0,0,0,0.06))", fontSize: "0.75rem", color: "var(--text-secondary, #555)", overflow: "hidden", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical" }}>
                        <span style={{ fontWeight: 600, color: "var(--text-primary, #111)", marginRight: 4 }}>{c.author_display}:</span>{c.content}
                      </div>
                    ))
                  }
                </div>

                {/* Pinned layouts */}
                <div style={{ background: "var(--surface, #fff)", border: "1px solid var(--border, rgba(0,0,0,0.08))", borderRadius: 12, padding: 14, marginBottom: 24 }}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
                    <span style={{ fontSize: "0.6875rem", fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: meta.text }}>LAYOUTS</span>
                    <Link to="/build" style={{ fontSize: "0.6875rem", color: meta.border, textDecoration: "none", fontWeight: 600 }}>View all →</Link>
                  </div>
                  {pinnedLayouts.length === 0
                    ? <p style={{ margin: 0, fontSize: "0.75rem", color: "var(--text-secondary, #aaa)", fontStyle: "italic" }}>Pin from <Link to="/build" style={{ color: meta.border }}>Page Builder</Link>.</p>
                    : pinnedLayouts.slice(0, 4).map(l => (
                      <Link key={l.id} to={`/build?layout=${l.id}`} style={{ textDecoration: "none", display: "block", marginBottom: 5 }}>
                        <div style={{ padding: "7px 10px", borderRadius: 8, background: "var(--bg, #f9f9f9)", border: "1px solid var(--border, rgba(0,0,0,0.06))", fontSize: "0.8125rem", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{l.name}</div>
                      </Link>
                    ))
                  }
                </div>

                {/* Quick-create links */}
                <div style={{ background: "var(--surface, #fff)", border: "1px solid var(--border, rgba(0,0,0,0.08))", borderRadius: 12, padding: "10px 4px" }}>
                  <QuickCreateRow icon={gdocsIcon}  label="+ Google Doc"    href="https://docs.google.com/document/create" />
                  <QuickCreateRow icon={sheetIcon}  label="+ Google Sheet"  href="https://sheets.google.com/create" />
                  <QuickCreateRow icon={slidesIcon} label="+ Google Slides" href="https://slides.google.com/create" />
                  <QuickCreateRow icon={jiraIcon}   label="+ JIRA"          href="https://jira.atlassian.com" />
                  <QuickCreateRow icon={figmaIcon}  label="+ Figma"         href="https://www.figma.com" />
                  <QuickCreateRow icon={notionIcon} label="+ Notion"        href="https://www.notion.so" />
                </div>
              </div>

              {/* RIGHT column */}
              <div style={{ flex: 1, minWidth: 0 }}>
                {visibleSections.map(id => renderSection(id))}

                {visibleSections.length === 0 && (
                  <div style={{ padding: "32px 24px", borderRadius: 12, border: "1.5px dashed var(--border, rgba(0,0,0,0.12))", textAlign: "center", marginBottom: 28 }}>
                    <p style={{ margin: "0 0 10px", fontSize: "0.875rem", fontWeight: 600, color: "var(--text-secondary, #888)" }}>Your page is empty</p>
                    <p style={{ margin: "0 0 16px", fontSize: "0.8125rem", color: "var(--text-secondary, #aaa)" }}>Use the <strong>Sections</strong> button to add panels.</p>
                    <button onClick={() => setLayoutSidebarOpen(true)} style={{ padding: "8px 18px", borderRadius: 8, border: `1px solid ${meta.border}`, background: meta.bg, color: meta.text, fontSize: "0.875rem", fontFamily: "var(--font-base)", fontWeight: 600, cursor: "pointer" }}>
                      Open Sections panel
                    </button>
                  </div>
                )}

                {/* Notepad + Mini canvas (default always-visible row if not in visibleSections) */}
                {!visibleSections.includes("notepad") && !visibleSections.includes("mini_canvas") && (
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 28 }}>
                    <NotepadSection meta={meta} accounts={myAccounts} />
                    <MiniCanvasPanel accentColor={meta.border} textColor={meta.text} />
                  </div>
                )}

                {/* Working sessions */}
                <WorkingSessionsArea
                  sessions={sessions}
                  setSessions={setSessions}
                  accentColor={meta.border}
                  textColor={meta.text}
                  currentUser={currentUser}
                />
              </div>
            </div>
          </div>
        </div>

        {openSkill && <SkillRunSidebar skill={openSkill} meta={meta} onClose={() => setOpenSkill(null)} />}

        <PageSectionsSidebar
          open={layoutSidebarOpen}
          onClose={() => setLayoutSidebarOpen(false)}
          accentColor={meta.border}
          textColor={meta.text}
          onAddSection={addSection}
        />
      </div>

      {showNewArtifact && (
        <NewArtifactModal
          accounts={myAccounts}
          onClose={() => setShowNewArtifact(false)}
          onAdded={a => {
            setArtifacts(prev => [a, ...prev]);
            setShowNewArtifact(false);
          }}
        />
      )}

      {editArtifact && (
        <EditArtifactModal
          artifact={editArtifact}
          accounts={myAccounts}
          onClose={() => setEditArtifact(null)}
          onSaved={updated => {
            setArtifacts(prev => prev.map(a => a.id === updated.id ? updated : a));
            setEditArtifact(null);
          }}
        />
      )}
    </DndContext>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// RolePage wrapper
// ─────────────────────────────────────────────────────────────────────────────

export default function RolePage() {
  const { roleSlug } = useParams<{ roleSlug: string }>();
  const titleRole: TitleRole | undefined = roleSlug ? SLUG_TO_ROLE[roleSlug] : undefined;
  if (!titleRole || !ROLED_PAGES.includes(titleRole)) return <Navigate to="/team" replace />;
  return <RolePageInner titleRole={titleRole} />;
}
