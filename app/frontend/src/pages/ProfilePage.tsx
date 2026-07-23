import { useEffect, useRef, useState } from "react";
import { NavLink } from "react-router-dom";
import { DndContext, useDroppable } from "@dnd-kit/core";
import {
  accountsApi,
  agentSkillsApi,
  layoutsApi,
  schedulerApi,
  teamApi,
  userPageNoteApi,
  workingSessionApi,
} from "../lib/api";
import type {
  Account,
  ActionItem,
  AgentSkill,
  ExportItemSnapshot,
  PageLayout,
  Reminder,
  UserPageNote,
  UserProfile,
  WorkingSession,
} from "../types";

// ─── Shared style helpers ─────────────────────────────────────────────────────

const CARD: React.CSSProperties = {
  background: "var(--card-bg, #fff)",
  borderRadius: 8,
  border: "1px solid var(--border-color, #e5e7eb)",
  padding: 16,
};

const SECTION_HEADER: React.CSSProperties = {
  fontSize: "0.8125rem",
  fontWeight: 700,
  fontFamily: "var(--font-base)",
  color: "var(--twilio-navy, #001489)",
  marginBottom: 8,
  textTransform: "uppercase",
  letterSpacing: "0.05em",
};

function statusColor(status: string): string {
  switch (status) {
    case "active": return "#22c55e";
    case "prospect": return "#3b82f6";
    case "inactive": return "#9ca3af";
    case "churned": return "#ef4444";
    case "pending": return "#f59e0b";
    case "sent": return "#3b82f6";
    case "dismissed": return "#9ca3af";
    case "snoozed": return "#a78bfa";
    default: return "#9ca3af";
  }
}

function StatusBadge({ status }: { status: string }) {
  return (
    <span style={{
      display: "inline-block",
      padding: "1px 7px",
      borderRadius: 12,
      fontSize: "0.6875rem",
      fontWeight: 600,
      background: statusColor(status) + "22",
      color: statusColor(status),
      textTransform: "capitalize",
    }}>
      {status}
    </span>
  );
}

function PriorityDot({ priority }: { priority: string }) {
  const colors: Record<string, string> = {
    urgent: "#ef4444",
    high: "#f97316",
    normal: "#3b82f6",
    low: "#9ca3af",
  };
  return (
    <span style={{
      display: "inline-block",
      width: 8,
      height: 8,
      borderRadius: "50%",
      background: colors[priority] ?? "#9ca3af",
      flexShrink: 0,
    }} />
  );
}

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}
function tomorrowStr() {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return d.toISOString().slice(0, 10);
}

// ─── DocButtons ───────────────────────────────────────────────────────────────

const DOC_BUTTONS = [
  { label: "Doc", initial: "D", color: "#4285F4", url: "https://docs.google.com/document/create", title: "New Google Doc" },
  { label: "Sheet", initial: "S", color: "#0F9D58", url: "https://docs.google.com/spreadsheets/create", title: "New Google Sheet" },
  { label: "Slides", initial: "P", color: "#F4B400", url: "https://docs.google.com/presentation/create", title: "New Google Slides" },
  { label: "JIRA", initial: "J", color: "#0052CC", url: "https://www.atlassian.com/software/jira", title: "JIRA" },
  { label: "Zendesk", initial: "Z", color: "#03363D", url: "https://www.zendesk.com", title: "Zendesk" },
  { label: "Atlassian", initial: "A", color: "#0052CC", url: "https://www.atlassian.com", title: "Atlassian" },
  { label: "Lucid", initial: "L", color: "#F28C00", url: "https://www.lucidchart.com", title: "Lucidchart" },
  { label: "Figma", initial: "F", color: "#A259FF", url: "https://www.figma.com", title: "Figma" },
  { label: "NbLM", initial: "N", color: "#1A73E8", url: "https://notebooklm.google.com", title: "NotebookLM" },
];

