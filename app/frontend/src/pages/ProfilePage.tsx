import {
  useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode,
} from "react";
import SkillRunDialog from "../components/skills/SkillRunDialog";
import { reminderTimes } from "../lib/reminderSections";
import { ArtifactBrowseBar } from "../components/account/ArtifactBrowseBar";
import {
  ExpandableSection, CardList, fieldsOf, fmtDateTime, type FullCard,
} from "../components/profile/fullscreen";
import { NotificationsFull, PublicFull, NotepadFull, MiniCanvasFull, TicketsFull } from "../components/profile/FullViews";
import ProfileTicketsSection from "../components/profile/ProfileTicketsSection";
import PageSectionsPanel from "../components/profile/PageSectionsPanel";
import { loadIdList, revealSection } from "../components/profile/sectionLayout";
import { TICKET_KIND_TITLE } from "../lib/tickets";
import type { TicketKind } from "../types";
import { useQuickLinks } from "../hooks/useQuickLinks";
import { DEFAULT_ARTIFACT_BROWSE, browseArtifacts, type ArtifactBrowseState } from "../lib/artifactBrowse";
import { ACTION_ITEMS_UPDATED_KEY } from "../lib/actionItemEvents";
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
import RichTextMentionEditor from "../components/shared/RichTextMentionEditor";
import { htmlToPreviewText } from "../lib/noteHelpers";
import {
  agentSkillsApi, skillsApi, accountsApi, teamApi, airtableApi,
  schedulerApi, commentsApi, layoutsApi,
  userPageNoteApi, workingSessionApi,
} from "../lib/api";
import type {
  AgentSkill, ClaudeSkill, Account, AccountArtifact,
  Reminder, Comment, PageLayout, AirtableActionItem, TeamMember,
  UserPageNote, WorkingSession, ExportItemSnapshot,
} from "../types";
import { acceptExportItemDragOver, readExportItem } from "../lib/exportDrop";
import { EXPORT_ITEM_DRAG_KEY } from "../components/ExportBar";
import { ROLE_META, getTitleRole } from "../lib/titleRoles";
import type { TitleRole } from "../lib/titleRoles";
import { useLogGlow } from "../hooks/useLogGlow";
import { useCurrentUser } from "../context/CurrentUserContext";
import TimeAllocationPanel from "../components/TimeAllocationPanel";
import NotificationsSection from "../components/profile/NotificationsSection";
import TicketsToReview from "../components/profile/TicketsToReview";
import PublicSection from "../components/profile/PublicSection";
import { memberProfileApi } from "../lib/api";
import type { MemberPublicProfile } from "../types/team";

// ─────────────────────────────────────────────────────────────────────────────
// Artifact icons — the shared components/account/ArtifactIcon, same as the Artifacts panel.
//
// This page used to carry its own copy of the icon catalog. That copy drew Google Docs, Sheets
// and Slides from the favicon service, which returns the same generic "G" for every Google
// subdomain, so the page's artifacts and its "+ Google Doc" rows looked different from the same
// artifacts on an account.
// ─────────────────────────────────────────────────────────────────────────────

function ArtifactIconBadge({ artifact, size = 16 }: { artifact: AccountArtifact; size?: number }) {
  return (
    <ArtifactIcon
      artifactType={artifact.artifact_type}
      mime={artifact.mime_type}
      name={artifact.name}
      url={artifact.url}
      iconKey={artifact.icon_key}
      imageUrl={artifact.image_url}
      size={size}
    />
  );
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
                  <ArtifactIconImg entry={entry} size={13} />
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
                  <ArtifactIconImg entry={entry} size={13} />
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
import MiniNodePreview, { resolveProps } from "../components/profile/MiniNodePreview";
import { MINI_FIELD_CATALOG } from "../components/profile/miniFields";
import QuickLinks from "../components/profile/QuickLinks";
import {
  ARTIFACT_ICON_CATALOG, ArtifactIcon, ArtifactIconImg, CATALOG_BY_KEY, getAutoIconKey,
} from "../components/account/ArtifactIcon";
import { ActionItemModal } from "../components/account/ActionItemModal";
import { useCommentContext } from "../components/comments/CommentContext";
import {
  canvasNodesFromSnapshot, defaultPropsFor, defaultSizeFor, filledFields, isInlineTextType, isPreviewType,
  isRichEditType, MAX_SAVED_CANVASES, MINI_CANVAS_ITEM_TYPE, miniNodesToCanvasNodes, parseMiniNodes,
  parseSavedCanvases, savedCanvasToSnapshot, type MiniNode, type SavedCanvas,
} from "../components/profile/miniCanvas";
import SkillLaunchButtons from "../components/skills/SkillLaunchButtons";

// ─────────────────────────────────────────────────────────────────────────────
// Mini-canvas — a self-contained pared-down page builder embedded in the role page
// ─────────────────────────────────────────────────────────────────────────────



let _miniId = 0;
// A canvas now survives page loads, so a counter that restarts at 1 would hand out ids that
// already belong to restored nodes. The random part makes ids unique across loads.
function mkMiniId() { return `mini-${(++_miniId).toString(36)}${Math.random().toString(36).slice(2, 7)}`; }

/** Extra drag type set only by a saved-canvas button, so the mini-canvas can refuse its own snapshot. */
const MINI_CANVAS_DRAG_KEY = "application/x-mini-canvas";
const MINI_CANVAS_KEY = "profileMiniCanvas-v1";
const MINI_SAVED_KEY = "profileMiniCanvasSaved-v1";

function readJson(key: string): unknown {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null; // unreadable or corrupt: start empty rather than crash the page
  }
}

