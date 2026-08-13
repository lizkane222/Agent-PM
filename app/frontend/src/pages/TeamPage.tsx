import { useEffect, useRef, useState } from "react";
import CorporateIcon from "../assets/icons/Corporate.svg?react";
import TeamIcon from "../assets/icons/Team.svg?react";
import { accountsApi } from "../lib/api";
import type { Account, TeamMember } from "../types";
import { getTitleRole, ROLE_META, ROLE_ORDER } from "../lib/titleRoles";
import { addLog } from "../lib/appLog";
import { useLogGlow } from "../hooks/useLogGlow";
import { useCurrentUser } from "../context/CurrentUserContext";
import { useTeam } from "../hooks/useTeam";

type ViewMode = "cards" | "list" | "table";

const ACCOUNT_STATUS_STYLE: Record<string, { background: string; color: string }> = {
  prospect: { background: "#fef9c3", color: "#a16207" },
  active:   { background: "#dcfce7", color: "#15803d" },
  inactive: { background: "var(--bg, #f5f5f5)", color: "var(--text-secondary, #888)" },
  churned:  { background: "#fee2e2", color: "#dc2626" },
};

const EMPTY_FORM: Partial<TeamMember> = {
  full_name: "",
  email: "",
  title: "",
  department: "",
  slack_handle: "",
  avatar_url: "",
};

type RoleMeta = { border: string; bg: string; text: string; label: string; slug: string };
type CustomGroup = RoleMeta & { key: string };

const CUSTOM_GROUP_COLORS: Array<Omit<RoleMeta, "label" | "slug">> = [
  { border: "#8b5cf6", bg: "#f5f3ff", text: "#5b21b6" },
  { border: "#f59e0b", bg: "#fffbeb", text: "#92400e" },
  { border: "#10b981", bg: "#ecfdf5", text: "#065f46" },
  { border: "#f43f5e", bg: "#fff1f2", text: "#9f1239" },
  { border: "#06b6d4", bg: "#ecfeff", text: "#164e63" },
  { border: "#84cc16", bg: "#f7fee7", text: "#365314" },
];

function ViewToggle({ value, onChange }: { value: ViewMode; onChange: (v: ViewMode) => void }) {
  const opts: { v: ViewMode; icon: React.ReactNode; label: string }[] = [
    {
      v: "cards",
      label: "Cards",
      icon: (
        <svg viewBox="0 0 16 16" fill="currentColor" className="w-3.5 h-3.5">
          <rect x="1" y="1" width="6" height="6" rx="1"/><rect x="9" y="1" width="6" height="6" rx="1"/>
          <rect x="1" y="9" width="6" height="6" rx="1"/><rect x="9" y="9" width="6" height="6" rx="1"/>
        </svg>
      ),
    },
    {
      v: "list",
      label: "List",
      icon: (
        <svg viewBox="0 0 16 16" fill="currentColor" className="w-3.5 h-3.5">
          <rect x="1" y="2" width="14" height="3" rx="1.5"/>
          <rect x="1" y="7" width="14" height="3" rx="1.5"/>
          <rect x="1" y="12" width="14" height="3" rx="1.5"/>
        </svg>
      ),
    },
    {
      v: "table",
      label: "Table",
      icon: (
        <svg viewBox="0 0 16 16" fill="currentColor" className="w-3.5 h-3.5">
          <rect x="1" y="1" width="14" height="3" rx="1"/>
          <rect x="1" y="6" width="6" height="3" rx="1"/><rect x="9" y="6" width="6" height="3" rx="1"/>
          <rect x="1" y="11" width="6" height="3" rx="1"/><rect x="9" y="11" width="6" height="3" rx="1"/>
        </svg>
      ),
    },
  ];
  return (
    <div className="flex items-center overflow-hidden" style={{ border: "1px solid var(--border, rgba(0,0,0,0.08))", borderRadius: "6px" }}>
      {opts.map(({ v, icon, label }) => (
        <button
          key={v}
          title={label}
          onClick={() => onChange(v)}
          className="card-btn flex items-center gap-1.5 px-3 py-2 text-sm transition-all"
          style={value === v
            ? { borderRadius: 0, background: "var(--twilio-red, #e22)", color: "#fff" }
            : { borderRadius: 0, background: "var(--surface, #fff)", color: "var(--text-primary, #111)" }}
        >
          {icon}
          <span className="hidden sm:inline">{label}</span>
        </button>
      ))}
    </div>
  );
}

// ── Draggable account chip (used in the Accounts sidebar) ────────────────────