function DocButtons() {
  return (
    <div style={{ padding: "8px 12px 12px" }}>
      <p style={{ ...SECTION_HEADER, marginBottom: 6 }}>Quick Open</p>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 6 }}>
        {DOC_BUTTONS.map(({ initial, color, url, title }) => (
          <a
            key={title}
            href={url}
            target="_blank"
            rel="noreferrer"
            title={title}
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              width: 36,
              height: 36,
              borderRadius: 6,
              background: color + "18",
              border: `1px solid ${color}44`,
              color,
              fontWeight: 700,
              fontSize: "0.8125rem",
              fontFamily: "var(--font-base)",
              textDecoration: "none",
              cursor: "pointer",
              transition: "background 0.12s",
            }}
            onMouseEnter={e => (e.currentTarget.style.background = color + "30")}
            onMouseLeave={e => (e.currentTarget.style.background = color + "18")}
          >
            {initial}
          </a>
        ))}
      </div>
    </div>
  );
}

// ─── LeftPanel ────────────────────────────────────────────────────────────────

interface LeftPanelProps {
  actionItems: ActionItem[];
  reminders: Reminder[];
  profile: UserProfile | null;
}

function ActionItemsSubsection({ items }: { items: ActionItem[] }) {
  const today = todayStr();
  const tomorrow = tomorrowStr();

  const groups: { label: string; items: ActionItem[] }[] = [
    { label: "Today", items: items.filter(i => i.due_date === today && i.status !== "done" && i.status !== "dismissed") },
    { label: "Tomorrow", items: items.filter(i => i.due_date === tomorrow && i.status !== "done" && i.status !== "dismissed") },
    { label: "In Progress", items: items.filter(i => i.status === "in_progress" && i.due_date !== today && i.due_date !== tomorrow) },
  ].filter(g => g.items.length > 0);

  const totalCount = groups.reduce((s, g) => s + g.items.length, 0);
  const [open, setOpen] = useState(true);

  return (
    <div style={{ borderBottom: "1px solid var(--border-color, #e5e7eb)", padding: "10px 12px" }}>
      <button
        onClick={() => setOpen(v => !v)}
        style={{
          display: "flex", alignItems: "center", gap: 6,
          background: "none", border: "none", cursor: "pointer",
          width: "100%", padding: 0, marginBottom: open ? 8 : 0,
        }}
      >
        <span style={{ ...SECTION_HEADER, marginBottom: 0, flex: 1, textAlign: "left" }}>Action Items</span>
        {totalCount > 0 && (
          <span style={{
            background: "var(--twilio-red, #DB131A)", color: "#fff",
            borderRadius: 10, fontSize: "0.6875rem", fontWeight: 700,
            padding: "0 6px", minWidth: 18, textAlign: "center",
          }}>{totalCount}</span>
        )}
        <span style={{ color: "var(--twilio-navy, #001489)", fontSize: "0.75rem" }}>{open ? "▾" : "▸"}</span>
      </button>
      {open && groups.map(group => (
        <div key={group.label} style={{ marginBottom: 6 }}>
          <p style={{ fontSize: "0.6875rem", fontWeight: 600, color: "#9ca3af", marginBottom: 3, textTransform: "uppercase", letterSpacing: "0.04em" }}>
            {group.label}
          </p>
          {group.items.map(item => (
            <div key={item.id} style={{ display: "flex", alignItems: "flex-start", gap: 6, padding: "3px 0" }}>
              <PriorityDot priority={item.priority} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <p style={{
                  fontSize: "0.8125rem", fontFamily: "var(--font-base)",
                  color: "var(--text-primary, #111827)",
                  whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
                  margin: 0,
                }}>
                  {item.title}
                </p>
                {item.account_name && (
                  <p style={{ fontSize: "0.6875rem", color: "#9ca3af", margin: 0 }}>{item.account_name}</p>
                )}
              </div>
            </div>
          ))}
        </div>
      ))}
      {open && groups.length === 0 && (
        <p style={{ fontSize: "0.8125rem", color: "#9ca3af" }}>No items due soon.</p>
      )}
    </div>
  );
}