/** Write a list, or remove the key when it is empty so storage does not keep "[]" around. */
function writeList(key: string, list: unknown[]): void {
  try {
    if (list.length) localStorage.setItem(key, JSON.stringify(list));
    else localStorage.removeItem(key);
  } catch { /* storage full or blocked — the canvas still works for this session */ }
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

function updateMiniNodeProps(nodes: MiniNode[], id: string, props: Record<string, unknown>): MiniNode[] {
  return nodes.map(n => {
    if (n.id === id) return { ...n, props: { ...(n.props ?? {}), ...props } };
    return { ...n, children: n.children ? updateMiniNodeProps(n.children, id, props) : n.children };
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

/**
 * A record dropped onto the mini-canvas from the export tray. Flow layout with
 * wrapping everywhere, so every field stays readable however long it is and
 * nothing can sit on top of anything else.
 */
function MiniRecordBody({ record }: { record: ExportItemSnapshot }) {
  const accent = record.accent || "#6366f1";
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 3, width: "100%" }}>
      <span style={{
        alignSelf: "flex-start",
        fontSize: "0.5rem", fontWeight: 700, letterSpacing: "0.05em",
        textTransform: "uppercase", color: accent,
        background: `${accent}18`, borderRadius: 3, padding: "1px 4px",
        maxWidth: "100%", overflowWrap: "anywhere",
      }}>
        {record.type.replace(/_/g, " ")}
      </span>
      <span style={{
        fontWeight: 700, fontSize: "0.6875rem", lineHeight: 1.3,
        color: "var(--text-primary, #111)", overflowWrap: "anywhere",
      }}>
        {record.label}
      </span>
      {record.accountName && (
        <span style={{ fontSize: "0.5625rem", color: "var(--text-secondary, #888)", overflowWrap: "anywhere" }}>
          {record.accountName}
        </span>
      )}
      {record.summary && (
        <span style={{
          fontSize: "0.5625rem", lineHeight: 1.45,
          color: "var(--text-secondary, #888)",
          whiteSpace: "pre-wrap", overflowWrap: "anywhere",
        }}>
          {record.summary}
        </span>
      )}
    </div>
  );
}

/** The text a text component currently shows, however it was stored. */
function resolveMiniText(node: MiniNode): string {
  const p = { ...defaultPropsFor(node.type), ...(node.props ?? {}) };
  return String((p.text as string | undefined) ?? node.text ?? "");
}

function MiniCanvasNode({
  node, selected, onSelect, onDelete, onResize, onOpenEdit, onChangeProps, depth,
}: {
  node: MiniNode;
  selected: boolean;
  onSelect: () => void;
  onDelete: () => void;
  onResize: (id: string, w: number, h: number) => void;
  onOpenEdit: (id: string) => void;
  onChangeProps: (id: string, props: Record<string, unknown>) => void;
  depth?: number;
}) {
  const [editingText, setEditingText] = useState(false);
  const [editingRich, setEditingRich] = useState(false);
  const typed = !node.record && isPreviewType(node.type);
  const inlineText = typed && isInlineTextType(node.type);
  const richEdit = typed && isRichEditType(node.type);
  // Leaving the node (selecting something else) ends rich editing; it is saved as you type.
  useEffect(() => { if (!selected) setEditingRich(false); }, [selected]);
  // A component with fields takes its height from them (like a record card), so none are clipped.
  const hasFields = typed && filledFields(node).length > 0;
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

  const fieldLabels = filledFields(node).map(f => f.label);

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
        // A record card (or a component with fields) grows with its content; a sketch box keeps
        // its exact size.
        height: node.record || hasFields ? undefined : node.h,
        minHeight: node.record || hasFields ? node.h : undefined,
        transform: CSS.Translate.toString(transform),
        zIndex: isDragging ? 50 : selected ? 10 : (1 + (depth ?? 0)),
        opacity: isDragging ? 0.5 : 1,
        cursor: isDragging ? "grabbing" : "default",
      }}
      data-mini-node-id={node.id}
      onClick={e => { e.stopPropagation(); onSelect(); }}
      onDoubleClick={e => {
        e.stopPropagation();
        // Text and Rich Text are edited where they sit; everything else opens the field picker.
        if (inlineText) setEditingText(true);
        else if (richEdit) setEditingRich(true);
        else onOpenEdit(node.id);
      }}
      onContextMenu={e => { e.preventDefault(); e.stopPropagation(); onOpenEdit(node.id); }}
    >
      {typed ? (
        <div
          data-mini-typed={node.type}
          style={{
            width: "100%",
            height: inlineText || hasFields ? "auto" : "100%",
            minHeight: inlineText || hasFields ? node.h : undefined,
            boxSizing: "border-box",
            // No card chrome: a heading is just text. A selection outline is the only frame.
            outline: selected ? "2px solid #0263E0" : "1px dashed transparent",
            outlineOffset: 1,
            borderRadius: 3,
          }}
        >
          {editingRich ? (
            // Same editor the notes use, with an Underline button added. It is wider than the node
            // (a toolbar does not fit in 200px) and floats over the canvas while editing. Every
            // pointer/key event stops here so typing and selecting never drag the node.
            <div
              data-mini-rich-editor
              onPointerDown={e => e.stopPropagation()}
              onClick={e => e.stopPropagation()}
              onDoubleClick={e => e.stopPropagation()}
              onContextMenu={e => e.stopPropagation()}
              onKeyDown={e => { if (e.key === "Escape") { e.stopPropagation(); setEditingRich(false); } }}
              style={{ position: "relative", zIndex: 30, width: Math.max(node.w, 340), background: "var(--surface-card)", border: "1px solid #0263E0", borderRadius: 6, boxShadow: "0 6px 20px rgba(15,23,42,0.18)" }}
            >
              <RichTextMentionEditor
                value={String(resolveProps(node).html ?? "")}
                onChange={html => onChangeProps(node.id, { html })}
                placeholder="Type here…"
                minHeightClassName="min-h-[60px]"
                showUnderline
                autoFocus
              />
              <div style={{ display: "flex", justifyContent: "flex-end", padding: "4px 6px", borderTop: "1px solid var(--border, rgba(0,0,0,0.08))" }}>
                <button
                  type="button"
                  onClick={() => setEditingRich(false)}
                  style={{ fontSize: "0.6875rem", fontWeight: 600, padding: "2px 10px", borderRadius: 6, border: "1px solid #0263E0", background: "#0263E0", color: "#fff", cursor: "pointer" }}
                >Done</button>
              </div>
            </div>
          ) : editingText ? (
            <textarea
              autoFocus
              aria-label={`Edit ${node.label} text`}
              defaultValue={String(resolveMiniText(node))}
              onPointerDown={e => e.stopPropagation()}
              onClick={e => e.stopPropagation()}
              onBlur={e => { onChangeProps(node.id, { text: e.currentTarget.value }); setEditingText(false); }}
              onKeyDown={e => {
                if (e.key === "Escape") setEditingText(false);
                else if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); e.currentTarget.blur(); }
              }}
              style={{ width: "100%", minHeight: Math.max(node.h, 28), boxSizing: "border-box", font: "inherit", border: "1px solid #0263E0", borderRadius: 3, padding: 2, resize: "none" }}
            />
          ) : (
            <MiniNodePreview node={node}
            >
              {(node.children ?? []).map(child => (
                <div key={child.id} style={{ position: "absolute", left: child.x - node.x, top: child.y - node.y, width: child.w, minHeight: child.h, pointerEvents: "none" }}>
                  <MiniNodePreview node={child} />
                </div>
              ))}
            </MiniNodePreview>
          )}
        </div>
      ) : (
      <div style={{
        width: "100%",
        height: node.record ? "auto" : "100%",
        borderRadius: 6,
        ...borderSides(
          `1.5px solid ${selected ? "#0263E0" : "rgba(0,0,0,0.12)"}`,
          node.record ? { left: `4px solid ${node.record.accent || "#6366f1"}` } : {},
        ),
        boxShadow: selected ? "0 0 0 2px rgba(2,99,224,0.2)" : "0 1px 4px rgba(0,0,0,0.07)",
        background: "var(--surface, #fff)",
        display: "flex", flexDirection: "column",
        alignItems: "flex-start", justifyContent: "flex-start", gap: node.record ? 4 : 2,
        padding: node.record ? "7px 9px" : "5px 6px",
        fontSize: "0.5625rem", color: "var(--text-secondary, #888)",
        // Records must not clip — their height is content-driven.
        overflow: node.record ? "visible" : "hidden",
        position: "relative",
        boxSizing: "border-box",
      }}>
        {node.record ? (
          <MiniRecordBody record={node.record} />
        ) : (
        <>
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
        </>
        )}
      </div>
      )}

      {/* Text components edit their text on double-click, which leaves no obvious way into the
          field picker (right-click only). A selected one offers it as a button. */}
      {selected && (inlineText || richEdit) && !editingText && !editingRich && (
        <button
          type="button"
          onPointerDown={e => e.stopPropagation()}
          onClick={e => { e.stopPropagation(); onOpenEdit(node.id); }}
          title="Add data fields to this component"
          style={{
            position: "absolute", top: -9, left: 0, zIndex: 20,
            padding: "1px 7px", borderRadius: 8, border: "1px solid #0263E0",
            background: "var(--surface-card)", color: "#0263E0", cursor: "pointer",
            fontSize: "0.5625rem", fontWeight: 700, lineHeight: 1.4,
          }}
        >Fields</button>
      )}

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
  nodes, selectedId, onSelect, onDelete, onResize, onOpenEdit, onChangeProps, canvasRef, accentColor, onDropExportItem,
}: {
  nodes: MiniNode[];
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  onDelete: (id: string) => void;
  onResize: (id: string, w: number, h: number) => void;
  onOpenEdit: (id: string) => void;
  onChangeProps: (id: string, props: Record<string, unknown>) => void;
  canvasRef: React.RefObject<HTMLDivElement | null>;
  accentColor: string;
  onDropExportItem: (item: ExportItemSnapshot, x: number, y: number) => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: "mini-canvas-drop" });
  // HTML5 drags (the export tray) are invisible to dnd-kit's `isOver`.
  const [isPillOver, setIsPillOver] = useState(false);
  const showDropState = isOver || isPillOver;

  const mergedRef = useCallback((el: HTMLDivElement | null) => {
    setNodeRef(el);
    (canvasRef as React.MutableRefObject<HTMLDivElement | null>).current = el;
  }, [setNodeRef, canvasRef]);

  return (
    <div
      ref={mergedRef}
      data-no-fullscreen
      onClick={() => onSelect(null)}
      onDragOver={(e) => {
        // A saved canvas is a snapshot of this very canvas; dropping it back would nest it in itself.
        // Not calling preventDefault is what tells the browser this is not a drop target.
        if (Array.from(e.dataTransfer.types).includes(MINI_CANVAS_DRAG_KEY)) return;
        if (acceptExportItemDragOver(e)) setIsPillOver(true);
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setIsPillOver(false);
      }}
      onDrop={(e) => {
        const item = readExportItem(e);
        setIsPillOver(false);
        if (!item || (item.type as string) === MINI_CANVAS_ITEM_TYPE) return;
        e.preventDefault();
        e.stopPropagation();
        // Drop where the cursor is, in canvas coordinates.
        const rect = e.currentTarget.getBoundingClientRect();
        onDropExportItem(item, Math.max(4, Math.round(e.clientX - rect.left - 90)), Math.max(4, Math.round(e.clientY - rect.top - 20)));
      }}
      style={{
        position: "relative",
        flex: 1,
        minHeight: 200,
        backgroundColor: showDropState ? `${accentColor}06` : "var(--bg, #f9f9f9)",
        backgroundImage: "radial-gradient(circle, #AEBBC1 1px, transparent 1px)",
        backgroundSize: "20px 20px",
        border: `1.5px dashed ${showDropState ? accentColor : "var(--border, rgba(0,0,0,0.12))"}`,
        borderRadius: 8,
        // Record cards are content-height and can extend past the estimate.
        overflow: "visible",
        transition: "all 0.15s",
      }}
    >
      {nodes.length === 0 && !showDropState && (
        <div style={{
          position: "absolute", inset: 0,
          display: "flex", flexDirection: "column",
          alignItems: "center", justifyContent: "center",
          pointerEvents: "none",
        }}>
          <p style={{ margin: 0, fontSize: "0.6875rem", color: "var(--text-secondary, #ccc)", fontWeight: 600, letterSpacing: "0.08em", textTransform: "uppercase" }}>
            Drag components or export-tray records here
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
          onChangeProps={onChangeProps}
          depth={0}
        />
      ))}
    </div>
  );
}

/** Full-screen view of the mini canvas, read from where the canvas keeps its state. */
function MiniCanvasFullView({ accent }: { accent: string }) {
  const user = useCurrentUser();
  const uid = user?.id ?? null;
  const nodes = useMemo(() => (uid != null ? parseMiniNodes(readJson(`${MINI_CANVAS_KEY}:${uid}`)) : []), [uid]);
  const saved = useMemo(() => (uid != null ? parseSavedCanvases(readJson(`${MINI_SAVED_KEY}:${uid}`)) : []), [uid]);
  return <MiniCanvasFull nodes={nodes} saved={saved} accent={accent} />;
}