function DraggableAccountChip({
  account,
  dropTarget,
  onDragOver,
  onDragLeave,
  onDrop,
}: {
  account: Account;
  dropTarget?: boolean;
  onDragOver?: (e: React.DragEvent) => void;
  onDragLeave?: () => void;
  onDrop?: (e: React.DragEvent) => void;
}) {
  const members = account.team_members ?? [];
  return (
    <div
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData("accountId", String(account.id));
        e.dataTransfer.setData("accountTeamMemberIds", JSON.stringify(members.map((m) => m.id)));
        e.dataTransfer.effectAllowed = "copy";
      }}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      className="card-btn"
      style={{
        width: "100%", borderRadius: "8px", overflow: "hidden", cursor: "grab",
        background: "var(--surface, #fff)", userSelect: "none",
        border: dropTarget ? "2px solid var(--twilio-red, #e22)" : "1px solid var(--border, rgba(0,0,0,0.08))",
        boxShadow: dropTarget ? "0 0 0 3px rgba(226,34,34,0.08)" : "0 1px 4px rgba(0,0,0,0.06)",
        transition: "box-shadow 0.15s, border-color 0.15s",
        fontFamily: "var(--font-base)",
      }}
    >
      <div style={{ padding: "14px 16px 12px" }}>
        {/* Header */}
        <div style={{ display: "flex", alignItems: "flex-start", gap: "12px" }}>
          <div style={{ height: "40px", width: "40px", borderRadius: "10px", flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center", background: "rgba(226,34,34,0.08)", color: "var(--twilio-red, #e22)" }}>
            <CorporateIcon style={{ width: "18px", height: "18px" }} />
          </div>
          <div style={{ flex: 1, minWidth: 0, paddingTop: "2px" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "8px" }}>
              <p style={{ margin: 0, fontSize: "0.875rem", fontWeight: 700, color: "var(--text-primary, #111)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{account.company_name}</p>
              <span style={{ flexShrink: 0, fontSize: "0.6875rem", fontWeight: 600, padding: "2px 7px", borderRadius: "6px", ...(ACCOUNT_STATUS_STYLE[account.status] ?? {}) }}>{account.status}</span>
            </div>
            {account.industry && <p style={{ margin: "2px 0 0", fontSize: "0.75rem", color: "var(--text-secondary, #888)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{account.industry}</p>}
          </div>
        </div>

        {/* Team members */}
        {members.length > 0 && (
          <div style={{ marginTop: "10px", paddingTop: "10px", borderTop: "1px solid var(--border, rgba(0,0,0,0.06))", display: "flex", flexDirection: "column", gap: "6px" }}>
            {members.map((m) => {
              const ini = m.full_name.split(" ").map((n) => n[0]).join("").toUpperCase().slice(0, 2);
              const mc = ROLE_META[getTitleRole(m.title)];
              return (
                <div key={m.id} style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                  {m.avatar_url ? (
                    <img src={m.avatar_url} alt={m.full_name} style={{ height: "22px", width: "22px", borderRadius: "6px", objectFit: "cover", flexShrink: 0 }} />
                  ) : (
                    <div style={{ height: "22px", width: "22px", borderRadius: "6px", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "0.5625rem", fontWeight: 700, flexShrink: 0, backgroundColor: mc.bg, color: mc.text }}>{ini}</div>
                  )}
                  <span style={{ fontSize: "0.75rem", fontWeight: 500, color: "var(--text-primary, #111)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: "1 1 0", minWidth: 0 }}>{m.full_name}</span>
                  {m.title && <span style={{ fontSize: "0.6875rem", color: "var(--text-secondary, #aaa)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: "0 1 auto", maxWidth: "45%" }}>{m.title}</span>}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

function MemberCard({
  member,
  onSelect,
  dropTarget,
  onDragOver,
  onDragLeave,
  onDrop,
  roleMeta,
  isOverridden,
  onClearOverride,
}: {
  member: TeamMember;
  onSelect: (m: TeamMember) => void;
  dropTarget: boolean;
  onDragOver: (e: React.DragEvent) => void;
  onDragLeave: () => void;
  onDrop: (e: React.DragEvent) => void;
  roleMeta?: RoleMeta;
  isOverridden?: boolean;
  onClearOverride?: () => void;
}) {
  function handleDragStart(e: React.DragEvent) {
    e.dataTransfer.setData("memberId", String(member.id));
    e.dataTransfer.effectAllowed = "copy";
  }
  const initials = member.full_name.split(" ").map((n) => n[0]).join("").toUpperCase().slice(0, 2);
  const role = getTitleRole(member.title);
  const colors = roleMeta ?? ROLE_META[role];

  return (
    <button
      draggable
      onDragStart={handleDragStart}
      onClick={() => onSelect(member)}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      className="card-btn"
      style={{
        width: "100%", textAlign: "left", padding: 0,
        borderRadius: "8px", overflow: "hidden", cursor: "grab",
        background: "var(--surface, #fff)",
        border: dropTarget ? `2px solid ${colors.border}` : "1px solid var(--border, rgba(0,0,0,0.08))",
        boxShadow: dropTarget ? `0 0 0 3px ${colors.bg}` : "0 1px 4px rgba(0,0,0,0.06)",
        transition: "box-shadow 0.15s, border-color 0.15s",
        fontFamily: "var(--font-base)",
        display: "flex", flexDirection: "column", justifyContent: "flex-start",
      }}
      onMouseEnter={e => { if (!dropTarget) e.currentTarget.style.boxShadow = "0 4px 16px rgba(0,0,0,0.1)"; }}
      onMouseLeave={e => { if (!dropTarget) e.currentTarget.style.boxShadow = "0 1px 4px rgba(0,0,0,0.06)"; }}
    >
      {/* Role colour bar */}
      <div style={{ height: "4px", background: colors.border }} />

      <div style={{ padding: "16px 20px 14px" }}>
        {/* Avatar + name row */}
        <div style={{ display: "flex", alignItems: "flex-start", gap: "14px" }}>
          {member.avatar_url ? (
            <img src={member.avatar_url} alt={member.full_name} style={{ height: "48px", width: "48px", borderRadius: "12px", objectFit: "cover", flexShrink: 0 }} />
          ) : (
            <div style={{ height: "48px", width: "48px", borderRadius: "12px", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "1rem", fontWeight: 700, flexShrink: 0, background: colors.bg, color: colors.text }}>
              {initials}
            </div>
          )}
          <div style={{ flex: 1, minWidth: 0, paddingTop: "2px" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "8px" }}>
              <span style={{ fontSize: "0.9375rem", fontWeight: 700, color: "var(--text-primary, #111)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{member.full_name}</span>
            </div>
            {member.title && <p style={{ margin: "3px 0 0", fontSize: "0.8125rem", color: "var(--text-secondary, #888)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{member.title}</p>}
            {member.department && <p style={{ margin: "2px 0 0", fontSize: "0.75rem", color: "var(--text-secondary, #aaa)" }}>{member.department}</p>}
          </div>
        </div>

        {/* Divider */}
        <div style={{ margin: "12px 0 10px", height: "1px", background: "var(--border, rgba(0,0,0,0.06))" }} />

        {/* Contact row */}
        <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
          {member.email && (
            <span style={{ fontSize: "0.75rem", color: "var(--twilio-red, #e22)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{member.email}</span>
          )}
          {member.slack_handle && (
            <span style={{ fontSize: "0.75rem", color: "var(--text-secondary, #888)" }}>@{member.slack_handle}</span>
          )}
          {member.manager_name && (
            <span style={{ fontSize: "0.75rem", color: "var(--text-secondary, #aaa)" }}>↳ {member.manager_name}</span>
          )}
        </div>

        {/* Tags + override badge */}
        {(member.tags.length > 0 || isOverridden) && (
          <div style={{ display: "flex", flexWrap: "wrap", gap: "4px", marginTop: "10px", alignItems: "center" }}>
            {member.tags.map((tag) => (
              <span key={tag.id} style={{ fontSize: "0.6875rem", fontWeight: 600, padding: "2px 8px", borderRadius: "6px", background: "var(--bg, #f5f5f5)", color: "var(--text-secondary, #888)" }}>
                {tag.name}
              </span>
            ))}
            {isOverridden && (
              <span style={{ fontSize: "0.6rem", fontWeight: 700, padding: "1px 6px", borderRadius: "6px", background: colors.bg, color: colors.text, letterSpacing: "0.04em", display: "flex", alignItems: "center", gap: "4px" }}>
                reassigned
                {onClearOverride && (
                  <button
                    onClick={(e) => { e.stopPropagation(); onClearOverride(); }}
                    style={{ background: "none", border: "none", cursor: "pointer", padding: 0, lineHeight: 1, color: colors.text, opacity: 0.7, fontSize: "0.75rem" }}
                    title="Reset to original group"
                  >
                    ×
                  </button>
                )}
              </span>
            )}
          </div>
        )}
      </div>
    </button>
  );
}

function MemberModal({
  member,
  allMembers,
  onClose,
  onSave,
  onDelete,
}: {
  member: Partial<TeamMember> | null;
  allMembers: TeamMember[];
  onClose: () => void;
  onSave: (data: Partial<TeamMember>) => Promise<void>;
  onDelete: (id: number) => Promise<void>;
}) {
  const [form, setForm] = useState<Partial<TeamMember>>(member ?? EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const firstInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    firstInput.current?.focus();
  }, []);

  const isNew = !member?.id;

  const set = (key: keyof TeamMember, value: string | number | null) =>
    setForm((f) => ({ ...f, [key]: value }));

  async function handleSave() {
    setSaving(true);
    try {
      await onSave(form);
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!member?.id) return;
    setDeleting(true);
    try {
      await onDelete(member.id);
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/40" onClick={onClose}>
      <div
        className="bg-white rounded-xl shadow-xl w-full max-w-lg mx-4 p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-xl font-semibold text-[var(--twilio-navy)] mb-5">
          {isNew ? "Add Team Member" : "Edit Member"}
        </h2>

        <div className="grid grid-cols-2 gap-4">
          <div className="col-span-2">
            <label className="block text-sm font-medium text-[var(--twilio-navy)] mb-1">Full name *</label>
            <input
              ref={firstInput}
              value={form.full_name ?? ""}
              onChange={(e) => set("full_name", e.target.value)}
              className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-red-400 focus:outline-none focus:ring-1 focus:ring-red-100"
            />
          </div>
          <div className="col-span-2">
            <label className="block text-sm font-medium text-[var(--twilio-navy)] mb-1">Email *</label>
            <input
              type="email"
              value={form.email ?? ""}
              onChange={(e) => set("email", e.target.value)}
              className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-red-400 focus:outline-none focus:ring-1 focus:ring-red-100"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-[var(--twilio-navy)] mb-1">Title</label>
            <input
              value={form.title ?? ""}
              onChange={(e) => set("title", e.target.value)}
              className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-red-400 focus:outline-none focus:ring-1 focus:ring-red-100"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-[var(--twilio-navy)] mb-1">Department</label>
            <input
              value={form.department ?? ""}
              onChange={(e) => set("department", e.target.value)}
              className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-red-400 focus:outline-none focus:ring-1 focus:ring-red-100"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-[var(--twilio-navy)] mb-1">Slack handle</label>
            <input
              value={form.slack_handle ?? ""}
              onChange={(e) => set("slack_handle", e.target.value)}
              placeholder="without @"
              className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-red-400 focus:outline-none focus:ring-1 focus:ring-red-100"
            />
          </div>
          <div className="col-span-2">
            <label className="block text-sm font-medium text-[var(--twilio-navy)] mb-1">Manager</label>
            <select
              value={form.manager ?? ""}
              onChange={(e) => set("manager", e.target.value ? Number(e.target.value) : null)}
              className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-red-400 focus:outline-none focus:ring-1 focus:ring-red-100"
            >
              <option value="">No manager</option>
              {allMembers
                .filter((m) => m.id !== member?.id)
                .map((m) => (
                  <option key={m.id} value={m.id}>{m.full_name}</option>
                ))}
            </select>
          </div>
        </div>

        <div className="flex items-center justify-between mt-6">
          {!isNew ? (
            confirmDelete ? (
              <div className="flex gap-2">
                <span className="text-sm text-[var(--twilio-navy)] self-center">Sure?</span>
                <button
                  onClick={handleDelete}
                  disabled={deleting}
                  className="rounded-md px-3 py-1.5 text-sm font-medium bg-red-600 text-white hover:bg-red-700 disabled:opacity-50"
                >
                  {deleting ? "Deleting…" : "Yes, delete"}
                </button>
                <button
                  onClick={() => setConfirmDelete(false)}
                  className="rounded-md px-3 py-1.5 text-sm font-medium border border-gray-300 text-[var(--twilio-navy)] hover:bg-gray-50"
                >
                  Cancel
                </button>
              </div>
            ) : (
              <button
                onClick={() => setConfirmDelete(true)}
                className="text-sm text-red-500 hover:text-red-700"
              >
                Delete member
              </button>
            )
          ) : (
            <span />
          )}
          <div className="flex gap-2">
            <button
              onClick={onClose}
              className="rounded-md px-4 py-2 text-sm font-medium border border-gray-300 text-[var(--twilio-navy)] hover:bg-gray-50"
            >
              Cancel
            </button>
            <button
              onClick={handleSave}
              disabled={saving || !form.full_name || !form.email}
              className="rounded-md px-4 py-2 text-sm font-medium disabled:opacity-50 hover:opacity-90 transition-opacity"
              style={{ background: "var(--twilio-red, #e22)", color: "#fff", border: "none" }}
            >
              {saving ? "Saving…" : isNew ? "Add member" : "Save changes"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Member detail sidebar ─────────────────────────────────────────────────────

function MemberDetailSidebar({
  member,
  accounts,
  onClose,
  onEdit,
  onRemoveFromAccount,
}: {
  member: TeamMember;
  accounts: Account[];
  onClose: () => void;
  onEdit: () => void;
  onRemoveFromAccount: (accountId: number) => void;
}) {
  const role = getTitleRole(member.title);
  const colors = ROLE_META[role];
  const initials = member.full_name.split(" ").map((n) => n[0]).join("").toUpperCase().slice(0, 2);
  const linkedAccounts = accounts.filter((a) =>
    (a.team_members ?? []).some((m) => m.id === member.id)
  );

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-30 bg-black/20"
        onClick={onClose}
      />
      {/* Drawer */}
      <div
        className="fixed top-0 right-0 h-full z-40 flex flex-col shadow-2xl w-96"
        style={{ background: "var(--surface, #fff)", borderLeft: "1px solid var(--border, rgba(0,0,0,0.08))" }}
      >
        {/* Role colour bar */}
        <div style={{ height: "4px", background: colors.border, flexShrink: 0 }} />

        {/* Header */}
        <div className="flex items-start gap-4 px-5 pt-5 pb-4 shrink-0" style={{ borderBottom: "1px solid var(--border, rgba(0,0,0,0.08))" }}>
          <div className="shrink-0">
            {member.avatar_url ? (
              <img src={member.avatar_url} alt={member.full_name} className="h-14 w-14 rounded-xl object-cover" />
            ) : (
              <div className="h-14 w-14 rounded-xl flex items-center justify-center text-xl font-bold" style={{ background: colors.bg, color: colors.text }}>
                {initials}
              </div>
            )}
          </div>
          <div className="flex-1 min-w-0 pt-0.5">
            <div className="flex items-center gap-2 flex-wrap">
              <h2 className="text-lg font-semibold text-[var(--twilio-navy)] truncate">{member.full_name}</h2>
            </div>
            {member.title && <p className="text-sm text-[var(--twilio-navy)] mt-0.5 truncate">{member.title}</p>}
            {member.department && <p className="text-xs mt-0.5 truncate" style={{ color: "var(--text-secondary, #888)" }}>{member.department}</p>}
          </div>
          <button
            onClick={onClose}
            className="card-btn shrink-0 p-1.5 rounded-lg text-[var(--twilio-gray-60)] hover:bg-gray-100"
            aria-label="Close"
          >
            <svg viewBox="0 0 16 16" fill="currentColor" className="w-4 h-4">
              <path d="M4.293 4.293a1 1 0 011.414 0L8 6.586l2.293-2.293a1 1 0 111.414 1.414L9.414 8l2.293 2.293a1 1 0 01-1.414 1.414L8 9.414l-2.293 2.293a1 1 0 01-1.414-1.414L6.586 8 4.293 5.707a1 1 0 010-1.414z"/>
            </svg>
          </button>
        </div>

        {/* Scrollable body */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5">

          {/* Contact info */}
          <div className="space-y-2">
            <p className="text-[11px] font-bold uppercase tracking-wider" style={{ color: "var(--text-secondary, #888)" }}>Contact</p>
            {member.email && (
              <div className="flex items-center gap-2">
                <svg viewBox="0 0 16 16" fill="currentColor" className="w-3.5 h-3.5 shrink-0" style={{ color: "var(--text-secondary, #aaa)" }}>
                  <path d="M1.5 3A1.5 1.5 0 000 4.5v.793l6.953 4.302a1.5 1.5 0 001.594 0L16 5.293V4.5A1.5 1.5 0 0014.5 3h-13zM16 6.697l-6.267 3.879a2.5 2.5 0 01-2.466 0L1 6.697V11.5A1.5 1.5 0 002.5 13h11a1.5 1.5 0 001.5-1.5V6.697z"/>
                </svg>
                <a href={`mailto:${member.email}`} className="text-sm truncate" style={{ color: "var(--twilio-red, #e22)" }}>{member.email}</a>
              </div>
            )}
            {member.slack_handle && (
              <div className="flex items-center gap-2">
                <svg viewBox="0 0 16 16" fill="currentColor" className="w-3.5 h-3.5 shrink-0" style={{ color: "var(--text-secondary, #aaa)" }}>
                  <path d="M8 1a7 7 0 100 14A7 7 0 008 1zm.75 9.25a.75.75 0 01-1.5 0V8a.75.75 0 011.5 0v2.25zM8 6a1 1 0 110-2 1 1 0 010 2z"/>
                </svg>
                <span className="text-sm text-[var(--twilio-navy)]">@{member.slack_handle}</span>
              </div>
            )}
            {member.manager_name && (
              <div className="flex items-center gap-2">
                <svg viewBox="0 0 16 16" fill="currentColor" className="w-3.5 h-3.5 shrink-0" style={{ color: "var(--text-secondary, #aaa)" }}>
                  <path d="M8 8a3 3 0 100-6 3 3 0 000 6zm1 2.25a.75.75 0 01-1.5 0V10a.75.75 0 011.5 0v.25zM3 13c0-2.21 2.239-4 5-4s5 1.79 5 4H3z"/>
                </svg>
                <span className="text-sm text-[var(--twilio-navy)]">Reports to {member.manager_name}</span>
              </div>
            )}
            {member.joined_at && (
              <div className="flex items-center gap-2">
                <svg viewBox="0 0 16 16" fill="currentColor" className="w-3.5 h-3.5 shrink-0" style={{ color: "var(--text-secondary, #aaa)" }}>
                  <path d="M5 4a1 1 0 000 2h6a1 1 0 000-2H5zM3 1a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2V3a2 2 0 00-2-2H3zm0 2h10v2H3V3zm0 4h10v6H3V7z"/>
                </svg>
                <span className="text-sm" style={{ color: "var(--text-secondary, #888)" }}>Joined {new Date(member.joined_at).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" })}</span>
              </div>
            )}
          </div>

          {/* Role badge */}
          <div>
            <p className="text-[11px] font-bold uppercase tracking-wider mb-2" style={{ color: "var(--text-secondary, #888)" }}>Role</p>
            <span className="text-xs font-semibold rounded-md px-3 py-1" style={{ backgroundColor: colors.bg, color: colors.text }}>{ROLE_META[role].label}</span>
          </div>

          {/* Tags */}
          {member.tags.length > 0 && (
            <div>
              <p className="text-[11px] font-bold uppercase tracking-wider mb-2" style={{ color: "var(--text-secondary, #888)" }}>Tags</p>
              <div className="flex flex-wrap gap-1.5">
                {member.tags.map((tag) => (
                  <span key={tag.id} className="text-xs font-medium px-2.5 py-1 rounded-full" style={{ background: "var(--bg, #f5f5f5)", color: "var(--text-secondary, #888)" }}>
                    {tag.name}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Linked accounts */}
          <div>
            <p className="text-[11px] font-bold uppercase tracking-wider mb-2" style={{ color: "var(--text-secondary, #888)" }}>
              Linked Accounts {linkedAccounts.length > 0 && <span className="normal-case font-normal">({linkedAccounts.length})</span>}
            </p>
            {linkedAccounts.length === 0 ? (
              <p className="text-sm" style={{ color: "var(--text-secondary, #aaa)" }}>No linked accounts.</p>
            ) : (
              <div className="space-y-2">
                {linkedAccounts.map((account) => (
                  <div key={account.id} className="rounded-lg px-3 py-2.5 flex items-center gap-3" style={{ background: "var(--bg, #f5f5f5)", border: "1px solid var(--border, rgba(0,0,0,0.07))" }}>
                    <div className="h-8 w-8 rounded-lg flex items-center justify-center shrink-0" style={{ background: "rgba(226,34,34,0.08)", color: "var(--twilio-red, #e22)" }}>
                      <CorporateIcon className="w-4 h-4" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-[var(--twilio-navy)] truncate">{account.company_name}</p>
                      {account.industry && <p className="text-xs truncate" style={{ color: "var(--text-secondary, #888)" }}>{account.industry}</p>}
                    </div>
                    <span className="shrink-0 text-[11px] font-semibold px-2 py-0.5 rounded-md" style={ACCOUNT_STATUS_STYLE[account.status] ?? {}}>
                      {account.status}
                    </span>
                    <button
                      onClick={() => onRemoveFromAccount(account.id)}
                      className="shrink-0 text-[var(--twilio-gray-60)] hover:text-red-600 transition-colors ml-1"
                      aria-label={`Remove from ${account.company_name}`}
                      title={`Remove from ${account.company_name}`}
                    >
                      <svg viewBox="0 0 16 16" fill="currentColor" className="w-3.5 h-3.5">
                        <path d="M4.293 4.293a1 1 0 011.414 0L8 6.586l2.293-2.293a1 1 0 111.414 1.414L9.414 8l2.293 2.293a1 1 0 01-1.414 1.414L8 9.414l-2.293 2.293a1 1 0 01-1.414-1.414L6.586 8 4.293 5.707a1 1 0 010-1.414z"/>
                      </svg>
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Footer — edit button */}
        <div className="shrink-0 px-5 py-4" style={{ borderTop: "1px solid var(--border, rgba(0,0,0,0.08))" }}>
          <button
            onClick={onEdit}
            className="w-full py-2 text-sm font-semibold rounded-lg transition-opacity hover:opacity-90"
            style={{ background: "var(--twilio-red, #e22)", color: "#fff", border: "none" }}
          >
            Edit Member
          </button>
        </div>
      </div>
    </>
  );
}

export default function TeamPage() {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [search, setSearch] = useState("");
  const [modal, setModal] = useState<Partial<TeamMember> | null | "new">(null);
  const [selectedMember, setSelectedMember] = useState<TeamMember | null>(null);
  const [accountPanelOpen, setAccountPanelOpen] = useState(false);
  const [dropTargetMemberId, setDropTargetMemberId] = useState<number | null>(null);
  const [dropTargetAccountId, setDropTargetAccountId] = useState<number | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>("cards");
  const pageRef = useRef<HTMLDivElement>(null);
  useLogGlow(pageRef);

  const currentUser = useCurrentUser();
  const isStaffAdmin = !!(currentUser?.is_staff && currentUser?.staff_view_override);

  const {
    data: members,
    loading: isLoading,
    createMember,
    updateMember,
    deleteMember,
  } = useTeam({ search });

  // Role overrides (staff admin only) — persisted to localStorage
  const [roleOverrides, setRoleOverrides] = useState<Record<number, string>>(() => {
    try { return JSON.parse(localStorage.getItem("team_role_overrides") ?? "{}"); } catch { return {}; }
  });
  const [customGroups, setCustomGroups] = useState<CustomGroup[]>(() => {
    try { return JSON.parse(localStorage.getItem("team_custom_groups") ?? "[]"); } catch { return []; }
  });
  const [dropTargetRoleKey, setDropTargetRoleKey] = useState<string | null>(null);
  const [creatingGroup, setCreatingGroup] = useState(false);
  const [newGroupName, setNewGroupName] = useState("");
  const [newGroupColorIdx, setNewGroupColorIdx] = useState(0);

  useEffect(() => {
    if (isStaffAdmin) localStorage.setItem("team_role_overrides", JSON.stringify(roleOverrides));
  }, [roleOverrides, isStaffAdmin]);

  useEffect(() => {
    if (isStaffAdmin) localStorage.setItem("team_custom_groups", JSON.stringify(customGroups));
  }, [customGroups, isStaffAdmin]);

  function effectiveRole(member: TeamMember): string {
    return roleOverrides[member.id] ?? getTitleRole(member.title);
  }

  function getRoleMeta(key: string): RoleMeta {
    const custom = customGroups.find(g => g.key === key);
    if (custom) return custom;
    return (ROLE_META as Record<string, RoleMeta>)[key] ?? ROLE_META.other;
  }

  function handleDropOnRoleSection(e: React.DragEvent, targetRoleKey: string) {
    e.preventDefault();
    setDropTargetRoleKey(null);
    if (!isStaffAdmin) return;
    const memberId = Number(e.dataTransfer.getData("memberId"));
    if (!memberId) return;
    const member = members.find(m => m.id === memberId);
    if (!member || effectiveRole(member) === targetRoleKey) return;
    setRoleOverrides(prev => ({ ...prev, [memberId]: targetRoleKey }));
  }

  function clearOverride(memberId: number) {
    setRoleOverrides(prev => {
      const next = { ...prev };
      delete next[memberId];
      return next;
    });
  }

  function createCustomGroup() {
    if (!newGroupName.trim()) return;
    const c = CUSTOM_GROUP_COLORS[newGroupColorIdx];
    const key = `custom_${Date.now()}`;
    setCustomGroups(prev => [...prev, { key, label: newGroupName.trim(), ...c, slug: key }]);
    setNewGroupName("");
    setCreatingGroup(false);
  }

  function deleteCustomGroup(key: string) {
    setCustomGroups(prev => prev.filter(g => g.key !== key));
    // Clear any overrides pointing to this group
    setRoleOverrides(prev => {
      const next = { ...prev };
      for (const [id, role] of Object.entries(next)) {
        if (role === key) delete next[Number(id)];
      }
      return next;
    });
  }

  useEffect(() => {
    accountsApi.listAccounts().then(({ data }) => setAccounts(data.results)).catch(() => {});
  }, []);

  function notifyTeamUpdated() {
    window.dispatchEvent(new StorageEvent("storage", { key: "teamUpdated", newValue: Date.now().toString() }));
  }

  async function handleSave(form: Partial<TeamMember>) {
    // Strip blank strings from URL/optional fields so backend validators don't reject them
    const payload = Object.fromEntries(
      Object.entries(form).filter(([, v]) => v !== "")
    ) as Partial<TeamMember>;
    if (modal && modal !== "new" && modal.id) {
      const data = await updateMember(modal.id, payload);
      addLog({
        category: "team",
        message: `Team member "${data.full_name || data.email}" updated`,
        links: [{ label: "View team", path: "/team?glow=1" }],
      });
    } else {
      const data = await createMember(payload);
      addLog({
        category: "team",
        message: `Team member "${data.full_name || data.email}" added`,
        links: [{ label: "View team", path: "/team?glow=1" }],
      });
    }
    setModal(null);
    notifyTeamUpdated();
  }

  async function handleDelete(id: number) {
    const member = members.find((m) => m.id === id);
    await deleteMember(id);
    if (member) {
      addLog({
        category: "team",
        message: `Team member "${member.full_name || member.email}" removed`,
        links: [],
      });
    }
    setModal(null);
    setSelectedMember(null);
    notifyTeamUpdated();
  }

  async function handleAccountDrop(e: React.DragEvent, member: TeamMember) {
    e.preventDefault();
    setDropTargetMemberId(null);
    const accountId = Number(e.dataTransfer.getData("accountId"));
    if (!accountId) return;
    const existingIds: number[] = JSON.parse(e.dataTransfer.getData("accountTeamMemberIds") || "[]");
    if (existingIds.includes(member.id)) return;
    const { data } = await accountsApi.updateAccount(accountId, {
      team_member_ids: [...existingIds, member.id],
    } as Partial<Account>);
    setAccounts((prev) => prev.map((a) => (a.id === data.id ? data : a)));
  }

  async function handleMemberDropOnAccount(e: React.DragEvent, account: Account) {
    e.preventDefault();
    setDropTargetAccountId(null);
    const memberId = Number(e.dataTransfer.getData("memberId"));
    if (!memberId) return;
    const existing = (account.team_members ?? []).map((m) => m.id);
    if (existing.includes(memberId)) return;
    const { data } = await accountsApi.updateAccount(account.id, {
      team_member_ids: [...existing, memberId],
    } as Partial<Account>);
    setAccounts((prev) => prev.map((a) => (a.id === data.id ? data : a)));
  }

  return (
    <div ref={pageRef} className="relative h-full overflow-hidden">
      {/* Toggle button — floats at top-left, becomes sidebar header when open */}
      <button
        onClick={() => setAccountPanelOpen((v) => !v)}
        className="absolute top-4 left-4 z-30 flex items-center gap-2 rounded-full px-4 py-2 text-sm font-semibold shadow-sm transition-all"
        style={accountPanelOpen
          ? { background: "var(--twilio-red, #e22)", border: "1px solid var(--twilio-red, #e22)", color: "#fff" }
          : { background: "var(--surface, #fff)", border: "1px solid var(--border, rgba(0,0,0,0.08))", color: "var(--text-primary, #111)" }}
      >
        <svg viewBox="0 0 16 16" fill="currentColor" className="w-3.5 h-3.5 shrink-0">
          <path fillRule="evenodd" d="M3 4a1 1 0 011-1h8a1 1 0 110 2H4a1 1 0 01-1-1zM3 8a1 1 0 011-1h8a1 1 0 110 2H4a1 1 0 01-1-1zM3 12a1 1 0 011-1h4a1 1 0 110 2H4a1 1 0 01-1-1z" clipRule="evenodd"/>
        </svg>
        Accounts
      </button>

      {/* Accounts overlay sidebar */}
      <div
        className={["absolute top-0 left-0 h-full z-20 flex flex-col shadow-2xl transition-transform duration-300 w-96", accountPanelOpen ? "translate-x-0" : "-translate-x-full"].join(" ")}
        style={{ background: "var(--surface, #fff)", borderRight: "1px solid var(--border, rgba(0,0,0,0.08))" }}
      >
        {/* Space for the floating button above */}
        <div className="h-16 shrink-0" />
        <p className="px-4 pb-2 text-[11px] text-[var(--twilio-gray-60)]">Drag to a member card to add · or drag a member onto an account</p>
        <div className="flex-1 overflow-y-auto px-3 pb-3 space-y-2">
          {accounts.map((a) => (
            <DraggableAccountChip
              key={a.id}
              account={a}
              dropTarget={dropTargetAccountId === a.id}
              onDragOver={(e) => { e.preventDefault(); setDropTargetAccountId(a.id); }}
              onDragLeave={() => setDropTargetAccountId(null)}
              onDrop={(e) => void handleMemberDropOnAccount(e, a)}
            />
          ))}
          {accounts.length === 0 && <p className="text-sm text-[var(--twilio-gray-60)] px-1">No accounts found.</p>}
        </div>
      </div>

      {/* Main content — shifts right when accounts sidebar is open */}
      <div
        className="h-full overflow-auto px-6 pt-8 pb-4 transition-[padding] duration-300"
        style={{ paddingLeft: accountPanelOpen ? "calc(384px + 1.5rem)" : undefined }}
      >
        <div className="max-w-7xl mx-auto">
          <div className="flex items-center justify-between mb-6">
            <div>
              <h1 className="text-3xl font-semibold text-[var(--twilio-navy)] flex items-center gap-2"><TeamIcon width={24} height={24} style={{ flexShrink: 0 }} />Team</h1>
              <p className="text-sm text-[var(--twilio-navy)] mt-1">
                {members.length} member{members.length !== 1 ? "s" : ""} in your organisation.
              </p>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setModal("new")}
                className="rounded-md px-4 py-2 text-sm font-medium hover:opacity-90 transition-opacity"
                style={{ background: "var(--twilio-red, #e22)", color: "#fff", border: "none" }}
              >
                + Add member
              </button>
            </div>
          </div>

          <div className="flex flex-wrap gap-3 mb-6 items-center">
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by name, email, title…"
              className="rounded-md border border-gray-300 px-3 py-2 text-sm placeholder-gray-400 focus:border-red-400 focus:outline-none focus:ring-1 focus:ring-red-100 w-72"
            />
            <div className="ml-auto">
              <ViewToggle value={viewMode} onChange={setViewMode} />
            </div>
          </div>

          {isLoading ? (
            <div className="flex items-center justify-center h-40 text-sm text-[var(--twilio-navy)]">
              Loading team members…
            </div>
          ) : members.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-40 gap-3">
              <p className="text-sm text-[var(--twilio-navy)]">No team members found.</p>
              <button
                onClick={() => setModal("new")}
                className="text-sm underline hover:opacity-70"
                style={{ color: "var(--twilio-red, #e22)" }}
              >
                Add the first member
              </button>
            </div>
          ) : (() => {
            const allRoleKeys = [...ROLE_ORDER, ...customGroups.map(g => g.key)];
            const grouped = allRoleKeys.reduce<Record<string, TeamMember[]>>((acc, key) => {
              acc[key] = members
                .filter((m) => effectiveRole(m) === key)
                .sort((a, b) => a.full_name.localeCompare(b.full_name));
              return acc;
            }, {} as Record<string, TeamMember[]>);
            const activeRoles = allRoleKeys.filter((key) => grouped[key].length > 0);
            const sorted = activeRoles.flatMap((role) => grouped[role]);

            if (viewMode === "cards") {
              return (
                <div className="space-y-8">
                  {/* Staff admin: New Group button + form */}
                  {isStaffAdmin && (
                    <div style={{ display: "flex", alignItems: "center", gap: "10px", flexWrap: "wrap" }}>
                      {!creatingGroup ? (
                        <button
                          onClick={() => setCreatingGroup(true)}
                          style={{
                            fontSize: "0.75rem", fontWeight: 600, padding: "5px 14px",
                            borderRadius: "20px", border: "1.5px dashed var(--border, rgba(0,0,0,0.18))",
                            background: "transparent", color: "var(--text-secondary, #888)",
                            cursor: "pointer", transition: "border-color 0.12s, color 0.12s",
                          }}
                          onMouseEnter={e => { e.currentTarget.style.borderColor = "var(--twilio-red, #e22)"; e.currentTarget.style.color = "var(--twilio-red, #e22)"; }}
                          onMouseLeave={e => { e.currentTarget.style.borderColor = "var(--border, rgba(0,0,0,0.18))"; e.currentTarget.style.color = "var(--text-secondary, #888)"; }}
                        >
                          + New Group
                        </button>
                      ) : (
                        <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap", padding: "10px 14px", borderRadius: "10px", background: "var(--surface, #fff)", border: "1px solid var(--border, rgba(0,0,0,0.1))", boxShadow: "0 2px 8px rgba(0,0,0,0.06)" }}>
                          <input
                            autoFocus
                            value={newGroupName}
                            onChange={e => setNewGroupName(e.target.value)}
                            onKeyDown={e => { if (e.key === "Enter") createCustomGroup(); if (e.key === "Escape") setCreatingGroup(false); }}
                            placeholder="Group name…"
                            style={{ fontSize: "0.8125rem", padding: "4px 10px", borderRadius: "6px", border: "1px solid var(--border, rgba(0,0,0,0.15))", outline: "none", width: "160px", fontFamily: "var(--font-base)" }}
                          />
                          <div style={{ display: "flex", gap: "5px" }}>
                            {CUSTOM_GROUP_COLORS.map((c, i) => (
                              <button
                                key={i}
                                onClick={() => setNewGroupColorIdx(i)}
                                style={{ width: 20, height: 20, borderRadius: "50%", background: c.border, border: newGroupColorIdx === i ? "3px solid var(--twilio-navy, #0d1b2e)" : "2px solid transparent", cursor: "pointer", flexShrink: 0 }}
                                title={c.border}
                              />
                            ))}
                          </div>
                          <button
                            onClick={createCustomGroup}
                            disabled={!newGroupName.trim()}
                            style={{ fontSize: "0.75rem", fontWeight: 700, padding: "4px 12px", borderRadius: "6px", background: "var(--twilio-red, #e22)", color: "#fff", border: "none", cursor: newGroupName.trim() ? "pointer" : "not-allowed", opacity: newGroupName.trim() ? 1 : 0.5 }}
                          >
                            Create
                          </button>
                          <button
                            onClick={() => { setCreatingGroup(false); setNewGroupName(""); }}
                            style={{ fontSize: "0.75rem", color: "var(--text-secondary, #888)", background: "none", border: "none", cursor: "pointer" }}
                          >
                            Cancel
                          </button>
                        </div>
                      )}
                      {/* Custom group delete chips */}
                      {customGroups.map(g => (
                        <span
                          key={g.key}
                          style={{ display: "inline-flex", alignItems: "center", gap: "5px", fontSize: "0.6875rem", fontWeight: 600, padding: "3px 10px", borderRadius: "20px", background: g.bg, color: g.text }}
                        >
                          <span style={{ width: 6, height: 6, borderRadius: "50%", background: g.border }} />
                          {g.label}
                          <button
                            onClick={() => deleteCustomGroup(g.key)}
                            style={{ background: "none", border: "none", cursor: "pointer", padding: 0, color: g.text, opacity: 0.6, fontSize: "0.875rem", lineHeight: 1 }}
                            title={`Delete "${g.label}" group`}
                          >
                            ×
                          </button>
                        </span>
                      ))}
                    </div>
                  )}

                  {activeRoles.map((key) => {
                    const meta = getRoleMeta(key);
                    const isDropTarget = isStaffAdmin && dropTargetRoleKey === key && key !== "other";
                    const isCustom = customGroups.some(g => g.key === key);
                    return (
                      <div
                        key={key}
                        onDragOver={isStaffAdmin && key !== "other" ? (e) => {
                          if (e.dataTransfer.types.includes("memberid") || e.dataTransfer.types.includes("memberId")) {
                            e.preventDefault(); setDropTargetRoleKey(key);
                          }
                        } : undefined}
                        onDragLeave={isStaffAdmin && key !== "other" ? (e) => {
                          if (!e.currentTarget.contains(e.relatedTarget as Node)) setDropTargetRoleKey(null);
                        } : undefined}
                        onDrop={isStaffAdmin && key !== "other" ? (e) => handleDropOnRoleSection(e, key) : undefined}
                        style={isDropTarget ? {
                          outline: `2px dashed ${meta.border}`,
                          outlineOffset: "4px",
                          borderRadius: "10px",
                          padding: "4px",
                        } : undefined}
                      >
                        <div className="flex items-center gap-2 mb-3">
                          <span className="inline-block w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: meta.border }} />
                          <h2 className="text-sm font-bold uppercase tracking-widest text-[var(--twilio-navy)]">{meta.label}</h2>
                          {isStaffAdmin && key !== "other" && (
                            <span style={{ fontSize: "0.6rem", color: "var(--text-secondary, #aaa)", fontStyle: "italic", fontWeight: 400 }}>
                              {isDropTarget ? "↓ drop to assign" : "drag 'other' members here"}
                            </span>
                          )}
                          {isCustom && isStaffAdmin && (
                            <span style={{ fontSize: "0.6rem", fontWeight: 600, padding: "1px 6px", borderRadius: "6px", background: meta.bg, color: meta.text }}>
                              custom
                            </span>
                          )}
                        </div>
                        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 items-start">
                          {grouped[key].map((member) => {
                            const hasOverride = member.id in roleOverrides;
                            return (
                              <MemberCard
                                key={member.id}
                                member={member}
                                onSelect={(m) => setSelectedMember(m)}
                                dropTarget={dropTargetMemberId === member.id}
                                onDragOver={(e) => { e.stopPropagation(); e.preventDefault(); setDropTargetMemberId(member.id); }}
                                onDragLeave={() => setDropTargetMemberId(null)}
                                onDrop={(e) => { e.stopPropagation(); void handleAccountDrop(e, member); }}
                                roleMeta={hasOverride ? meta : undefined}
                                isOverridden={isStaffAdmin && hasOverride}
                                onClearOverride={isStaffAdmin && hasOverride ? () => clearOverride(member.id) : undefined}
                              />
                            );
                          })}
                        </div>
                      </div>
                    );
                  })}
                </div>
              );
            }

            if (viewMode === "list") {
              return (
                <div className="space-y-1">
                  {sorted.map((member) => {
                    const role = getTitleRole(member.title);
                    const colors = ROLE_META[role];
                    const initials = member.full_name.split(" ").map((n) => n[0]).join("").toUpperCase().slice(0, 2);
                    return (
                      <button
                        key={member.id}
                        onClick={() => setSelectedMember(member)}
                        onDragOver={(e) => { e.preventDefault(); setDropTargetMemberId(member.id); }}
                        onDragLeave={() => setDropTargetMemberId(null)}
                        onDrop={(e) => void handleAccountDrop(e, member)}
                        className="w-full text-left flex items-center gap-4 rounded-xl px-4 py-3 transition-all"
                        style={dropTargetMemberId === member.id
                          ? { background: "rgba(226,34,34,0.04)", border: `2px solid ${colors.border}`, borderLeft: `4px solid ${colors.border}` }
                          : { background: "var(--surface, #fff)", border: "1px solid var(--border, rgba(0,0,0,0.08))", borderLeft: `4px solid ${colors.border}`, boxShadow: "0 1px 4px rgba(0,0,0,0.04)" }}
                      >
                        {member.avatar_url ? (
                          <img src={member.avatar_url} alt={member.full_name} className="h-8 w-8 rounded-full object-cover shrink-0" />
                        ) : (
                          <div className="h-8 w-8 rounded-full flex items-center justify-center text-[11px] font-semibold shrink-0" style={{ backgroundColor: colors.bg, color: colors.text }}>
                            {initials}
                          </div>
                        )}
                        <p className="w-44 shrink-0 text-sm font-semibold text-[var(--twilio-navy)] truncate">{member.full_name}</p>
                        <div className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: colors.border }} />
                        <p className="flex-1 text-sm text-[var(--twilio-navy)] truncate">{member.title || "—"}</p>
                        <p className="w-32 shrink-0 text-sm text-[var(--twilio-navy)] truncate">{member.department || "—"}</p>
                        <p className="w-48 shrink-0 text-sm truncate" style={{ color: "var(--twilio-red, #e22)" }}>{member.email}</p>
                      </button>
                    );
                  })}
                </div>
              );
            }

            // table
            return (
              <div className="rounded-xl overflow-hidden" style={{ background: "var(--surface, #fff)", border: "1px solid var(--border, rgba(0,0,0,0.08))", boxShadow: "0 1px 4px rgba(0,0,0,0.06)" }}>
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs font-bold uppercase tracking-wide" style={{ background: "var(--bg, #f5f5f5)", borderBottom: "1px solid var(--border, rgba(0,0,0,0.08))", color: "var(--text-secondary, #888)" }}>
                      <th className="px-4 py-3">Name</th>
                      <th className="px-4 py-3">Role</th>
                      <th className="px-4 py-3">Title</th>
                      <th className="px-4 py-3">Department</th>
                      <th className="px-4 py-3">Email</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sorted.map((member) => {
                      const role = getTitleRole(member.title);
                      const colors = ROLE_META[role];
                      const initials = member.full_name.split(" ").map((n) => n[0]).join("").toUpperCase().slice(0, 2);
                      return (
                        <tr
                          key={member.id}
                          onClick={() => setSelectedMember(member)}
                          onDragOver={(e) => { e.preventDefault(); setDropTargetMemberId(member.id); }}
                          onDragLeave={() => setDropTargetMemberId(null)}
                          onDrop={(e) => void handleAccountDrop(e, member)}
                          className="cursor-pointer transition-colors"
                          style={dropTargetMemberId === member.id
                            ? { background: "rgba(226,34,34,0.04)", outline: `2px solid ${colors.border}` }
                            : { borderBottom: "1px solid var(--border, rgba(0,0,0,0.06))" }}
                        >
                          <td className="px-4 py-3">
                            <div className="flex items-center gap-2.5">
                              <div className="w-1 self-stretch rounded-full shrink-0" style={{ backgroundColor: colors.border }} />
                              {member.avatar_url ? (
                                <img src={member.avatar_url} alt={member.full_name} className="h-7 w-7 rounded-full object-cover shrink-0" />
                              ) : (
                                <div className="h-7 w-7 rounded-full flex items-center justify-center text-[11px] font-semibold shrink-0" style={{ backgroundColor: colors.bg, color: colors.text }}>
                                  {initials}
                                </div>
                              )}
                              <span className="font-medium text-[var(--twilio-navy)] truncate max-w-[140px]">{member.full_name}</span>
                            </div>
                          </td>
                          <td className="px-4 py-3">
                            <span className="text-xs font-semibold rounded-md px-2 py-1" style={{ backgroundColor: colors.bg, color: colors.text }}>{role}</span>
                          </td>
                          <td className="px-4 py-3 text-[var(--twilio-navy)] max-w-[160px] truncate">{member.title || "—"}</td>
                          <td className="px-4 py-3 text-[var(--twilio-navy)]">{member.department || "—"}</td>
                          <td className="px-4 py-3 truncate max-w-[180px]" style={{ color: "var(--twilio-red, #e22)" }}>{member.email}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            );
          })()}
        </div>
      </div>

      {/* Member detail sidebar */}
      {selectedMember !== null && (
        <MemberDetailSidebar
          member={selectedMember}
          accounts={accounts}
          onClose={() => setSelectedMember(null)}
          onEdit={() => { setModal(selectedMember); setSelectedMember(null); }}
          onRemoveFromAccount={async (accountId) => {
            const { data } = await accountsApi.removeTeamMember(accountId, selectedMember.id);
            setAccounts((prev) => prev.map((a) => (a.id === data.id ? data : a)));
          }}
        />
      )}

      {/* Edit / create modal */}
      {modal !== null && (
        <MemberModal
          member={modal === "new" ? null : modal}
          allMembers={members}
          onClose={() => setModal(null)}
          onSave={handleSave}
          onDelete={handleDelete}
        />
      )}
    </div>
  );
}