function RemindersSubsection({ reminders }: { reminders: Reminder[] }) {
  const today = todayStr();
  const tomorrow = tomorrowStr();
  const relevant = reminders.filter(r => {
    const d = r.due_at?.slice(0, 10);
    return (d === today || d === tomorrow) && r.status === "pending";
  });
  const [open, setOpen] = useState(true);

  return (
    <div style={{ borderBottom: "1px solid var(--border-color, #e5e7eb)", padding: "10px 12px" }}>
      <button
        onClick={() => setOpen(v => !v)}
        style={{
          display: "flex", alignItems: "center", gap: 6,
          background: "none", border: "none", cursor: "pointer",
          width: "100%", padding: 0, marginBottom: open ? 8 : 0,
        }}
      >
        <span style={{ ...SECTION_HEADER, marginBottom: 0, flex: 1, textAlign: "left" }}>Reminders</span>
        {relevant.length > 0 && (
          <span style={{
            background: "#f59e0b", color: "#fff",
            borderRadius: 10, fontSize: "0.6875rem", fontWeight: 700,
            padding: "0 6px", minWidth: 18, textAlign: "center",
          }}>{relevant.length}</span>
        )}
        <span style={{ color: "var(--twilio-navy, #001489)", fontSize: "0.75rem" }}>{open ? "▾" : "▸"}</span>
      </button>
      {open && relevant.map(r => (
        <div key={r.id} style={{ padding: "3px 0" }}>
          <p style={{ fontSize: "0.8125rem", fontFamily: "var(--font-base)", color: "var(--text-primary, #111827)", margin: 0 }}>
            {r.title}
          </p>
          {r.body && (
            <p style={{
              fontSize: "0.6875rem", color: "#9ca3af", margin: 0,
              whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
            }}>
              {r.body.slice(0, 60)}{r.body.length > 60 ? "…" : ""}
            </p>
          )}
          <StatusBadge status={r.status} />
        </div>
      ))}
      {open && relevant.length === 0 && (
        <p style={{ fontSize: "0.8125rem", color: "#9ca3af" }}>No reminders due soon.</p>
      )}
    </div>
  );
}

// ─── StatsRow ─────────────────────────────────────────────────────────────────

interface StatsRowProps {
  actionItems: ActionItem[];
  reminders: Reminder[];
  accounts: Account[];
  agentSkills: AgentSkill[];
}

function StatCard({ value, label, color }: { value: number; label: string; color: string }) {
  return (
    <div style={{
      ...CARD,
      borderLeft: `4px solid ${color}`,
      display: "flex",
      flexDirection: "column",
      gap: 2,
    }}>
      <span style={{ fontSize: "1.75rem", fontWeight: 700, color: "var(--text-primary, #111827)", lineHeight: 1 }}>{value}</span>
      <span style={{ fontSize: "0.75rem", color: "#6b7280", fontFamily: "var(--font-base)" }}>{label}</span>
    </div>
  );
}

function StatsRow({ actionItems, reminders, accounts, agentSkills }: StatsRowProps) {
  const openActions = actionItems.filter(i => i.status === "open" || i.status === "in_progress").length;
  const activeReminders = reminders.filter(r => r.status === "pending").length;
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12, marginBottom: 16 }}>
      <StatCard value={agentSkills.length} label="My Skills" color="#8b5cf6" />
      <StatCard value={accounts.length} label="My Accounts" color="#3b82f6" />
      <StatCard value={openActions} label="Open Actions" color="#f97316" />
      <StatCard value={activeReminders} label="Active Reminders" color="#f59e0b" />
    </div>
  );
}

// ─── MyAccountsSection ────────────────────────────────────────────────────────

function MyAccountsSection({ accounts }: { accounts: Account[] }) {
  const shown = accounts.slice(0, 5);
  return (
    <div style={CARD}>
      <p style={SECTION_HEADER}>My Accounts</p>
      {shown.length === 0 && <p style={{ fontSize: "0.8125rem", color: "#9ca3af" }}>No accounts found.</p>}
      {shown.map(acct => (
        <div key={acct.id} style={{
          display: "flex", alignItems: "center", gap: 8,
          padding: "5px 0",
          borderBottom: "1px solid var(--border-color, #e5e7eb)",
        }}>
          <span style={{
            flex: 1, fontSize: "0.875rem", fontFamily: "var(--font-base)",
            color: "var(--text-primary, #111827)",
            whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
          }}>
            {acct.company_name}
          </span>
          <StatusBadge status={acct.status} />
          {acct.arr && (
            <span style={{ fontSize: "0.75rem", color: "#6b7280", whiteSpace: "nowrap" }}>{acct.arr}</span>
          )}
        </div>
      ))}
      {accounts.length > 5 && (
        <NavLink to="/accounts" style={{ fontSize: "0.75rem", color: "var(--twilio-navy, #001489)", display: "block", marginTop: 6 }}>
          View all →
        </NavLink>
      )}
    </div>
  );
}

// ─── MySkillsSection ──────────────────────────────────────────────────────────