function MiniCanvasPanel({ accentColor, textColor }: { accentColor: string; textColor: string }) {
  const [nodes, setNodes] = useState<MiniNode[]>([]);
  const [saved, setSaved] = useState<SavedCanvas[]>([]);
  const [restored, setRestored] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editNodeId, setEditNodeId] = useState<string | null>(null);
  const canvasRef = useRef<HTMLDivElement | null>(null);
  const navigate = useNavigate();
  const currentUser = useCurrentUser();

  // Per user, so two people sharing a browser do not see each other's canvas (it can hold record
  // titles). Nothing is read or written until the user is known.
  const userId = currentUser?.id ?? null;
  const canvasKey = userId != null ? `${MINI_CANVAS_KEY}:${userId}` : null;
  const savedKey = userId != null ? `${MINI_SAVED_KEY}:${userId}` : null;

  // Restore. Merged in front of anything already dropped, never replacing it.
  useEffect(() => {
    if (!canvasKey || !savedKey) return;
    const stored = parseMiniNodes(readJson(canvasKey));
    if (stored.length) setNodes(prev => [...stored, ...prev]);
    setSaved(parseSavedCanvases(readJson(savedKey)));
    setRestored(true);
  }, [canvasKey, savedKey]);

  // Persist on every change (no debounce: the payload is small, and a debounced write would be lost
  // if "Open full builder" navigates away immediately after an edit). Only after the restore has
  // run, or the first render's empty list would erase what is in storage.
  useEffect(() => { if (restored && canvasKey) writeList(canvasKey, nodes); }, [nodes, restored, canvasKey]);
  useEffect(() => { if (restored && savedKey) writeList(savedKey, saved); }, [saved, restored, savedKey]);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));

  // An export-tray record dropped on the canvas. `w` is a starting width and `h`
  // only a minimum — MiniCanvasNode gives a record node content-driven height.
  const handleDropExportItem = useCallback((item: ExportItemSnapshot, x: number, y: number) => {
    setNodes(prev => {
      if (prev.some(n => n.record?.id === item.id)) return prev;
      return [...prev, {
        id: mkMiniId(),
        type: "record",
        icon: "🔖",
        label: item.label,
        x, y, w: 200, h: 72,
        record: item,
      }];
    });
  }, []);

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
        x, y, ...defaultSizeFor(activeData.type as string),
        // The registry props are what make it a Heading / Card / Divider rather than a box,
        // and they are what the full builder receives.
        props: defaultPropsFor(activeData.type as string),
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

  const handleClear = useCallback(() => {
    // The canvas now persists, so Clear is no longer undone by a refresh: ask first.
    if (!window.confirm(`Remove all ${nodes.length} component${nodes.length === 1 ? "" : "s"} from the mini-canvas?`)) return;
    setNodes([]);
    setSelectedId(null);
  }, [nodes.length]);

  const handleSave = useCallback(() => {
    if (nodes.length === 0) return;
    const at = new Date();
    const label = `Canvas · ${at.toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}`;
    const snapshot: SavedCanvas = {
      id: `sv-${at.getTime().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
      label,
      savedAt: at.getTime(),
      // A deep copy: the button must keep what was saved even as the canvas keeps changing.
      nodes: JSON.parse(JSON.stringify(nodes)) as MiniNode[],
    };
    setSaved(prev => [snapshot, ...prev].slice(0, MAX_SAVED_CANVASES));
  }, [nodes]);

  const removeSaved = useCallback((id: string) => setSaved(prev => prev.filter(c => c.id !== id)), []);

  const handleChangeProps = useCallback((id: string, props: Record<string, unknown>) => {
    setNodes(prev => updateMiniNodeProps(prev, id, props));
  }, []);

  const handleOpenFullBuilder = useCallback(() => {
    try {
      if (nodes.length > 0) {
        sessionStorage.setItem(MINI_CANVAS_HANDOFF_KEY, JSON.stringify(miniNodesToCanvasNodes(nodes)));
      } else {
        // Nothing to hand over. Drop any leftover from an earlier click so it cannot replay here.
        sessionStorage.removeItem(MINI_CANVAS_HANDOFF_KEY);
      }
    } catch { /* storage unavailable — open the builder without the handoff */ }
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
                <button
                  type="button"
                  onClick={handleClear}
                  disabled={nodes.length === 0}
                  title="Remove every component from the mini-canvas"
                  style={{ fontSize: "0.6875rem", color: "#ef4444", background: "none", border: "none", cursor: nodes.length ? "pointer" : "default", opacity: nodes.length ? 1 : 0.4 }}
                >Clear</button>
                <button
                  type="button"
                  onClick={handleSave}
                  disabled={nodes.length === 0}
                  title="Save this canvas as a button you can drag into a working session"
                  style={{ fontSize: "0.6875rem", fontWeight: 600, color: accentColor, background: "none", border: `1px solid ${accentColor}`, borderRadius: 6, padding: "1px 9px", cursor: nodes.length ? "pointer" : "default", opacity: nodes.length ? 1 : 0.4 }}
                >Save</button>
                <button
                  onClick={handleOpenFullBuilder}
                  style={{ fontSize: "0.6875rem", color: accentColor, background: "none", border: "none", cursor: "pointer", fontWeight: 600, padding: 0 }}
                >Open full builder →</button>
              </div>
            </div>

            <p data-testid="mini-canvas-note" style={{ margin: "0 0 6px", fontSize: "0.625rem", lineHeight: 1.45, color: "var(--text-secondary, #888)" }}>
              <strong>Save</strong> turns this canvas into a button below. Drag that button into a working
              session (further down) to attach it there. Your canvas is kept in this browser between visits.
            </p>

            {saved.length > 0 && (
              <div data-testid="saved-canvases" style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 6 }}>
                {saved.map(c => {
                  const snapshot = savedCanvasToSnapshot(c);
                  return (
                    <span
                      key={c.id}
                      draggable
                      title="Drag into a working session"
                      onDragStart={e => {
                        // The same payload an export-tray pill carries, so a working session's canvas
                        // accepts it with no new drop code.
                        e.dataTransfer.setData(EXPORT_ITEM_DRAG_KEY, JSON.stringify(snapshot));
                        // Marks it as a saved canvas so the mini-canvas itself can refuse it.
                        e.dataTransfer.setData(MINI_CANVAS_DRAG_KEY, c.id);
                        e.dataTransfer.effectAllowed = "copy";
                      }}
                      style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "3px 6px 3px 9px", borderRadius: 14, border: `1px solid ${accentColor}`, background: "var(--surface, #fff)", color: textColor, fontSize: "0.6875rem", fontWeight: 600, cursor: "grab" }}
                    >
                      <span aria-hidden>🗂</span>
                      <span>{c.label} <span style={{ fontWeight: 400, opacity: 0.7 }}>({c.nodes.length})</span></span>
                      <button
                        type="button"
                        aria-label={`Remove saved canvas ${c.label}`}
                        onClick={() => removeSaved(c.id)}
                        style={{ background: "none", border: "none", cursor: "pointer", color: "var(--text-secondary, #999)", fontSize: "0.6875rem", padding: "0 2px" }}
                      >✕</button>
                    </span>
                  );
                })}
              </div>
            )}

            <MiniCanvasDropArea
              nodes={nodes}
              selectedId={selectedId}
              onSelect={setSelectedId}
              onDelete={id => { setNodes(p => p.filter(n => n.id !== id)); setSelectedId(null); }}
              onResize={handleResize}
              onOpenEdit={id => { setSelectedId(id); setEditNodeId(id); }}
              onChangeProps={handleChangeProps}
              canvasRef={canvasRef}
              accentColor={accentColor}
              onDropExportItem={handleDropExportItem}
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

// Session-canvas card grid. ROW_PITCH has to clear a card showing a wrapped title
// plus an account name plus a summary plus the 2-row note box.
const SESSION_CARD_ORIGIN = 16;
const SESSION_COL_PITCH = 240; // 220px card + 20px gutter
const SESSION_ROW_PITCH = 210;
const SESSION_COLS = 3;

/**
 * First grid slot not already occupied, so a dropped card can never land on top
 * of one that's already there.
 *
 * The old version used `refs.length` as the slot index, which is a count, not a
 * position: add 3 cards, delete the middle one, and the next drop computed index
 * 2 — the slot the third card is still sitting in. The new card landed exactly on
 * top of it and only the higher z-index was visible. Reading the occupied slots
 * instead also means a deletion leaves a hole that gets refilled.
 */
export function nextFreeSlot(refs: AnnotatedRef[]): { _x: number; _y: number } {
  const slotOf = (r: AnnotatedRef) => {
    const col = Math.round(((r._x ?? SESSION_CARD_ORIGIN) - SESSION_CARD_ORIGIN) / SESSION_COL_PITCH);
    const row = Math.round(((r._y ?? SESSION_CARD_ORIGIN) - SESSION_CARD_ORIGIN) / SESSION_ROW_PITCH);
    return `${col}:${row}`;
  };
  const taken = new Set(refs.map(slotOf));

  for (let row = 0; row < 500; row++) {
    for (let col = 0; col < SESSION_COLS; col++) {
      if (!taken.has(`${col}:${row}`)) {
        return {
          _x: SESSION_CARD_ORIGIN + col * SESSION_COL_PITCH,
          _y: SESSION_CARD_ORIGIN + row * SESSION_ROW_PITCH,
        };
      }
    }
  }
  // Unreachable in practice (1500 slots); place below everything rather than overlap.
  const maxY = refs.reduce((m, r) => Math.max(m, r._y ?? 0), 0);
  return { _x: SESSION_CARD_ORIGIN, _y: maxY + SESSION_ROW_PITCH };
}

const TYPE_COLORS: Record<string, string> = {
  mini_canvas: "#6366f1",
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
  const navigate = useNavigate();
  const color = TYPE_COLORS[item.type] ?? (item.accent ?? "#9ca3af");
  // A saved mini-canvas carries its full contents; offer to reopen it in the builder.
  const savedCanvasNodes = canvasNodesFromSnapshot(item);
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
        ...borderSides(`1.5px solid ${selected ? color : "var(--border, rgba(0,0,0,0.1))"}`, { left: `4px solid ${color}` }),
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
            {/* Wraps instead of `nowrap` + ellipsis, which showed ~23 characters
                in the 220px card — an 80-char account-note title was 70% hidden
                with no way to read the rest. */}
            {item.url ? (
              <a href={item.url} target="_blank" rel="noopener noreferrer"
                style={{ display: "block", fontSize: "0.8125rem", fontWeight: 600, color: "var(--text-primary, #111)", textDecoration: "none", lineHeight: 1.35, overflowWrap: "anywhere" }}>
                {item.label}
              </a>
            ) : (
              <p style={{ margin: 0, fontSize: "0.8125rem", fontWeight: 600, color: "var(--text-primary, #111)", lineHeight: 1.35, overflowWrap: "anywhere" }}>
                {item.label}
              </p>
            )}
            {item.accountName && (
              <p style={{ margin: "2px 0 0", fontSize: "0.6875rem", color: "var(--text-secondary, #aaa)", overflowWrap: "anywhere" }}>
                {item.accountName}
              </p>
            )}
            {savedCanvasNodes && (
              <button
                type="button"
                onMouseDown={e => e.stopPropagation()}
                onClick={e => {
                  e.stopPropagation();
                  // The same single-use handoff the mini-canvas's "Open full builder" uses.
                  try { sessionStorage.setItem(MINI_CANVAS_HANDOFF_KEY, JSON.stringify(savedCanvasNodes)); } catch { /* storage blocked */ }
                  navigate("/edit-preview");
                }}
                style={{ marginTop: 4, fontSize: "0.6875rem", fontWeight: 600, color, background: "none", border: `1px solid ${color}`, borderRadius: 6, padding: "1px 8px", cursor: "pointer" }}
              >Open in builder →</button>
            )}
            {/* The summary was carried on every ref and never rendered. */}
            {item.summary && (
              <p style={{
                margin: "3px 0 0", fontSize: "0.6875rem",
                color: "var(--text-secondary, #888)", lineHeight: 1.45,
                whiteSpace: "pre-wrap", overflowWrap: "anywhere",
              }}>
                {item.summary}
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
  onDropExportItem,
  accentColor,
}: {
  session: WorkingSession | null;
  scratchRefs?: AnnotatedRef[];
  onRefsChange: (refs: AnnotatedRef[]) => void;
  onDropExportItem: (item: ExportItemSnapshot) => void;
  accentColor: string;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: "session-canvas-drop" });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  // Tray pills arrive over HTML5 drag, which dnd-kit's `isOver` cannot see — so
  // the drop highlight needs its own state.
  const [isPillOver, setIsPillOver] = useState(false);
  const refs: AnnotatedRef[] = scratchRefs ?? ((session?.record_refs ?? []) as AnnotatedRef[]);

  // Compute canvas height to fit all cards + some padding. The reserve matches
  // SESSION_ROW_PITCH so a full row of tall cards still fits inside the frame.
  const maxY = refs.reduce((m, r) => Math.max(m, (r._y ?? 0) + SESSION_ROW_PITCH), 420);
  const canvasH = Math.max(420, maxY + 40);

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

  const showDropState = isOver || isPillOver;

  return (
    <div
      ref={setNodeRef}
      onClick={() => setSelectedId(null)}
      data-session-canvas
      data-no-fullscreen
      onDragOver={(e) => {
        if (acceptExportItemDragOver(e)) setIsPillOver(true);
      }}
      onDragLeave={(e) => {
        // dragleave bubbles from every child boundary; ignore the ones that are
        // still inside this canvas or the highlight strobes.
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setIsPillOver(false);
      }}
      onDrop={(e) => {
        const item = readExportItem(e);
        setIsPillOver(false);
        if (!item) return;
        e.preventDefault();
        e.stopPropagation();
        onDropExportItem(item);
      }}
      style={{
        position: "relative",
        height: canvasH,
        backgroundColor: showDropState ? `${accentColor}06` : "var(--bg, #f9f9f9)",
        backgroundImage: "radial-gradient(circle, #AEBBC1 1px, transparent 1px)",
        backgroundSize: "20px 20px",
        border: `1.5px dashed ${showDropState ? accentColor : "var(--border, rgba(0,0,0,0.12))"}`,
        borderRadius: 8,
        // Not `hidden`: a card taller than the height estimate would be clipped
        // with no way to scroll to it.
        overflow: "visible",
        transition: "all 0.15s",
      }}
    >
      {refs.length === 0 && !showDropState && (
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
            Drag them from the export tray
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

  // Called when an export-tray pill is dropped onto the session canvas
  const addRef = useCallback(async (item: ExportItemSnapshot) => {
    if (activeId === "scratch") {
      // Auto-create session on first drop into scratch
      const existing = scratchRefs;
      if (existing.some(r => r.id === item.id)) return;
      const all = [...existing, { ...item, _note: "", ...nextFreeSlot(existing) }];
      setScratchRefs(all);
      // Persist automatically on first item
      await ensureSession(all);
      return;
    }

    if (!activeSession) return;
    const refs = (activeSession.record_refs ?? []) as AnnotatedRef[];
    if (refs.some(r => r.id === item.id)) return;
    const updated = [...refs, { ...item, _note: "", ...nextFreeSlot(refs) }];
    setSessions(prev => prev.map(s => s.id === activeSession.id ? { ...s, record_refs: updated as ExportItemSnapshot[] } : s));
    scheduleSave(activeSession.id, updated);
  }, [activeId, activeSession, scratchRefs, setSessions]);

  // Surface addRef via DOM for parent DndContext
  useEffect(() => {
    const el = document.querySelector("[data-session-adder]") as (HTMLDivElement & { __addRef?: typeof addRef }) | null;
    if (el) el.__addRef = addRef;
  }, [addRef]);

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
              Search for records, add them to the export tray, then drop them on the canvas
            </span>
            {/* Opens the same search modal as Cmd+K; its "Add to export tray" button fills the tray. */}
            <button
              type="button"
              onClick={() => window.dispatchEvent(new CustomEvent("open-global-search"))}
              title="Search records to add to this session"
              style={{
                fontSize: "0.75rem", fontWeight: 600,
                padding: "3px 10px", borderRadius: 6,
                border: `1px solid ${accentColor}`,
                background: accentColor, color: "#fff",
                cursor: "pointer", fontFamily: "var(--font-base)",
              }}
            >🔍 Search</button>
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
              ...borderSides(
                `1px solid ${activeId === "scratch" ? accentColor : "var(--border, rgba(0,0,0,0.08))"}`,
                activeId === "scratch" ? { bottom: "1px solid var(--surface, #fff)" } : {},
              ),
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
                    ...borderSides(
                      `1px solid ${activeId === s.id ? accentColor : "var(--border, rgba(0,0,0,0.08))"}`,
                      activeId === s.id ? { bottom: "1px solid var(--surface, #fff)" } : {},
                    ),
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
          onDropExportItem={addRef}
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
  { id: "jira_tickets",    label: "JIRAs / Engineering Tickets", icon: "🛠" },
  { id: "zendesk_tickets", label: "Zendesk / Support Tickets",   icon: "🎧" },
  { id: "product_gaps",    label: "Product Gaps",    icon: "🧩" },
  { id: "artifacts",       label: "My Artifacts",    icon: "📎" },
  { id: "time_allocation", label: "Time Allocation", icon: "📊" },
  { id: "notepad",         label: "Notepad",         icon: "📝" },
  { id: "mini_canvas",     label: "Mini Canvas",     icon: "⬜" },
  { id: "notifications",   label: "Notifications",   icon: "🔔" },
  { id: "public",          label: "Public",          icon: "🌐" },
] as const;
type SectionTileId = typeof ALL_SECTION_TILES[number]["id"];

/** The cards in the narrow column beside the sections. Orderable and removable like the main ones. */
const SIDE_TILES = [
  { id: "side_action_items", label: "Action Items",        icon: "✅" },
  { id: "side_reminders",    label: "Reminders",           icon: "🔔" },
  { id: "side_comments",     label: "Comments",            icon: "💬" },
  { id: "side_layouts",      label: "Layouts",             icon: "🧱" },
  { id: "side_quick_links",  label: "Quick create & links", icon: "🔗" },
] as const;
type SideSectionId = typeof SIDE_TILES[number]["id"];
const SIDE_KEY = "profileSideSections-v1";
const DEFAULT_SIDE: SideSectionId[] = SIDE_TILES.map(t => t.id);

/**
 * A border on all four edges, optionally with different edges.
 *
 * Never write `border: ...` and `borderLeft: ...` (or `borderBottom`) in the same style object when
 * either can change between renders: React warns "Updating a style property (border) when a
 * conflicting property is set" and can leave a stale edge behind. Longhands for every edge, always.
 */
function borderSides(
  base: string,
  edges: Partial<Record<"top" | "right" | "bottom" | "left", string>> = {},
): CSSProperties {
  return {
    borderTop: edges.top ?? base,
    borderRight: edges.right ?? base,
    borderBottom: edges.bottom ?? base,
    borderLeft: edges.left ?? base,
  };
}

const SECTIONS_KEY = "profileVisibleSections-v1";
const DEFAULT_SECTIONS: SectionTileId[] = ["skills", "accounts", "jira_tickets", "zendesk_tickets", "product_gaps", "artifacts", "time_allocation", "notifications", "public"];

/** The three ticket sections are new; add them once for people who already have a saved layout. */
const TICKET_SECTIONS_SEEN_KEY = "profileTicketSectionsAdded-v1";
const TICKET_SECTION_IDS: SectionTileId[] = ["jira_tickets", "zendesk_tickets", "product_gaps"];
const TICKET_SECTION_KINDS: [SectionTileId, TicketKind][] = [["jira_tickets", "jira"], ["zendesk_tickets", "zendesk"], ["product_gaps", "product_gap"]];

function loadVisibleSections(): SectionTileId[] {
  try {
    const raw = JSON.parse(localStorage.getItem(SECTIONS_KEY) ?? "null");
    if (Array.isArray(raw)) {
      const valid = new Set<string>(ALL_SECTION_TILES.map(t => t.id));
      const ids = raw.filter((id): id is SectionTileId => typeof id === "string" && valid.has(id));
      if (!localStorage.getItem(TICKET_SECTIONS_SEEN_KEY)) {
        // Once only: a person who later removes one of them keeps it removed.
        localStorage.setItem(TICKET_SECTIONS_SEEN_KEY, "1");
        const at = ids.indexOf("accounts");
        const missing = TICKET_SECTION_IDS.filter(id => !ids.includes(id));
        ids.splice(at >= 0 ? at + 1 : ids.length, 0, ...missing);
      }
      return ids;
    }
  } catch { /* corrupt value — fall back to defaults */ }
  return DEFAULT_SECTIONS;
}

function CollapsibleSection({
  title, accentColor, textColor, defaultOpen = true, headerRight, children, full, sectionId,
}: {
  title: string; accentColor: string; textColor: string;
  /** Lets the Page Sections panel find this section to scroll to and glow it. */
  sectionId?: string;
  defaultOpen?: boolean; headerRight?: ReactNode; children: ReactNode;
  /** The full-screen view of this section (double-click the body, or the expand icon at its bottom-right). */
  full?: () => ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const toggle = () => setOpen(v => !v);
  // The header is a row of siblings, not one big <button>: `headerRight` holds real buttons (GET
  // Meeting Notes, + New, remove), and a <button> inside a <button> is invalid HTML (React warns,
  // and browsers disagree about which one a click reaches). The title still takes all the spare
  // width, so the whole left side of the header toggles as before.
  return (
    <section data-section-id={sectionId} style={{ marginBottom: 28 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: open ? 10 : 0, width: "100%" }}>
        <button
          type="button"
          onClick={toggle}
          aria-expanded={open}
          style={{ flex: 1, minWidth: 0, background: "none", border: "none", cursor: "pointer", padding: 0, textAlign: "left" }}
        >
          <span style={{ fontSize: "0.6875rem", fontWeight: 700, letterSpacing: "0.08em", color: textColor, textTransform: "uppercase" }}>
            {title}
          </span>
        </button>
        {headerRight && <span>{headerRight}</span>}
        <button
          type="button"
          onClick={toggle}
          aria-label={`${open ? "Collapse" : "Expand"} ${title}`}
          aria-expanded={open}
          style={{ background: "none", border: "none", cursor: "pointer", padding: 0, display: "flex", flexShrink: 0 }}
        >
          <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke={accentColor} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
            style={{ transition: "transform 0.18s", transform: open ? "rotate(0deg)" : "rotate(-90deg)", flexShrink: 0 }}>
            <path d="M4 6l4 4 4-4"/>
          </svg>
        </button>
      </div>
      {open && (full
        ? <ExpandableSection title={title} accent={accentColor} renderFull={full}>{children}</ExpandableSection>
        : children)}
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
  // The account this note is filed under (null = a general note). A linked note also appears under
  // that account's "Account Notes" on its detail page, visible only to its owner.
  const [accountId, setAccountId] = useState<number | null>(null);
  const [saveStatus, setSaveStatus] = useState<"idle" | "saving" | "saved">("idle");

  useEffect(() => {
    userPageNoteApi.list().then(r => {
      setNotes(r.data);
      if (r.data.length > 0) { setActiveNoteId(r.data[0].id); setContent(r.data[0].content); setAccountId(r.data[0].account ?? null); }
    }).catch(() => {});
  }, []);

  function selectNote(note: UserPageNote) { setActiveNoteId(note.id); setContent(note.content); setAccountId(note.account ?? null); }
  function startNew() { setActiveNoteId("new"); setContent(""); setAccountId(null); }

  /** Save the note as it is now; `nextAccountId` lets the account picker save its own change at once. */
  async function persist(nextAccountId: number | null = accountId) {
    if (!content.trim() && activeNoteId === "new") return;
    setSaveStatus("saving");
    const link = {
      account: nextAccountId,
      account_ref_label: accounts.find(a => a.id === nextAccountId)?.company_name ?? "",
    };
    try {
      if (activeNoteId === "new") {
        const { data } = await userPageNoteApi.create({ content, ...link });
        setNotes(prev => [data, ...prev]); setActiveNoteId(data.id);
      } else {
        const { data } = await userPageNoteApi.update(activeNoteId as number, { content, ...link });
        setNotes(prev => prev.map(n => n.id === data.id ? data : n));
      }
      setSaveStatus("saved"); setTimeout(() => setSaveStatus("idle"), 2000);
    } catch { setSaveStatus("idle"); }
  }
  const handleBlur = () => persist();

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
                {/* content is HTML now, so strip tags before slicing or the tab
                    reads "<p>Hello" instead of "Hello". */}
                {n.account_ref_label || htmlToPreviewText(n.content).slice(0, 20) || "Note"}
              </button>
              <button onClick={() => void deleteNote(n.id)} style={{ padding: "3px 5px", borderRadius: "0 4px 4px 0", ...borderSides(`1px solid ${activeNoteId === n.id ? meta.border : "var(--border, rgba(0,0,0,0.1))"}`, { left: "none" }), background: "transparent", color: "var(--text-secondary, #ccc)", fontSize: "0.625rem", cursor: "pointer" }}>×</button>
            </div>
          ))}
          <button onClick={startNew} style={{ padding: "3px 8px", borderRadius: 4, border: `1px dashed ${activeNoteId === "new" ? meta.border : "var(--border, rgba(0,0,0,0.1))"}`, background: activeNoteId === "new" ? `${meta.border}08` : "transparent", color: "var(--text-secondary, #aaa)", fontSize: "0.75rem", fontFamily: "var(--font-base)", cursor: "pointer" }}>+ new</button>
        </div>
      )}
      <select
        aria-label="Link this note to an account"
        value={accountId ?? ""}
        onChange={e => {
          const next = e.target.value ? Number(e.target.value) : null;
          setAccountId(next);
          void persist(next);
        }}
        style={{ padding: "5px 8px", borderRadius: 6, border: "1px solid var(--border, rgba(0,0,0,0.1))", background: "var(--bg, #f9f9f9)", fontFamily: "var(--font-base)", fontSize: "0.75rem", color: accountId ? "var(--text-primary, #111)" : "var(--text-secondary, #aaa)", marginBottom: 4, outline: "none" }}>
        <option value="">For my page (general note)</option>
        {accounts.map(a => <option key={a.id} value={a.id}>{a.company_name}</option>)}
      </select>
      <p data-testid="notepad-link-hint" style={{ margin: "0 0 8px", fontSize: "0.6875rem", color: "var(--text-secondary, #888)" }}>
        {accountId
          ? <>Also shown under <strong>Account Notes</strong> on {accounts.find(a => a.id === accountId)?.company_name ?? "that account"}'s page. Only you can see it.</>
          : "Link this note to an account and it also appears under that account's Account Notes."}
      </p>
      {/* Rich text so the notepad gets the same @mention / @#record picker the
          rest of the app's note fields have. Still autosaves on blur. */}
      <RichTextMentionEditor
        value={content}
        onChange={setContent}
        onBlur={() => void handleBlur()}
        placeholder="Your notes… (@name to mention, @# to reference a record)"
        minHeightClassName="min-h-[140px]"
      />
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Mini-layouts sidebar (toggle panel)
// ─────────────────────────────────────────────────────────────────────────────

// ─────────────────────────────────────────────────────────────────────────────
// RolePageInner
// ─────────────────────────────────────────────────────────────────────────────

function RolePageInner({ titleRole }: { titleRole: TitleRole }) {
  const meta = ROLE_META[titleRole];
  const currentUser = useCurrentUser();
  const navigate = useNavigate();

  const [skills, setSkills] = useState<ClaudeSkill[]>([]);
  const [openSkill, setOpenSkill] = useState<ClaudeSkill | null>(null);
  const [agentSkills, setAgentSkills] = useState<AgentSkill[]>([]);
  // The saved skill picked in My Skills; the Run Skill bar acts on it.
  const [runSkillId, setRunSkillId] = useState<number | null>(null);
  const runSkill = agentSkills.find(sk => sk.id === runSkillId) ?? null;
  const [runDialogOpen, setRunDialogOpen] = useState(false);
  const [myAccounts, setMyAccounts] = useState<Account[]>([]);
  const [artifacts, setArtifacts] = useState<AccountArtifact[]>([]);
  // Same search / sort / category / creator / linked-to-action-item controls as an account's artifacts.
  const [artifactBrowse, setArtifactBrowse] = useState<ArtifactBrowseState>(DEFAULT_ARTIFACT_BROWSE);
  const [actionItems, setActionItems] = useState<AirtableActionItem[]>([]);
  const [reminders, setReminders] = useState<Reminder[]>([]);
  const [comments, setComments] = useState<Comment[]>([]);
  const [teamMembers, setTeamMembers] = useState<TeamMember[]>([]);
  const [modalItem, setModalItem] = useState<AirtableActionItem | null>(null);
  // Bumped after the modal changes something, so the left-column lists show it.
  const [reloadTick, setReloadTick] = useState(0);
  const { openComments } = useCommentContext();
  const [pinnedLayouts, setPinnedLayouts] = useState<PageLayout[]>([]);
  const [sessions, setSessions] = useState<WorkingSession[]>([]);
  const [layoutSidebarOpen, setLayoutSidebarOpen] = useState(false);
  const [showNewArtifact, setShowNewArtifact] = useState(false);
  const [editArtifact, setEditArtifact] = useState<AccountArtifact | null>(null);
  const [visibleSections, setVisibleSections] = useState<SectionTileId[]>(loadVisibleSections);
  const [sideSections, setSideSections] = useState<SideSectionId[]>(
    () => loadIdList<SideSectionId>(SIDE_KEY, DEFAULT_SIDE) ?? DEFAULT_SIDE,
  );
  useEffect(() => {
    try { localStorage.setItem(SIDE_KEY, JSON.stringify(sideSections)); } catch { /* storage full or blocked */ }
  }, [sideSections]);
  // A section just added from the panel: scroll to it and glow it once it has rendered.
  const pendingReveal = useRef<string | null>(null);
  useEffect(() => {
    const id = pendingReveal.current;
    if (!id) return;
    pendingReveal.current = null;
    const frame = requestAnimationFrame(() => { revealSection(id); });
    return () => cancelAnimationFrame(frame);
  }, [visibleSections, sideSections]);
  useEffect(() => {
    try { localStorage.setItem(SECTIONS_KEY, JSON.stringify(visibleSections)); } catch { /* storage full or blocked */ }
  }, [visibleSections]);
  const [myMemberId, setMyMemberId] = useState<number | null>(null);

  const pageRef = useRef<HTMLDivElement>(null);
  useLogGlow(pageRef);

  useEffect(() => {
    skillsApi.list().then(({ data }) => {
      setSkills(data.results.filter(s => (s.roles ?? []).includes(meta.label)));
    }).catch(() => {});
    agentSkillsApi.list().then(({ data }) => {
      setAgentSkills(data.results.filter(s =>
        s.status === "approved" && ((s.pinned_to_roles ?? []).includes(meta.label) || s.pinned_by_me)));
    }).catch(() => {});
    layoutsApi.listPinned().then(({ data }) => setPinnedLayouts(data)).catch(() => {});
    workingSessionApi.list().then(({ data }) => setSessions(data)).catch(() => {});
  }, [meta.label]);

  useEffect(() => {
    if (!currentUser) return;
    Promise.all([
      teamApi.listMembers({ page_size: "200" }),
      accountsApi.listAccounts({ page_size: "500" }),
      commentsApi.listAll(),
    ]).then(([membersRes, accountsRes, comRes]) => {
      const member = membersRes.data.results.find(m => m.user === currentUser.id) ?? null;
      const accounts = member
        ? accountsRes.data.results.filter(a => (a.team_members ?? []).some((m: { id: number }) => m.id === member.id))
        : [];
      setMyAccounts(accounts);
      setMyMemberId(member?.id ?? null);
      setTeamMembers(membersRes.data.results);
      setComments(comRes.data.results.slice(0, 5));
      // One batched request rather than one per account — a user on many accounts
      // used to fan out enough requests here to trip the backend's 200/min throttle.
      accountsApi.listArtifactsForAccounts(accounts.map(a => a.id))
        .then(r => setArtifacts(r.data))
        .catch(() => setArtifacts([] as AccountArtifact[]));
    }).catch(() => {});
  }, [currentUser, reloadTick]);

  // Action items and reminders change all the time (here, on other pages, from the agent), so they
  // are loaded by their own effect rather than with the one-shot load above, and re-read when the tab
  // regains focus, when any action item is written anywhere in this tab or another, and every 30s.
  // They read the SAME records the rest of the app shows: every In Progress Airtable action item the
  // caller can see (what the Action Items page's In Progress column lists - not only ones assigned to
  // them, and not the agent's separate `scheduler` follow-ups) and reminders by due date (a reminder that has already fired is
  // "sent", so asking only for "pending" dropped everything due earlier today).
  useEffect(() => {
    if (!currentUser) return;
    let alive = true;
    const refresh = () => {
      airtableApi.listActionItems({ status: "In Progress", page_size: "500" })
        .then(r => { if (alive) setActionItems(r.data); }).catch(() => {});
      const { from, to } = reminderWindow(new Date());
      schedulerApi.listReminders({ due_before: to.toISOString(), ordering: "-due_at" })
        .then(r => { if (alive) setReminders(r.data.results.filter(x => visibleReminder(x, from, to))); })
        .catch(() => {});
    };
    refresh();
    const onStorage = (e: StorageEvent) => { if (e.key === ACTION_ITEMS_UPDATED_KEY) refresh(); };
    const onVisible = () => { if (document.visibilityState === "visible") refresh(); };
    window.addEventListener("storage", onStorage);
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", onVisible);
    const timer = window.setInterval(() => { if (document.visibilityState === "visible") refresh(); }, PROFILE_REFRESH_MS);
    return () => {
      alive = false;
      window.removeEventListener("storage", onStorage);
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", onVisible);
      window.clearInterval(timer);
    };
  }, [currentUser]);

  useEffect(() => { setOpenSkill(null); }, [titleRole]);

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

  const nearReminders = reminders;
  const accountNameOf = (a: AccountArtifact) => myAccounts.find(x => x.id === a.account)?.company_name ?? "";
  const artifactGroups = useMemo(
    () => browseArtifacts(artifacts, artifactBrowse, accountNameOf),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [artifacts, artifactBrowse, myAccounts],
  );

  const initials = currentUser
    ? (currentUser.display_name || currentUser.username || currentUser.email || "?")
        .split(" ").map(n => n[0]).join("").toUpperCase().slice(0, 2)
    : "?";

  // SVG icons for quick-create row
  // The same icons the Artifacts panel shows for these services, so a "+ Google Doc" row and a
  // Google Doc artifact look alike.
  const qIcon = (key: string) => <ArtifactIconImg entry={CATALOG_BY_KEY[key]} size={16} />;
  const gdocsIcon = qIcon("google_docs");
  const sheetIcon = qIcon("google_sheets");
  const slidesIcon = qIcon("google_slides");
  const jiraIcon = qIcon("jira");
  const figmaIcon = qIcon("figma");
  const notionIcon = qIcon("notion");
  const lucidIcon = qIcon("lucidchart");

  // ── Full-screen content ────────────────────────────────────────────────────
  // Each section can open full screen (double-click, or the icon at its bottom-right). The panel is a
  // list of cards, one per record; a card opens to show everything about the record.
  const accent = meta.border;
  const quickLinks = useQuickLinks();
  const cardBtn: CSSProperties = { fontSize: "0.8125rem", fontWeight: 600, color: accent, background: "none", border: `1px solid ${accent}55`, borderRadius: 6, padding: "4px 10px", cursor: "pointer", textDecoration: "none" };

  const actionItemCards: FullCard[] = actionItems.map(ai => ({
    id: ai.id,
    title: ai.task,
    subtitle: [ai.account_name, ai.priority, ai.due_date ? `Due ${fmtDateTime(ai.due_date)}` : ""].filter(Boolean).join(" · "),
    fields: fieldsOf(ai, {
      html: ["task_details"],
      seconds: ["estimated_time", "time_spent", "tracked_time", "prep_time"],
      hide: ["id", "account", "reminder", "reminder_id", "linked_meeting"],
    }),
    actions: <button type="button" style={cardBtn} onClick={() => setModalItem(ai)}>Open action item</button>,
  }));
  const reminderCards: FullCard[] = nearReminders.map(r => ({
    id: r.id,
    title: r.title,
    subtitle: [r.due_at ? fmtDateTime(r.due_at) : "", r.status].filter(Boolean).join(" · "),
    fields: fieldsOf(r, { html: ["body"], hide: ["id", "created_by", "recipients", "links", "occurrences", "resource_id"] }),
  }));
  const commentCards: FullCard[] = comments.map(c => ({
    id: c.id,
    title: c.author_display,
    subtitle: c.resource_label,
    fields: fieldsOf(c, { hide: ["id", "author", "resource_id", "replies", "references", "mentions"] }),
    actions: (
      <button type="button" style={cardBtn}
        onClick={e => openComments({ resourceType: c.resource_type, resourceId: c.resource_id, resourceLabel: c.resource_label, x: e.clientX, y: e.clientY })}>
        Open conversation
      </button>
    ),
  }));
  const layoutCards: FullCard[] = pinnedLayouts.map(l => ({
    id: l.id,
    title: l.name,
    subtitle: l.is_public ? "Public layout" : "Private layout",
    fields: fieldsOf(l, { hide: ["id", "nodes", "creator", "forked_from"] }),
    actions: <Link to={`/edit-preview?layout=${l.id}`} style={cardBtn}>Open in Page Builder</Link>,
  }));
  const accountCards: FullCard[] = myAccounts.map(a => ({
    id: a.id,
    title: a.company_name,
    subtitle: a.industry ?? undefined,
    fields: fieldsOf(a, { hide: ["id"] }),
    actions: <Link to={`/accounts/${a.id}`} style={cardBtn}>Open account</Link>,
  }));
  const skillCards: FullCard[] = [
    ...skills.map(sk => ({
      id: `s-${sk.id}`, title: sk.name, subtitle: sk.status.replace("_", " "),
      fields: fieldsOf(sk, { hide: ["id"] }),
    })),
    ...agentSkills.map(sk => ({
      id: `a-${sk.id}`, title: sk.name.replace(/-/g, " ").replace(/\b\w/g, ch => ch.toUpperCase()), subtitle: sk.description,
      fields: fieldsOf(sk, { hide: ["id"] }),
    })),
  ];
  const BUILT_IN_LINKS = [
    ["Google Doc", "https://docs.google.com/document/create"], ["Google Sheet", "https://sheets.google.com/create"],
    ["Google Slides", "https://slides.google.com/create"], ["JIRA", "https://jira.atlassian.com"],
    ["Figma", "https://www.figma.com"], ["Notion", "https://www.notion.so"], ["Lucidchart", "https://lucid.app/documents"],
  ] as const;
  const quickLinkCards: FullCard[] = [
    ...BUILT_IN_LINKS.map(([label, url]) => ({
      id: `b-${label}`, title: `+ ${label}`, subtitle: "Creates a new file",
      fields: [{ label: "Kind", value: "Built-in" }, { label: "URL", value: url }],
      actions: <a href={url} target="_blank" rel="noopener noreferrer" style={cardBtn}>Open</a>,
    })),
    ...quickLinks.links.map(l => ({
      id: `u-${l.id}`, title: l.label, subtitle: "Your link",
      fields: [{ label: "Kind", value: "Your link" }, { label: "URL", value: l.url }],
      actions: <a href={l.url} target="_blank" rel="noopener noreferrer" style={cardBtn}>Open</a>,
    })),
  ];
  const sessionCards: FullCard[] = sessions.map(sess => ({
    id: sess.id,
    title: sess.name,
    subtitle: `${sess.record_refs?.length ?? 0} record${(sess.record_refs?.length ?? 0) === 1 ? "" : "s"} · updated ${fmtDateTime(sess.updated_at)}`,
    fields: [
      ...fieldsOf(sess, { hide: ["id", "owner", "canvas_nodes", "record_refs"] }),
      { label: "Records", value: (sess.record_refs ?? []).length ? (sess.record_refs ?? []).map(r => r.label).join(", ") : "—" },
      { label: "Canvas components", value: String((sess.canvas_nodes ?? []).length) },
    ],
  }));
  const artifactFull = () => (
    <>
      <ArtifactBrowseBar artifacts={artifacts} state={artifactBrowse} onChange={setArtifactBrowse} />
      <CardList
        accent={accent}
        empty={artifacts.length ? "No artifacts match your search." : "No artifacts yet."}
        cards={artifactGroups.flatMap(g => g.items).map(a => ({
          id: a.id,
          title: a.name,
          subtitle: [accountNameOf(a) || "No account", a.uploaded_by_username].filter(Boolean).join(" · "),
          fields: fieldsOf(a, { html: ["description"], hide: ["id", "account", "uploaded_by", "references"], labels: { uploaded_by_username: "Added by" } }),
          actions: (
            <>
              {(a.url ?? a.file_url) && <a href={(a.url ?? a.file_url) as string} target="_blank" rel="noopener noreferrer" style={cardBtn}>Open</a>}
              <button type="button" style={cardBtn} onClick={() => setEditArtifact(a)}>Edit</button>
            </>
          ),
        }))}
      />
    </>
  );
  const listFull = (cards: FullCard[], empty: string) => () => <CardList cards={cards} accent={accent} empty={empty} />;

  function renderSection(id: SectionTileId) {
    const removeBtn = (
      <button onClick={() => removeSection(id)} style={{ background: "none", border: "none", cursor: "pointer", color: "var(--text-secondary, #ccc)", fontSize: "0.75rem", padding: "2px 4px" }}>✕</button>
    );

    switch (id) {
      case "skills": return (
        <CollapsibleSection key="skills" sectionId="skills" title="My Skills" accentColor={meta.border} textColor={meta.text} full={listFull(skillCards, "No skills yet.")} headerRight={
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
          {skills.length === 0 && agentSkills.length === 0 ? (
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
              {agentSkills.map(skill => {
                const picked = runSkillId === skill.id;
                return (
                  <button
                    key={`a-${skill.id}`}
                    type="button"
                    aria-pressed={picked}
                    title={skill.description}
                    onClick={() => setRunSkillId(picked ? null : skill.id)}
                    style={{ display: "inline-flex", alignItems: "center", gap: 8, padding: "8px 16px", borderRadius: 8, fontSize: "0.8125rem", fontWeight: 600, fontFamily: "var(--font-base)", cursor: "pointer", transition: "all 0.12s", border: picked ? `2px solid ${meta.border}` : "2px solid var(--border, rgba(0,0,0,0.10))", background: picked ? meta.bg : "var(--bg, #f9f9f9)", color: picked ? meta.text : "var(--text-primary, #111)" }}
                  >
                    {skill.name.replace(/-/g, " ").replace(/\b\w/g, c => c.toUpperCase())}
                  </button>
                );
              })}
              {/* Skill first, then the action: pick a skill above, then use it in chat or a voice session. */}
              {agentSkills.length > 0 && (
                <div role="group" aria-label="Run Skill" data-testid="run-skill-bar"
                  style={{ flexBasis: "100%", display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", marginTop: 6, paddingTop: 12, borderTop: "1px solid var(--border, rgba(0,0,0,0.08))" }}>
                  <button
                    type="button"
                    disabled={!runSkill}
                    title={runSkill ? "Choose accounts and add a request, then run it in chat" : "Select a skill first"}
                    onClick={() => setRunDialogOpen(true)}
                    style={{ display: "inline-flex", alignItems: "center", gap: 6, fontFamily: "var(--font-base)", fontWeight: 700, fontSize: "0.875rem", padding: "7px 18px", borderRadius: 7, border: "none", cursor: runSkill ? "pointer" : "not-allowed", background: runSkill ? meta.border : "rgba(0,0,0,0.07)", color: runSkill ? "#fff" : "var(--text-secondary, #aaa)" }}
                  >
                    <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor" aria-hidden><polygon points="5 3 19 12 5 21 5 3" /></svg>
                    Run Skill
                  </button>
                  <span data-testid="run-skill-selected" style={{ fontSize: "0.75rem", color: "var(--text-secondary, #888)" }}>
                    {runSkill ? runSkill.name.replace(/-/g, " ").replace(/\b\w/g, c => c.toUpperCase()) : "Select a skill above"}
                  </span>
                  <SkillLaunchButtons
                    source={runSkill ? { kind: "agent-skill", skill: runSkill } : { kind: "text", title: "", chatText: "" }}
                    disabled={!runSkill}
                    disabledReason="Select a skill first"
                  />
                </div>
              )}
              {runDialogOpen && runSkill && <SkillRunDialog skill={runSkill} mode="chat" onClose={() => setRunDialogOpen(false)} />}
            </div>
          )}
        </CollapsibleSection>
      );

      case "accounts": return (
        <CollapsibleSection key="accounts" sectionId="accounts" title={`My Accounts${myAccounts.length ? ` (${myAccounts.length})` : ""}`} accentColor={meta.border} textColor={meta.text} full={listFull(accountCards, "No accounts linked to your profile yet.")} headerRight={removeBtn}>
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

      case "jira_tickets":
      case "zendesk_tickets":
      case "product_gaps": {
        const kind: TicketKind = id === "jira_tickets" ? "jira" : id === "zendesk_tickets" ? "zendesk" : "product_gap";
        return (
          <CollapsibleSection key={id} sectionId={id} title={TICKET_KIND_TITLE[kind]} accentColor={meta.border} textColor={meta.text}
            full={() => <TicketsFull kind={kind} accent={meta.border} />} headerRight={removeBtn}>
            <ProfileTicketsSection kind={kind} accounts={myAccounts} />
          </CollapsibleSection>
        );
      }

      case "artifacts": return (
        <CollapsibleSection key="artifacts" sectionId="artifacts" title={`My Artifacts${artifacts.length ? ` (${artifacts.length})` : ""}`} accentColor={meta.border} textColor={meta.text} defaultOpen={false} full={artifactFull} headerRight={
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
            <div style={{ background: "var(--surface, #fff)", border: "1px solid var(--border, rgba(0,0,0,0.08))", borderRadius: 10, padding: 12 }}>
              <ArtifactBrowseBar artifacts={artifacts} state={artifactBrowse} onChange={setArtifactBrowse} />
              {artifactGroups.length === 0 && (
                <p data-testid="artifact-no-match" style={{ margin: 0, fontSize: "0.75rem", fontStyle: "italic", color: "var(--text-secondary, #888)" }}>No artifacts match your search.</p>
              )}
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", gap: 8 }}>
              {artifactGroups.flatMap(g => [
                ...(g.label ? [{ heading: g.label, count: g.items.length } as const] : []),
                ...g.items,
              ]).map(row => {
                if ("heading" in row) {
                  return (
                    <p key={`h-${row.heading}`} data-testid="artifact-group-heading" style={{ gridColumn: "1 / -1", margin: "6px 0 0", fontSize: "0.75rem", fontWeight: 600, color: "var(--text-secondary, #666)" }}>
                      {row.heading} <span style={{ fontWeight: 400 }}>({row.count})</span>
                    </p>
                  );
                }
                const artifact = row;
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
            </div>
          )}
        </CollapsibleSection>
      );

      case "time_allocation": return (
        <CollapsibleSection key="time_allocation" sectionId="time_allocation" title="Time Allocation" accentColor={meta.border} textColor={meta.text} full={() => <TimeAllocationPanel showCards accent={meta.border} />} headerRight={removeBtn}>
          <div style={{ background: "var(--surface, #fff)", borderRadius: 10, border: "1px solid var(--border, rgba(0,0,0,0.08))", padding: "4px 20px 16px" }}>
            <TimeAllocationPanel />
          </div>
        </CollapsibleSection>
      );

      case "notepad": return (
        <ExpandableSection key="notepad" sectionId="notepad" title="Notepad" accent={accent} style={{ marginBottom: 28 }} renderFull={() => <NotepadFull accent={accent} />}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
            <span style={{ fontSize: "0.6875rem", fontWeight: 700, letterSpacing: "0.08em", color: meta.text, textTransform: "uppercase" }}>Notepad</span>
            {removeBtn}
          </div>
          <NotepadSection meta={meta} accounts={myAccounts} />
        </ExpandableSection>
      );

      case "mini_canvas": return (
        <ExpandableSection key="mini_canvas" sectionId="mini_canvas" title="Mini Canvas" accent={accent} style={{ marginBottom: 28 }} renderFull={() => <MiniCanvasFullView accent={accent} />}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
            <span style={{ fontSize: "0.6875rem", fontWeight: 700, letterSpacing: "0.08em", color: meta.text, textTransform: "uppercase" }}>Mini Canvas</span>
            {removeBtn}
          </div>
          <MiniCanvasPanel accentColor={meta.border} textColor={meta.text} />
        </ExpandableSection>
      );

      case "notifications": return (
        <CollapsibleSection key="notifications" sectionId="notifications" title="Notifications" accentColor={meta.border} textColor={meta.text} full={() => <NotificationsFull accent={meta.border} />} headerRight={removeBtn}>
          <NotificationsSection accent={meta} />
        </CollapsibleSection>
      );

      case "public": return (
        <CollapsibleSection key="public" sectionId="public" title="Public" accentColor={meta.border} textColor={meta.text} full={myMemberId === null ? listFull([], "Your profile isn't linked to a team member yet.") : () => <PublicFull memberId={myMemberId} accent={meta.border} />} headerRight={removeBtn}>
          <p style={{ margin: "0 0 10px", fontSize: "0.75rem", color: "var(--text-secondary, #888)" }}>What others see when they open your profile from the Team page.</p>
          {myMemberId === null
            ? <p style={{ fontSize: "0.8125rem", color: "var(--text-secondary, #888)" }}>Your profile isn't linked to a team member yet, so it can't have a public page.</p>
            : <PublicSection memberId={myMemberId} personName={currentUser?.display_name || currentUser?.username || ""} personEmail={currentUser?.email ?? ""} isSelf accent={meta} />}
        </CollapsibleSection>
      );

      default: return null;
    }
  }

  // The side-column cards, keyed by id so the page can show them in the user's order.
  const sideBlocks: Record<SideSectionId, ReactNode> = {
    side_action_items: (
                <ExpandableSection key="side_action_items" sectionId="side_action_items" title="Action Items (In Progress)" accent={accent} renderFull={listFull(actionItemCards, "No action items in progress.")} style={{ background: "var(--surface, #fff)", border: "1px solid var(--border, rgba(0,0,0,0.08))", borderRadius: 12, padding: 14, marginBottom: 12 }}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
                    <span style={{ fontSize: "0.6875rem", fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: meta.text }}>
                      ACTION ITEMS <span style={{ fontWeight: 400, color: "var(--text-secondary, #888)", textTransform: "none", letterSpacing: 0 }}>In Progress</span>
                    </span>
                    <NewBadge onClick={() => window.dispatchEvent(new CustomEvent("open-new-action-item"))} />
                  </div>
                  {actionItems.length === 0
                    ? <p style={{ margin: 0, fontSize: "0.75rem", color: "var(--text-secondary, #aaa)", fontStyle: "italic" }}>No action items in progress.</p>
                    : (
                      // Five rows in view; the rest scroll.
                      <div data-testid="action-items-scroll" style={{ maxHeight: ACTION_ITEMS_VISIBLE * (ACTION_ROW_PX + ACTION_ROW_GAP_PX) - ACTION_ROW_GAP_PX, overflowY: "auto" }}>
                        {actionItems.map(ai => (
                          <button key={ai.id} type="button" onClick={() => setModalItem(ai)} title={ai.task}
                            style={{ display: "block", width: "100%", boxSizing: "border-box", height: ACTION_ROW_PX, textAlign: "left", cursor: "pointer", fontFamily: "inherit", color: "inherit", padding: "0 10px", borderRadius: 8, marginBottom: ACTION_ROW_GAP_PX, background: "var(--bg, #f9f9f9)", border: "1px solid var(--border, rgba(0,0,0,0.06))", fontSize: "0.8125rem", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                            {ai.task}
                          </button>
                        ))}
                      </div>
                    )
                  }
                </ExpandableSection>

                
    ),
    side_reminders: (
                <ExpandableSection key="side_reminders" sectionId="side_reminders" title="Reminders (Today / Tomorrow)" accent={accent} renderFull={listFull(reminderCards, "No reminders due soon.")} style={{ background: "var(--surface, #fff)", border: "1px solid var(--border, rgba(0,0,0,0.08))", borderRadius: 12, padding: 14, marginBottom: 12 }}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
                    <span style={{ fontSize: "0.6875rem", fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: meta.text }}>
                      REMINDERS <span style={{ fontWeight: 400, color: "var(--text-secondary, #888)", textTransform: "none", letterSpacing: 0 }}>Today / Tomorrow</span>
                    </span>
                    <NewBadge onClick={() => window.dispatchEvent(new CustomEvent("open-new-reminder"))} />
                  </div>
                  {nearReminders.length === 0
                    ? <p style={{ margin: 0, fontSize: "0.75rem", color: "var(--text-secondary, #aaa)", fontStyle: "italic" }}>No reminders due soon.</p>
                    : <div data-testid="reminders-scroll" style={{ maxHeight: ACTION_ITEMS_VISIBLE * 42, overflowY: "auto" }}>{nearReminders.map(r => <div key={r.id} style={{ padding: "7px 10px", borderRadius: 8, marginBottom: 6, background: "var(--bg, #f9f9f9)", border: "1px solid var(--border, rgba(0,0,0,0.06))", fontSize: "0.8125rem", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={r.title}>{r.title}</div>)}</div>
                  }
                </ExpandableSection>

                
    ),
    side_comments: (
                <ExpandableSection key="side_comments" sectionId="side_comments" title="Comments" accent={accent} renderFull={listFull(commentCards, "No recent comments.")} style={{ background: "var(--surface, #fff)", border: "1px solid var(--border, rgba(0,0,0,0.08))", borderRadius: 12, padding: 14, marginBottom: 12 }}>
                  <div style={{ marginBottom: 10 }}>
                    <span style={{ fontSize: "0.6875rem", fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: meta.text }}>COMMENTS</span>
                  </div>
                  {comments.length === 0
                    ? <p style={{ margin: 0, fontSize: "0.75rem", color: "var(--text-secondary, #aaa)", fontStyle: "italic" }}>No recent comments.</p>
                    : comments.slice(0, 3).map(c => (
                      <button key={c.id} type="button"
                        title={c.resource_label ? `Open the conversation on ${c.resource_label}` : "Open this conversation"}
                        onClick={e => openComments({ resourceType: c.resource_type, resourceId: c.resource_id, resourceLabel: c.resource_label, x: e.clientX, y: e.clientY })}
                        style={{ display: "-webkit-box", width: "100%", textAlign: "left", cursor: "pointer", fontFamily: "inherit", padding: "7px 10px", borderRadius: 8, marginBottom: 6, background: "var(--bg, #f9f9f9)", border: "1px solid var(--border, rgba(0,0,0,0.06))", fontSize: "0.75rem", color: "var(--text-secondary, #555)", overflow: "hidden", WebkitLineClamp: 2, WebkitBoxOrient: "vertical" }}>
                        <span style={{ fontWeight: 600, color: "var(--text-primary, #111)", marginRight: 4 }}>{c.author_display}:</span>{c.content}
                      </button>
                    ))
                  }
                </ExpandableSection>

                
    ),
    side_layouts: (
                <ExpandableSection key="side_layouts" sectionId="side_layouts" title="Layouts" accent={accent} renderFull={listFull(layoutCards, "No pinned layouts.")} style={{ background: "var(--surface, #fff)", border: "1px solid var(--border, rgba(0,0,0,0.08))", borderRadius: 12, padding: 14, marginBottom: 24 }}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
                    <span style={{ fontSize: "0.6875rem", fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: meta.text }}>LAYOUTS</span>
                    <Link to="/edit-preview" style={{ fontSize: "0.6875rem", color: meta.border, textDecoration: "none", fontWeight: 600 }}>View all →</Link>
                  </div>
                  {pinnedLayouts.length === 0
                    ? <p style={{ margin: 0, fontSize: "0.75rem", color: "var(--text-secondary, #aaa)", fontStyle: "italic" }}>Pin from <Link to="/edit-preview" style={{ color: meta.border }}>Page Builder</Link>.</p>
                    : pinnedLayouts.slice(0, 4).map(l => (
                      <Link key={l.id} to={`/edit-preview?layout=${l.id}`} style={{ textDecoration: "none", display: "block", marginBottom: 5 }}>
                        <div style={{ padding: "7px 10px", borderRadius: 8, background: "var(--bg, #f9f9f9)", border: "1px solid var(--border, rgba(0,0,0,0.06))", fontSize: "0.8125rem", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{l.name}</div>
                      </Link>
                    ))
                  }
                </ExpandableSection>

                
    ),
    side_quick_links: (
                <ExpandableSection key="side_quick_links" sectionId="side_quick_links" title="Quick create & links" accent={accent} renderFull={listFull(quickLinkCards, "No links.")} style={{ background: "var(--surface, #fff)", border: "1px solid var(--border, rgba(0,0,0,0.08))", borderRadius: 12, padding: "10px 4px" }}>
                  <QuickCreateRow icon={gdocsIcon}  label="+ Google Doc"    href="https://docs.google.com/document/create" />
                  <QuickCreateRow icon={sheetIcon}  label="+ Google Sheet"  href="https://sheets.google.com/create" />
                  <QuickCreateRow icon={slidesIcon} label="+ Google Slides" href="https://slides.google.com/create" />
                  <QuickCreateRow icon={jiraIcon}   label="+ JIRA"          href="https://jira.atlassian.com" />
                  <QuickCreateRow icon={figmaIcon}  label="+ Figma"         href="https://www.figma.com" />
                  <QuickCreateRow icon={notionIcon} label="+ Notion"        href="https://www.notion.so" />
                  <QuickCreateRow icon={lucidIcon}  label="+ Lucidchart"    href="https://lucid.app/documents" />
                  {/* The user's own links and the input to add one — kept at the bottom of this list. */}
                  <QuickLinks accent={meta.border} />
                </ExpandableSection>
    ),
  };

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

            <TicketsToReview kinds={TICKET_SECTION_KINDS.filter(([sid]) => !visibleSections.includes(sid)).map(([, k]) => k)} />

            {/* Two-column layout */}
            <div style={{ display: "flex", gap: 24, alignItems: "flex-start" }}>

              {/* Side column: cards in the order chosen in the Page Sections panel; hidden when empty. */}
              {sideSections.length > 0 && (
                <div style={{ width: 260, flexShrink: 0 }}>
                  {sideSections.map(id => sideBlocks[id])}
                </div>
              )}

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

              </div>
            </div>

            {/* Full-width rows. They sit below the two columns rather than inside the right one, so
                the Notepad / Components row and the Working Sessions canvas get the whole content
                width (including the space under the left column) instead of being squeezed beside it. */}
            {/* Notepad + Mini canvas (default always-visible row if not in visibleSections) */}
            {!visibleSections.includes("notepad") && !visibleSections.includes("mini_canvas") && (
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 28, marginTop: 4 }}>
                <ExpandableSection title="Notepad" accent={accent} renderFull={() => <NotepadFull accent={accent} />}>
                  <NotepadSection meta={meta} accounts={myAccounts} />
                </ExpandableSection>
                <ExpandableSection title="Mini Canvas" accent={accent} renderFull={() => <MiniCanvasFullView accent={accent} />}>
                  <MiniCanvasPanel accentColor={meta.border} textColor={meta.text} />
                </ExpandableSection>
              </div>
            )}

            {/* Working sessions */}
            <ExpandableSection title="Working Sessions" accent={accent} renderFull={listFull(sessionCards, "No working sessions yet.")}>
              <WorkingSessionsArea
                sessions={sessions}
                setSessions={setSessions}
                accentColor={meta.border}
                textColor={meta.text}
                currentUser={currentUser}
              />
            </ExpandableSection>
          </div>
        </div>

        {openSkill && <SkillRunSidebar skill={openSkill} meta={meta} onClose={() => setOpenSkill(null)} />}

        <PageSectionsPanel
          open={layoutSidebarOpen}
          onClose={() => setLayoutSidebarOpen(false)}
          accent={meta.border}
          text={meta.text}
          main={{ tiles: ALL_SECTION_TILES, order: visibleSections, onChange: next => setVisibleSections(next as SectionTileId[]) }}
          side={{ tiles: SIDE_TILES, order: sideSections, onChange: next => setSideSections(next as SideSectionId[]) }}
          onReveal={id => { revealSection(id); }}
          onAdded={id => { pendingReveal.current = id; }}
        />
      </div>

      {modalItem && (
        <ActionItemModal
          item={modalItem}
          teamMembers={teamMembers}
          onClose={() => setModalItem(null)}
          onUpdated={() => { setModalItem(null); setReloadTick(t => t + 1); }}
          onDeleted={() => { setModalItem(null); setReloadTick(t => t + 1); }}
          onConverted={() => { setModalItem(null); setReloadTick(t => t + 1); }}
        />
      )}

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
// Page entry: your own page, or someone else's public page
// ─────────────────────────────────────────────────────────────────────────────

function OwnProfile() {
  const currentUser = useCurrentUser();
  // The accent colours and role-pinned skills follow the user's title. Titles that map
  // to no role-page (engineering, other) still get the "other" palette rather than a redirect.
  const titleRole = getTitleRole(currentUser?.title);
  return <RolePageInner titleRole={titleRole} />;
}

function OtherProfile({ memberId }: { memberId: number }) {
  const [profile, setProfile] = useState<MemberPublicProfile | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setProfile(null); setFailed(false);
    memberProfileApi.get(memberId).then(({ data }) => setProfile(data)).catch(() => setFailed(true));
  }, [memberId]);

  if (failed) return <div className="p-8 text-sm">That profile could not be found. <Link to="/team" style={{ textDecoration: "underline" }}>Back to Team</Link></div>;
  if (!profile) return <div className="p-8 text-sm">Loading…</div>;
  if (profile.is_self) return <Navigate to="/profile" replace />;

  const meta = ROLE_META[getTitleRole(profile.title)];
  const initials = profile.full_name.split(" ").map(n => n[0]).join("").toUpperCase().slice(0, 2);
  return (
    <div className="h-full overflow-auto px-6 pt-8 pb-4">
      <div className="max-w-3xl mx-auto">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <Link to="/team" style={{ fontSize: "0.75rem", color: meta.border, textDecoration: "none", fontWeight: 600 }}>← Team</Link>
          <Link to={`/team?member=${profile.id}`} style={{ fontSize: "0.75rem", color: "var(--text-secondary, #666)", textDecoration: "none" }}>Manage (accounts, docs, edit)</Link>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 16, margin: "12px 0 24px" }}>
          {profile.avatar_url
            ? <img src={profile.avatar_url} alt={profile.full_name} style={{ width: 56, height: 56, borderRadius: 14, objectFit: "cover" }} />
            : <div style={{ width: 56, height: 56, borderRadius: 14, background: meta.bg, color: meta.text, display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 700 }}>{initials}</div>}
          <div>
            <h1 style={{ margin: 0, fontSize: "1.375rem", fontWeight: 700, color: "var(--twilio-navy, #0d1b2e)" }}>{profile.full_name}</h1>
            <p style={{ margin: "2px 0 0", fontSize: "0.8125rem", color: "var(--text-secondary, #666)" }}>
              {[profile.title, profile.department].filter(Boolean).join(" · ")}
            </p>
          </div>
        </div>
        <CollapsibleSection title="Public" accentColor={meta.border} textColor={meta.text} full={() => <PublicFull memberId={profile.id} accent={meta.border} />}>
          <PublicSection memberId={profile.id} personName={profile.full_name} personEmail={profile.email} isSelf={false} accent={meta} />
        </CollapsibleSection>
      </div>
    </div>
  );
}

/** Local start of today through the end of tomorrow: what "Today / Tomorrow" means. */
export function reminderWindow(now: Date): { from: Date; to: Date } {
  const from = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const to = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 2);
  to.setMilliseconds(-1);
  return { from, to };
}

/**
 * On the list when the reminder is due, or on the calendar, today or tomorrow (fired or not). A
 * reminder due last month with a calendar block today counts - it is on today's calendar. Anything
 * still waiting (pending/snoozed) that is overdue stays too. Dismissed ones never show.
 */
export function visibleReminder(
  r: Pick<Reminder, "status" | "due_at" | "occurrences">, from: Date, to: Date = new Date(8.64e15),
): boolean {
  if (r.status === "dismissed") return false;
  if (reminderTimes(r as Reminder).some(t => t >= from && t <= to)) return true;
  return (r.status === "pending" || r.status === "snoozed") && !!r.due_at && new Date(r.due_at) < from;
}

/** Action items in view before the list scrolls, and the pixel size of a row. */
const ACTION_ITEMS_VISIBLE = 5;
const ACTION_ROW_PX = 36;
const ACTION_ROW_GAP_PX = 6;

/** How often the action-item and reminder lists re-read while the tab is visible. */
const PROFILE_REFRESH_MS = 30_000;

export default function ProfilePage() {
  const { memberId } = useParams<{ memberId: string }>();
  if (memberId === undefined) return <OwnProfile />;
  const id = Number(memberId);
  if (!Number.isInteger(id) || id <= 0) return <Navigate to="/team" replace />;
  return <OtherProfile memberId={id} />;
}