function MySkillsSection({ agentSkills }: { agentSkills: AgentSkill[] }) {
  const pinned = agentSkills.filter(s => s.pinned_by_me).slice(0, 5);
  return (
    <div style={CARD}>
      <p style={SECTION_HEADER}>Pinned Skills</p>
      {pinned.length === 0 && (
        <p style={{ fontSize: "0.8125rem", color: "#9ca3af" }}>No pinned skills. Pin a skill from the Skills page.</p>
      )}
      {pinned.map(skill => (
        <div key={skill.id} style={{ padding: "5px 0", borderBottom: "1px solid var(--border-color, #e5e7eb)" }}>
          <p style={{ margin: 0, fontSize: "0.875rem", fontWeight: 600, fontFamily: "var(--font-base)", color: "var(--text-primary, #111827)" }}>
            {skill.name}
          </p>
          {skill.description && (
            <p style={{
              margin: 0, fontSize: "0.75rem", color: "#6b7280",
              whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
            }}>
              {skill.description.slice(0, 80)}{skill.description.length > 80 ? "…" : ""}
            </p>
          )}
        </div>
      ))}
    </div>
  );
}

// ─── NotepadSection ───────────────────────────────────────────────────────────

function NotepadSection() {
  const [note, setNote] = useState<UserPageNote | null>(null);
  const [content, setContent] = useState("");
  const [saveStatus, setSaveStatus] = useState<"idle" | "saving" | "saved">("idle");

  useEffect(() => {
    userPageNoteApi.list().then(r => {
      const first = r.data[0] ?? null;
      setNote(first);
      setContent(first?.content ?? "");
    }).catch(() => {});
  }, []);

  const handleBlur = async () => {
    setSaveStatus("saving");
    try {
      if (note) {
        await userPageNoteApi.update(note.id, { content });
      } else {
        const { data } = await userPageNoteApi.create({ content });
        setNote(data);
      }
      setSaveStatus("saved");
      setTimeout(() => setSaveStatus("idle"), 2000);
    } catch {
      setSaveStatus("idle");
    }
  };

  return (
    <div style={{ ...CARD, marginTop: 16 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
        <p style={SECTION_HEADER}>Notepad</p>
        {saveStatus === "saving" && <span style={{ fontSize: "0.75rem", color: "#9ca3af" }}>Saving…</span>}
        {saveStatus === "saved" && <span style={{ fontSize: "0.75rem", color: "#22c55e" }}>Saved</span>}
      </div>
      <textarea
        value={content}
        onChange={e => setContent(e.target.value)}
        onBlur={handleBlur}
        placeholder="Jot down notes, links, ideas…"
        style={{
          width: "100%",
          minHeight: 120,
          resize: "vertical",
          border: "1px solid var(--border-color, #e5e7eb)",
          borderRadius: 6,
          padding: "8px 10px",
          fontSize: "0.875rem",
          fontFamily: "var(--font-base)",
          background: "var(--input-bg, #f9fafb)",
          color: "var(--text-primary, #111827)",
          outline: "none",
          boxSizing: "border-box",
        }}
      />
    </div>
  );
}

// ─── MiniLayoutsSection ───────────────────────────────────────────────────────

function MiniLayoutsSection({ pinnedLayouts }: { pinnedLayouts: PageLayout[] }) {
  const [activeLayout, setActiveLayout] = useState<PageLayout | null>(null);

  const NODE_COLORS: Record<string, string> = {
    text: "#3b82f6",
    image: "#22c55e",
    table: "#f59e0b",
    chart: "#8b5cf6",
    default: "#9ca3af",
  };

  return (
    <div style={{ ...CARD, marginTop: 16 }}>
      <p style={SECTION_HEADER}>Pinned Layouts</p>
      {pinnedLayouts.length === 0 ? (
        <p style={{ fontSize: "0.8125rem", color: "#9ca3af" }}>
          No pinned layouts. Pin a layout from the Layouts page.
        </p>
      ) : (
        <>
          <div style={{ display: "flex", gap: 8, overflowX: "auto", paddingBottom: 8 }}>
            {pinnedLayouts.map(layout => (
              <button
                key={layout.id}
                onClick={() => setActiveLayout(activeLayout?.id === layout.id ? null : layout)}
                style={{
                  padding: "4px 12px",
                  borderRadius: 16,
                  border: `1px solid ${activeLayout?.id === layout.id ? "var(--twilio-navy, #001489)" : "var(--border-color, #e5e7eb)"}`,
                  background: activeLayout?.id === layout.id ? "var(--twilio-navy, #001489)" : "transparent",
                  color: activeLayout?.id === layout.id ? "#fff" : "var(--text-primary, #111827)",
                  fontSize: "0.8125rem",
                  fontFamily: "var(--font-base)",
                  cursor: "pointer",
                  whiteSpace: "nowrap",
                  transition: "all 0.15s",
                }}
              >
                {layout.name}
              </button>
            ))}
          </div>
          {activeLayout && (
            <div style={{
              marginTop: 8,
              padding: 12,
              borderRadius: 6,
              background: "var(--input-bg, #f9fafb)",
              border: "1px solid var(--border-color, #e5e7eb)",
            }}>
              <p style={{ margin: "0 0 8px", fontSize: "0.8125rem", fontWeight: 600, color: "var(--text-primary, #111827)" }}>
                {activeLayout.name}
              </p>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                {(activeLayout.nodes as Array<{ type?: string }>).slice(0, 12).map((node, i) => (
                  <div
                    key={i}
                    style={{
                      width: 40,
                      height: 28,
                      borderRadius: 4,
                      background: NODE_COLORS[(node as { type?: string }).type ?? "default"] ?? NODE_COLORS.default,
                      opacity: 0.5,
                    }}
                  />
                ))}
                {activeLayout.nodes.length === 0 && (
                  <span style={{ fontSize: "0.75rem", color: "#9ca3af" }}>Empty layout</span>
                )}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ─── FreeformSection ──────────────────────────────────────────────────────────

function RecordRefCard({
  ref: _ref,
  item,
  onRemove,
}: {
  ref?: React.Ref<HTMLDivElement>;
  item: ExportItemSnapshot;
  onRemove: () => void;
}) {
  return (
    <div style={{
      ...CARD,
      padding: "8px 12px",
      display: "flex",
      alignItems: "flex-start",
      gap: 8,
      marginBottom: 8,
    }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 2 }}>
          <span style={{
            fontSize: "0.6875rem", fontWeight: 600, padding: "1px 6px",
            borderRadius: 10, background: (item.accent ?? "#9ca3af") + "22",
            color: item.accent ?? "#9ca3af",
          }}>
            {item.type}
          </span>
          <span style={{ fontSize: "0.875rem", fontWeight: 600, color: "var(--text-primary, #111827)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {item.label}
          </span>
        </div>
        {item.summary && (
          <p style={{ margin: 0, fontSize: "0.75rem", color: "#6b7280", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {item.summary}
          </p>
        )}
      </div>
      <button
        onClick={onRemove}
        style={{ background: "none", border: "none", cursor: "pointer", color: "#9ca3af", fontSize: "0.875rem", padding: "0 2px", flexShrink: 0 }}
        title="Remove"
      >
        ✕
      </button>
    </div>
  );
}

function DroppableArea({ children, onDrop }: { children: React.ReactNode; onDrop: (item: ExportItemSnapshot) => void }) {
  const { setNodeRef, isOver } = useDroppable({ id: "freeform-drop" });

  // Listen for drag-end from parent DndContext — we use a local DndContext below
  void onDrop; // handled via local context

  return (
    <div
      ref={setNodeRef}
      style={{
        minHeight: 80,
        borderRadius: 6,
        border: `2px dashed ${isOver ? "var(--twilio-navy, #001489)" : "var(--border-color, #e5e7eb)"}`,
        background: isOver ? "rgba(0,20,137,0.04)" : "transparent",
        padding: 8,
        transition: "all 0.15s",
      }}
    >
      {children}
    </div>
  );
}

interface FreeformSectionProps {
  sessions: WorkingSession[];
  setSessions: React.Dispatch<React.SetStateAction<WorkingSession[]>>;
}

function FreeformSection({ sessions, setSessions }: FreeformSectionProps) {
  const [activeSessionId, setActiveSessionId] = useState<number | null>(null);
  const [newName, setNewName] = useState("");
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const activeSession = sessions.find(s => s.id === activeSessionId) ?? null;

  function getSessionRefs(session: WorkingSession): ExportItemSnapshot[] {
    return (session.record_refs ?? []) as ExportItemSnapshot[];
  }

  async function removeRef(refId: string) {
    if (!activeSession) return;
    const updated = getSessionRefs(activeSession).filter(r => r.id !== refId);
    setSessions(prev => prev.map(s => s.id === activeSession.id ? { ...s, record_refs: updated } : s));
    // debounced save
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(async () => {
      await workingSessionApi.update(activeSession.id, { record_refs: updated });
    }, 1000);
  }

  async function saveNewSession() {
    if (!newName.trim()) return;
    try {
      const { data } = await workingSessionApi.create({ name: newName.trim(), record_refs: [] });
      setSessions(prev => [...prev, data]);
      setActiveSessionId(data.id);
      setNewName("");
    } catch { /* ignore */ }
  }

  function handleLocalDragEnd(event: import("@dnd-kit/core").DragEndEvent) {
    if (event.over?.id !== "freeform-drop") return;
    const dragged = event.active.data.current as { item?: ExportItemSnapshot } | undefined;
    if (!dragged?.item) return;
    if (!activeSession) return;
    const already = getSessionRefs(activeSession).some(r => r.id === dragged.item!.id);
    if (already) return;
    const updated = [...getSessionRefs(activeSession), dragged.item];
    setSessions(prev => prev.map(s => s.id === activeSession.id ? { ...s, record_refs: updated } : s));
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(async () => {
      await workingSessionApi.update(activeSession.id, { record_refs: updated });
    }, 1000);
  }

  return (
    <div style={{ ...CARD, marginTop: 16 }}>
      <p style={SECTION_HEADER}>Working Sessions</p>
      {/* Tab bar */}
      <div style={{ display: "flex", gap: 4, overflowX: "auto", paddingBottom: 8, borderBottom: "1px solid var(--border-color, #e5e7eb)", marginBottom: 12 }}>
        {sessions.map(s => (
          <button
            key={s.id}
            onClick={() => setActiveSessionId(s.id)}
            style={{
              padding: "4px 12px",
              borderRadius: 4,
              border: `1px solid ${activeSessionId === s.id ? "var(--twilio-navy, #001489)" : "var(--border-color, #e5e7eb)"}`,
              background: activeSessionId === s.id ? "var(--twilio-navy, #001489)" : "transparent",
              color: activeSessionId === s.id ? "#fff" : "var(--text-primary, #111827)",
              fontSize: "0.8125rem",
              fontFamily: "var(--font-base)",
              cursor: "pointer",
              whiteSpace: "nowrap",
            }}
          >
            {s.name}
          </button>
        ))}
        <button
          onClick={() => setActiveSessionId(null)}
          style={{
            padding: "4px 12px",
            borderRadius: 4,
            border: `1px solid ${activeSessionId === null ? "var(--twilio-navy, #001489)" : "var(--border-color, #e5e7eb)"}`,
            background: activeSessionId === null ? "var(--twilio-navy, #001489)" : "transparent",
            color: activeSessionId === null ? "#fff" : "var(--text-primary, #111827)",
            fontSize: "0.8125rem",
            fontFamily: "var(--font-base)",
            cursor: "pointer",
          }}
        >
          + New
        </button>
      </div>

      {/* Active session content */}
      <DndContext onDragEnd={handleLocalDragEnd}>
        {activeSession ? (
          <DroppableArea onDrop={() => {}}>
            {getSessionRefs(activeSession).length === 0 && (
              <p style={{ fontSize: "0.8125rem", color: "#9ca3af", margin: 0 }}>
                Drop export items here, or add records to this session.
              </p>
            )}
            {getSessionRefs(activeSession).map(item => (
              <RecordRefCard key={item.id} item={item} onRemove={() => removeRef(item.id)} />
            ))}
          </DroppableArea>
        ) : (
          <div>
            <p style={{ fontSize: "0.8125rem", color: "#6b7280", marginBottom: 8 }}>Create a new working session:</p>
            <div style={{ display: "flex", gap: 8 }}>
              <input
                type="text"
                value={newName}
                onChange={e => setNewName(e.target.value)}
                onKeyDown={e => { if (e.key === "Enter") void saveNewSession(); }}
                placeholder="Session name…"
                style={{
                  flex: 1,
                  border: "1px solid var(--border-color, #e5e7eb)",
                  borderRadius: 6,
                  padding: "6px 10px",
                  fontSize: "0.875rem",
                  fontFamily: "var(--font-base)",
                  background: "var(--input-bg, #f9fafb)",
                  color: "var(--text-primary, #111827)",
                  outline: "none",
                }}
              />
              <button
                onClick={() => void saveNewSession()}
                style={{
                  padding: "6px 14px",
                  borderRadius: 6,
                  border: "none",
                  background: "var(--twilio-navy, #001489)",
                  color: "#fff",
                  fontSize: "0.875rem",
                  fontFamily: "var(--font-base)",
                  cursor: "pointer",
                }}
              >
                Save Session
              </button>
            </div>
          </div>
        )}
      </DndContext>
    </div>
  );
}

// ─── ProfilePage ──────────────────────────────────────────────────────────────

function LeftPanel({ actionItems, reminders, profile }: LeftPanelProps) {
  return (
    <div style={{
      width: 280,
      minWidth: 280,
      display: "flex",
      flexDirection: "column",
      borderRight: "1px solid var(--border-color, #e5e7eb)",
      background: "var(--card-bg, #fff)",
      overflow: "hidden",
    }}>
      {/* Profile header */}
      <div style={{
        padding: "16px 12px 12px",
        borderBottom: "1px solid var(--border-color, #e5e7eb)",
        background: "var(--twilio-navy, #001489)",
        color: "#fff",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{
            width: 40, height: 40, borderRadius: "50%",
            background: "var(--twilio-red, #DB131A)",
            display: "flex", alignItems: "center", justifyContent: "center",
            fontSize: "1rem", fontWeight: 700, color: "#fff", flexShrink: 0,
          }}>
            {profile ? (profile.display_name || profile.username || "?")[0].toUpperCase() : "?"}
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <p style={{ margin: 0, fontWeight: 700, fontSize: "0.9375rem", fontFamily: "var(--font-base)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
              {profile?.display_name || profile?.username || ""}
            </p>
            {(profile?.title || profile?.role) && (
              <p style={{ margin: 0, fontSize: "0.75rem", opacity: 0.7 }}>
                {profile?.title || profile?.role}
              </p>
            )}
          </div>
        </div>
      </div>

      {/* Scrollable middle */}
      <div style={{ flex: 1, overflowY: "auto" }}>
        <ActionItemsSubsection items={actionItems} />
        <RemindersSubsection reminders={reminders} />
      </div>

      {/* Doc buttons fixed at bottom */}
      <DocButtons />
    </div>
  );
}

export default function ProfilePage() {
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [actionItems, setActionItems] = useState<ActionItem[]>([]);
  const [reminders, setReminders] = useState<Reminder[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [agentSkills, setAgentSkills] = useState<AgentSkill[]>([]);
  const [pinnedLayouts, setPinnedLayouts] = useState<PageLayout[]>([]);
  const [sessions, setSessions] = useState<WorkingSession[]>([]);

  useEffect(() => {
    teamApi.getMyProfile().then(r => setProfile(r.data)).catch(() => {});
    schedulerApi.listActionItems({ assigned_to_me: "true", page_size: "100" }).then(r => setActionItems(r.data.results)).catch(() => {});
    schedulerApi.listReminders({ page_size: "100" }).then(r => setReminders(r.data.results)).catch(() => {});
    accountsApi.listAccounts({ page_size: "20" }).then(r => setAccounts(r.data.results)).catch(() => {});
    agentSkillsApi.list().then(r => setAgentSkills(r.data.results)).catch(() => {});
    layoutsApi.listPinned().then(r => setPinnedLayouts(r.data)).catch(() => {});
    workingSessionApi.list().then(r => setSessions(r.data)).catch(() => {});
  }, []);

  return (
    <div style={{ display: "flex", height: "100%", overflow: "hidden" }}>
      <LeftPanel actionItems={actionItems} reminders={reminders} profile={profile} />
      <div style={{ flex: 1, overflow: "auto", padding: 20 }}>
        <StatsRow actionItems={actionItems} reminders={reminders} accounts={accounts} agentSkills={agentSkills} />
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
          <MyAccountsSection accounts={accounts} />
          <MySkillsSection agentSkills={agentSkills} />
        </div>
        <NotepadSection />
        <MiniLayoutsSection pinnedLayouts={pinnedLayouts} />
        <FreeformSection sessions={sessions} setSessions={setSessions} />
      </div>
    </div>
  );
}
