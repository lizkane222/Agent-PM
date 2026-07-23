import React, { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { accountsApi, teamApi } from "../lib/api";
import CorporateIcon from "../assets/icons/Corporate.svg?react";
import type { Account, AccountNote, AccountTeamMember, TeamMember, UserProfile } from "../types";
import { getTitleRole, ROLE_META } from "../lib/titleRoles";
import { formatArr } from "twilio-agent-pm-shared";
import { addLog } from "../lib/appLog";
import { useExport } from "../context/ExportContext";
import { useRightClickComment } from "../components/comments/CommentContext";

type ViewMode = "cards" | "list" | "table";

const STATUS_COLORS: Record<Account["status"], React.CSSProperties> = {
  prospect: { background: "#fef9c3", color: "#a16207" },
  active: { background: "#dcfce7", color: "#15803d" },
  inactive: { background: "var(--bg, #f5f5f5)", color: "var(--text-secondary, #888)" },
  churned: { background: "#fee2e2", color: "#dc2626" },
};

const EMPTY_FORM: Partial<Account> & { team_member_ids?: number[] } = {
  company_name: "",
  website: "",
  industry: "",
  status: "prospect",
  arr: null,
  owner: null,
  primary_contact: null,
  team_member_ids: [],
};


function MemberAvatars({ members }: { members: AccountTeamMember[] }) {
  if (!members.length) return <span className="text-sm text-[var(--twilio-gray-60)]">—</span>;
  return (
    <div className="flex items-center gap-1 flex-wrap">
      {members.map((m) => {
        const initials = m.full_name.split(" ").map((n) => n[0]).join("").toUpperCase().slice(0, 2);
        const mc = ROLE_META[getTitleRole(m.title)];
        return (
          <div key={m.id} className="group relative flex items-center">
            {m.avatar_url ? (
              <img src={m.avatar_url} alt={m.full_name} className="h-7 w-7 rounded-full object-cover ring-2 ring-white" />
            ) : (
              <div
                className="h-7 w-7 rounded-full flex items-center justify-center text-[11px] font-semibold ring-2 ring-white"
                style={{ backgroundColor: mc.bg, color: mc.text }}
              >
                {initials}
              </div>
            )}
            <span className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1.5 hidden group-hover:block bg-[var(--twilio-navy)] text-white text-[11px] rounded px-2 py-0.5 whitespace-nowrap z-10">
              {m.full_name}{m.title ? ` · ${m.title}` : ""}
            </span>
          </div>
        );
      })}
    </div>
  );
}

function TeamMemberMultiSelect({
  members,
  selectedIds,
  onChange,
}: {
  members: TeamMember[];
  selectedIds: number[];
  onChange: (ids: number[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function handler(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const selectedNames = members.filter((m) => selectedIds.includes(m.id)).map((m) => m.full_name);

  return (
    <div ref={ref} style={{ position: "relative" }}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-red-400 focus:outline-none focus:ring-1 focus:ring-red-200 bg-white"
        style={{ color: "var(--text-primary, #111)", textAlign: "left" }}
      >
        <span className="truncate" style={{ color: selectedNames.length ? "var(--text-primary, #111)" : "var(--twilio-gray-60)" }}>
          {selectedNames.length === 0
            ? "Select team members…"
            : selectedNames.length === 1
            ? selectedNames[0]
            : `${selectedNames.length} members selected`}
        </span>
        <svg viewBox="0 0 16 16" fill="currentColor" className={`w-3.5 h-3.5 shrink-0 ml-2 transition-transform ${open ? "rotate-180" : ""}`} style={{ color: "var(--twilio-gray-60)" }}>
          <path fillRule="evenodd" d="M1.646 4.646a.5.5 0 01.708 0L8 10.293l5.646-5.647a.5.5 0 01.708.708l-6 6a.5.5 0 01-.708 0l-6-6a.5.5 0 010-.708z"/>
        </svg>
      </button>
      {selectedNames.length > 0 && (
        <div className="flex flex-wrap gap-1 mt-1.5">
          {members.filter((m) => selectedIds.includes(m.id)).map((m) => (
            <span key={m.id} className="flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded-full" style={{ background: "rgba(226,34,34,0.08)", color: "var(--twilio-red, #e22)" }}>
              {m.full_name}
              <button type="button" onClick={() => onChange(selectedIds.filter((id) => id !== m.id))} style={{ lineHeight: 1, background: "none", border: "none", cursor: "pointer", color: "inherit", padding: 0, fontSize: "0.875rem" }}>×</button>
            </span>
          ))}
        </div>
      )}
      {open && (
        <div
          style={{ position: "absolute", top: "calc(100% + 4px)", left: 0, right: 0, zIndex: 100, background: "#fff", border: "1px solid #e5e7eb", borderRadius: "8px", boxShadow: "0 4px 16px rgba(0,0,0,0.12)", maxHeight: "220px", overflowY: "auto" }}
        >
          {members.map((m) => {
            const checked = selectedIds.includes(m.id);
            return (
              <label
                key={m.id}
                className="flex items-center gap-2.5 px-3 py-2 cursor-pointer hover:bg-gray-50 transition-colors"
                style={{ userSelect: "none" }}
              >
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() => onChange(checked ? selectedIds.filter((id) => id !== m.id) : [...selectedIds, m.id])}
                  className="accent-red-500 w-3.5 h-3.5 shrink-0"
                  onClick={(e) => e.stopPropagation()}
                />
                <span className="text-sm font-medium" style={{ color: "var(--text-primary, #111)" }}>{m.full_name}</span>
                {m.title && <span className="text-[11px] text-[var(--twilio-gray-60)] truncate">· {m.title}</span>}
              </label>
            );
          })}
          {members.length === 0 && <p className="text-sm text-[var(--twilio-gray-60)] px-3 py-2">No team members found.</p>}
        </div>
      )}
    </div>
  );
}

function AccountModal({
  account,
  members,
  onClose,
  onSave,
  onDelete,
}: {
  account: Partial<Account> | null;
  members: TeamMember[];
  onClose: () => void;
  onSave: (data: Partial<Account> & { team_member_ids?: number[] }) => Promise<void>;
  onDelete: (id: number) => Promise<void>;
}) {
  const initialIds = account ? (account.team_members ?? []).map((m) => m.id) : [];
  const [form, setForm] = useState<Partial<Account> & { team_member_ids?: number[] }>({
    ...(account ?? EMPTY_FORM),
    team_member_ids: initialIds,
  });
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const firstInput = useRef<HTMLInputElement>(null);

  useEffect(() => { firstInput.current?.focus(); }, []);

  const isNew = !account?.id;
  const set = (key: keyof Account, value: unknown) => setForm((f) => ({ ...f, [key]: value }));

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/40" onClick={onClose}>
      <div className="rounded-xl shadow-xl w-full max-w-lg mx-4 p-6" style={{ background: "var(--surface, #fff)", fontFamily: "var(--font-base)" }} onClick={(e) => e.stopPropagation()}>
        <h2 className="text-xl font-semibold mb-5" style={{ color: "var(--text-primary, #111)" }}>
          {isNew ? "New Account" : "Edit Account"}
        </h2>

        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-[var(--twilio-navy)] mb-1">Company name *</label>
            <input
              ref={firstInput}
              value={form.company_name ?? ""}
              onChange={(e) => set("company_name", e.target.value)}
              className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-red-400 focus:outline-none focus:ring-1 focus:ring-red-200"
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-[var(--twilio-navy)] mb-1">Status</label>
              <select
                value={form.status ?? "prospect"}
                onChange={(e) => set("status", e.target.value)}
                className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-red-400 focus:outline-none focus:ring-1 focus:ring-red-200"
              >
                <option value="prospect">Prospect</option>
                <option value="active">Active</option>
                <option value="inactive">Inactive</option>
                <option value="churned">Churned</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-[var(--twilio-navy)] mb-1">Industry</label>
              <input
                value={form.industry ?? ""}
                onChange={(e) => set("industry", e.target.value)}
                className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-red-400 focus:outline-none focus:ring-1 focus:ring-red-200"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-[var(--twilio-navy)] mb-1">Website</label>
              <input
                value={form.website ?? ""}
                onChange={(e) => set("website", e.target.value)}
                placeholder="https://…"
                className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-red-400 focus:outline-none focus:ring-1 focus:ring-red-200"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-[var(--twilio-navy)] mb-1">ARR ($)</label>
              <input
                type="number"
                value={form.arr ?? ""}
                onChange={(e) => set("arr", e.target.value || null)}
                placeholder="0"
                className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-red-400 focus:outline-none focus:ring-1 focus:ring-red-200"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-[var(--twilio-navy)] mb-1">Primary contact</label>
              <select
                value={form.primary_contact ?? ""}
                onChange={(e) => set("primary_contact", e.target.value ? Number(e.target.value) : null)}
                className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-red-400 focus:outline-none focus:ring-1 focus:ring-red-200"
              >
                <option value="">None</option>
                {members.map((m) => <option key={m.id} value={m.id}>{m.full_name}</option>)}
              </select>
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-[var(--twilio-navy)] mb-1">Team members</label>
            <TeamMemberMultiSelect
              members={members}
              selectedIds={form.team_member_ids ?? []}
              onChange={(ids) => setForm((f) => ({ ...f, team_member_ids: ids }))}
            />
          </div>
        </div>

        <div className="flex items-center justify-between mt-6">
          {!isNew ? (
            confirmDelete ? (
              <div className="flex gap-2 items-center">
                <span className="text-sm text-[var(--twilio-navy)]">Sure?</span>
                <button
                  onClick={async () => { setDeleting(true); await onDelete(account!.id!); setDeleting(false); }}
                  disabled={deleting}
                  className="rounded-md px-3 py-1.5 text-sm font-medium bg-red-600 text-white hover:bg-red-700 disabled:opacity-50"
                >
                  {deleting ? "Deleting…" : "Yes, delete"}
                </button>
                <button onClick={() => setConfirmDelete(false)} className="rounded-md px-3 py-1.5 text-sm hover:opacity-80 transition-opacity" style={{ border: "1px solid var(--border, rgba(0,0,0,0.08))", color: "var(--text-primary, #111)" }}>Cancel</button>
              </div>
            ) : (
              <button onClick={() => setConfirmDelete(true)} className="text-sm text-red-500 hover:text-red-700">Delete account</button>
            )
          ) : <span />}
          <div className="flex gap-2">
            <button onClick={onClose} className="rounded-md px-4 py-2 text-sm font-medium hover:opacity-80 transition-opacity" style={{ border: "1px solid var(--border, rgba(0,0,0,0.08))", color: "var(--text-primary, #111)", background: "var(--surface, #fff)" }}>Cancel</button>
            <button
              onClick={async () => { setSaving(true); await onSave(form); setSaving(false); }}
              disabled={saving || !form.company_name}
              className="rounded-md px-4 py-2 text-sm font-medium disabled:opacity-50 hover:opacity-90 transition-opacity"
              style={{ background: "var(--twilio-red, #e22)", color: "#fff", border: "none" }}
            >
              {saving ? "Saving…" : isNew ? "Create" : "Save"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function AccountDetail({
  account,
  onEdit,
  onClose,
}: {
  account: Account;
  onEdit: () => void;
  onClose: () => void;
}) {
  const [notes, setNotes] = useState<AccountNote[]>([]);
  const [loadingNotes, setLoadingNotes] = useState(true);
  const [newNote, setNewNote] = useState("");
  const [posting, setPosting] = useState(false);

  useEffect(() => {
    setLoadingNotes(true);
    accountsApi.listNotes(account.id)
      .then(({ data }) => setNotes(data))
      .catch(() => setNotes([]))
      .finally(() => setLoadingNotes(false));
  }, [account.id]);

  async function submitNote() {
    if (!newNote.trim()) return;
    setPosting(true);
    try {
      const { data } = await accountsApi.createNote(account.id, newNote.trim());
      setNotes((n) => [data, ...n]);
      setNewNote("");
    } finally {
      setPosting(false);
    }
  }

  async function deleteNote(noteId: number) {
    await accountsApi.deleteNote(noteId);
    setNotes((n) => n.filter((x) => x.id !== noteId));
  }

  return (
    <div className="fixed inset-0 z-40 flex bg-black/40" onClick={onClose}>
      <div className="ml-auto h-full w-full max-w-md shadow-xl flex flex-col" style={{ background: "var(--surface, #fff)", fontFamily: "var(--font-base)" }} onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-6 py-4" style={{ borderBottom: "1px solid var(--border, rgba(0,0,0,0.08))" }}>
          <h2 className="text-lg font-semibold truncate" style={{ color: "var(--text-primary, #111)" }}>{account.company_name}</h2>
          <div className="flex gap-2">
            <button onClick={onEdit} className="text-sm font-medium" style={{ color: "var(--twilio-red, #e22)" }}>Edit</button>
            <button onClick={onClose} className="text-xl leading-none" style={{ color: "var(--text-secondary, #888)" }}>✕</button>
          </div>
        </div>

        <div className="px-6 py-4 space-y-2" style={{ borderBottom: "1px solid var(--border, rgba(0,0,0,0.08))" }}>
          <div className="flex gap-2 flex-wrap">
            <span className="rounded-md px-2 py-1 text-sm font-medium" style={STATUS_COLORS[account.status]}>
              {account.status}
            </span>
            {account.industry && <span className="text-sm text-[var(--twilio-navy)]">{account.industry}</span>}
          </div>
          <div className="grid grid-cols-2 gap-2 text-sm text-[var(--twilio-navy)]">
            <div><span className="text-[var(--twilio-navy)]">ARR</span> {formatArr(account.arr)}</div>
            {account.owner_username && <div><span className="text-[var(--twilio-navy)]">Owner</span> {account.owner_username}</div>}
            {account.primary_contact_name && <div><span className="text-[var(--twilio-navy)]">Contact</span> {account.primary_contact_name}</div>}
            {account.website && (
              <div className="col-span-2 truncate">
                <span className="text-[var(--twilio-navy)]">Website</span>{" "}
                <a href={account.website} target="_blank" rel="noreferrer" className="hover:underline" style={{ color: "var(--twilio-red, #e22)" }}>{account.website}</a>
              </div>
            )}
          </div>
          {account.team_members?.length > 0 && (
            <div className="mt-3 pt-3" style={{ borderTop: "1px solid var(--border, rgba(0,0,0,0.08))" }}>
              <p className="text-[11px] font-bold uppercase tracking-widest text-[var(--twilio-gray-60)] mb-2">Team</p>
              <div className="space-y-2">
                {account.team_members.map((m) => {
                  const mc = ROLE_META[getTitleRole(m.title)];
                  return (
                  <div key={m.id} className="flex items-center gap-2.5">
                    {m.avatar_url ? (
                      <img src={m.avatar_url} alt={m.full_name} className="h-7 w-7 rounded-full object-cover shrink-0" />
                    ) : (
                      <div
                        className="h-7 w-7 rounded-full flex items-center justify-center text-[11px] font-semibold shrink-0"
                        style={{ backgroundColor: mc.bg, color: mc.text }}
                      >
                        {m.full_name.split(" ").map((n) => n[0]).join("").toUpperCase().slice(0, 2)}
                      </div>
                    )}
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-[var(--twilio-navy)] truncate">{m.full_name}</p>
                      {m.title && <p className="text-[11px] text-[var(--twilio-gray-60)] truncate">{m.title}</p>}
                    </div>
                    {m.slack_handle && (
                      <span className="ml-auto text-[11px] text-[var(--twilio-gray-60)] shrink-0">@{m.slack_handle}</span>
                    )}
                  </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-4">
          <h3 className="text-sm font-semibold mb-3 uppercase tracking-wide" style={{ color: "var(--text-secondary, #888)" }}>Activity log</h3>

          <div className="flex gap-2 mb-4">
            <textarea
              value={newNote}
              onChange={(e) => setNewNote(e.target.value)}
              rows={2}
              placeholder="Add a note…"
              className="flex-1 rounded-md px-3 py-2 text-sm resize-none focus:outline-none"
              style={{ border: "1px solid var(--border, rgba(0,0,0,0.08))", background: "var(--bg, #f5f5f5)", color: "var(--text-primary, #111)" }}
            />
            <button
              onClick={() => void submitNote()}
              disabled={posting || !newNote.trim()}
              className="shrink-0 self-end rounded-md px-3 py-2 text-sm font-medium disabled:opacity-50 hover:opacity-90 transition-opacity"
              style={{ background: "var(--twilio-red, #e22)", color: "#fff", border: "none" }}
            >
              {posting ? "…" : "Add"}
            </button>
          </div>

          {loadingNotes ? (
            <p className="text-sm" style={{ color: "var(--text-secondary, #888)" }}>Loading…</p>
          ) : notes.length === 0 ? (
            <p className="text-sm" style={{ color: "var(--text-secondary, #888)" }}>No notes yet.</p>
          ) : (
            <div className="space-y-3">
              {notes.map((note) => (
                <div key={note.id} className="rounded-lg p-3" style={{ background: "var(--bg, #f5f5f5)" }}>
                  <div className="flex items-start justify-between gap-2">
                    <p className="text-sm flex-1" style={{ color: "var(--text-primary, #111)" }}>{note.content}</p>
                    <button onClick={() => void deleteNote(note.id)} className="shrink-0 text-sm hover:text-red-500" style={{ color: "var(--text-secondary, #888)" }}>✕</button>
                  </div>
                  <p className="text-xs mt-1" style={{ color: "var(--text-secondary, #888)" }}>
                    {note.author_display || note.author_username || "Unknown"} · {new Date(note.created_at).toLocaleDateString()}
                  </p>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

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

// ── Draggable member chip (used in the Team Members sidebar) ─────────────────

function DraggableMemberChip({
  member,
  accounts,
  dropTarget,
  onDragOver,
  onDragLeave,
  onDrop,
}: {
  member: TeamMember;
  accounts: Account[];
  dropTarget?: boolean;
  onDragOver?: (e: React.DragEvent) => void;
  onDragLeave?: () => void;
  onDrop?: (e: React.DragEvent) => void;
}) {
  const navigate = useNavigate();
  const [accountsOpen, setAccountsOpen] = useState(false);
  const initials = member.full_name.split(" ").map((n) => n[0]).join("").toUpperCase().slice(0, 2);
  const role = getTitleRole(member.title);
  const colors = ROLE_META[role];
  const memberAccounts = accounts.filter((a) =>
    (a.team_members ?? []).some((m) => m.id === member.id)
  );
  return (
    <div
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData("memberId", String(member.id));
        e.dataTransfer.effectAllowed = "copy";
      }}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      className="card-btn w-full text-left cursor-grab active:cursor-grabbing transition-all select-none"
      style={{
        padding: 0, borderRadius: "8px", overflow: "hidden",
        background: "var(--surface, #fff)",
        border: dropTarget ? `2px solid ${colors.border}` : "1px solid var(--border, rgba(0,0,0,0.08))",
        boxShadow: dropTarget ? `0 0 0 3px ${colors.bg}` : "0 1px 4px rgba(0,0,0,0.06)",
        transition: "box-shadow 0.15s, border-color 0.15s",
      }}
    >
      {/* Top accent bar — role colour */}
      <div style={{ height: "4px", background: colors.border }} />
      <div style={{ padding: "14px 16px 10px" }}>
        <div className="flex items-start gap-4">
          {member.avatar_url ? (
            <img src={member.avatar_url} alt={member.full_name} style={{ height: "44px", width: "44px", borderRadius: "10px", objectFit: "cover", flexShrink: 0 }} />
          ) : (
            <div style={{ height: "44px", width: "44px", borderRadius: "10px", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "0.875rem", fontWeight: 600, flexShrink: 0, background: colors.bg, color: colors.text }}>
              {initials}
            </div>
          )}
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold truncate" style={{ color: "var(--text-primary, #111)" }}>{member.full_name}</p>
            {member.title && <p className="text-sm mt-0.5 truncate" style={{ color: "var(--text-secondary, #888)" }}>{member.title}</p>}
            {member.email && <p className="text-sm mt-1 truncate" style={{ color: colors.border }}>{member.email}</p>}
          </div>
        </div>

        {/* Accounts toggle */}
        <button
          className="card-btn"
          onClick={(e) => { e.stopPropagation(); setAccountsOpen((v) => !v); }}
          style={{
            marginTop: "10px", width: "100%", display: "flex", alignItems: "center",
            justifyContent: "space-between", padding: "6px 10px", borderRadius: "6px",
            background: accountsOpen ? colors.bg : "var(--bg, #f5f5f5)",
            border: "none", cursor: "pointer", color: "var(--text-secondary, #888)",
            fontSize: "0.75rem", fontWeight: 600,
          }}
        >
          <span style={{ color: accountsOpen ? colors.text : "var(--text-secondary, #888)" }}>
            {memberAccounts.length} account{memberAccounts.length !== 1 ? "s" : ""}
          </span>
          <svg viewBox="0 0 16 16" fill="currentColor" style={{ width: "12px", height: "12px", transition: "transform 0.15s", transform: accountsOpen ? "rotate(180deg)" : "rotate(0deg)", color: colors.border }}>
            <path fillRule="evenodd" d="M4.47 6.47a.75.75 0 011.06 0L8 8.94l2.47-2.47a.75.75 0 111.06 1.06l-3 3a.75.75 0 01-1.06 0l-3-3a.75.75 0 010-1.06z" clipRule="evenodd"/>
          </svg>
        </button>

        {/* Accounts list */}
        {accountsOpen && (
          <div style={{ marginTop: "6px", display: "flex", flexDirection: "column", gap: "4px" }}>
            {memberAccounts.length === 0 ? (
              <p style={{ fontSize: "0.75rem", color: "var(--text-secondary, #888)", padding: "4px 10px" }}>No accounts assigned</p>
            ) : memberAccounts.map((acct) => (
              <button
                key={acct.id}
                className="card-btn"
                onClick={(e) => { e.stopPropagation(); navigate(`/accounts/${acct.id}`); }}
                style={{
                  display: "flex", alignItems: "center", justifyContent: "space-between",
                  width: "100%", padding: "6px 10px", borderRadius: "6px", border: "none",
                  background: "var(--bg, #f5f5f5)", cursor: "pointer", gap: "8px",
                  fontSize: "0.75rem", textAlign: "left",
                }}
              >
                <span style={{ fontWeight: 600, color: "var(--text-primary, #111)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {acct.company_name}
                </span>
                <span style={{ flexShrink: 0, fontSize: "0.6875rem", fontWeight: 600, padding: "1px 6px", borderRadius: "4px", ...(STATUS_COLORS[acct.status] as React.CSSProperties) }}>
                  {acct.status}
                </span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function AccountCardButton({
  acct,
  exportMode,
  sel,
  dropTargetId,
  onDragStart,
  onClick,
  onDragOver,
  onDragLeave,
  onDrop,
}: {
  acct: Account;
  exportMode: boolean;
  sel: boolean;
  dropTargetId: number | null;
  onDragStart: (e: React.DragEvent) => void;
  onClick: () => void;
  onDragOver: (e: React.DragEvent) => void;
  onDragLeave: () => void;
  onDrop: (e: React.DragEvent) => void;
}) {
  const { onContextMenu } = useRightClickComment("account", acct.id, acct.company_name);
  return (
    <button
      key={acct.id}
      draggable={!exportMode}
      onDragStart={onDragStart}
      onClick={onClick}
      onContextMenu={onContextMenu}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      className="card-btn w-full text-left transition-all cursor-grab active:cursor-grabbing"
      style={{
        padding: 0, borderRadius: "8px", overflow: "hidden",
        background: sel ? "rgba(226,35,26,0.04)" : "var(--surface, #fff)", fontFamily: "var(--font-base)",
        border: sel ? "2px solid var(--twilio-red, #e22)" : dropTargetId === acct.id ? "2px solid var(--twilio-red, #e22)" : "1px solid var(--border, rgba(0,0,0,0.08))",
        boxShadow: sel ? "0 0 0 3px rgba(226,34,34,0.12)" : dropTargetId === acct.id ? "0 0 0 3px rgba(226,34,34,0.08)" : "0 1px 4px rgba(0,0,0,0.06)",
        cursor: exportMode ? "pointer" : "grab",
      }}
      onMouseEnter={e => { if (!sel && dropTargetId !== acct.id) e.currentTarget.style.boxShadow = "0 4px 16px rgba(0,0,0,0.1)"; }}
      onMouseLeave={e => { if (!sel && dropTargetId !== acct.id) e.currentTarget.style.boxShadow = "0 1px 4px rgba(0,0,0,0.06)"; }}
    >
      <div style={{ padding: "16px 20px 14px" }}>
        <div style={{ display: "flex", alignItems: "flex-start", gap: "14px" }}>
          <div style={{ height: "44px", width: "44px", borderRadius: "12px", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, background: "rgba(226,34,34,0.08)", color: "var(--twilio-red, #e22)" }}>
            <CorporateIcon style={{ width: "20px", height: "20px" }} />
          </div>
          <div style={{ flex: 1, minWidth: 0, paddingTop: "2px" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "8px" }}>
              <h3 style={{ margin: 0, fontSize: "0.9375rem", fontWeight: 700, color: "var(--text-primary, #111)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{acct.company_name}</h3>
              <span style={{ flexShrink: 0, fontSize: "0.6875rem", fontWeight: 600, padding: "2px 8px", borderRadius: "6px", ...STATUS_COLORS[acct.status] }}>
                {acct.status}
              </span>
            </div>
            {acct.industry && <p style={{ margin: "3px 0 0", fontSize: "0.8125rem", color: "var(--text-secondary, #888)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{acct.industry}</p>}
            {acct.arr && <p style={{ margin: "2px 0 0", fontSize: "0.8125rem", color: "var(--text-primary, #111)", fontVariantNumeric: "tabular-nums" }}>{formatArr(acct.arr)}</p>}
            {acct.primary_contact_name && (
              <p style={{ margin: "4px 0 0", fontSize: "0.75rem", color: "var(--twilio-red, #e22)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{acct.primary_contact_name}</p>
            )}
          </div>
        </div>
        {(acct.team_members ?? []).length > 0 && (
          <div style={{ marginTop: "12px", paddingTop: "10px", borderTop: "1px solid var(--border, rgba(0,0,0,0.06))", display: "flex", alignItems: "center", gap: "4px", flexWrap: "wrap" }}>
            {(acct.team_members ?? []).map((m) => {
              const ini = m.full_name.split(" ").map((n) => n[0]).join("").toUpperCase().slice(0, 2);
              const mc = ROLE_META[getTitleRole(m.title)];
              return m.avatar_url ? (
                <img key={m.id} src={m.avatar_url} alt={m.full_name} title={m.full_name} style={{ height: "24px", width: "24px", borderRadius: "6px", objectFit: "cover" }} />
              ) : (
                <div key={m.id} title={m.full_name} style={{ height: "24px", width: "24px", borderRadius: "6px", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "0.5625rem", fontWeight: 700, backgroundColor: mc.bg, color: mc.text }}>
                  {ini}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </button>
  );
}

export default function AccountsPage() {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [myProfile, setMyProfile] = useState<UserProfile | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [total, setTotal] = useState(0);
  const navigate = useNavigate();
  const { exportMode, toggleItem, isSelected } = useExport();
  const [modal, setModal] = useState<Partial<Account> | null | "new">(null);
  const [detail, setDetail] = useState<Account | null>(null);
  const [memberPanelOpen, setMemberPanelOpen] = useState(false);
  const [dropTargetId, setDropTargetId] = useState<number | null>(null);
  const [dropTargetSidebarMemberId, setDropTargetSidebarMemberId] = useState<number | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>("cards");

  const fetchAccounts = useCallback(async () => {
    setIsLoading(true);
    try {
      const params: Record<string, string> = {};
      if (search) params["search"] = search;
      if (statusFilter) params["status"] = statusFilter;
      const { data } = await accountsApi.listAccounts(params);
      setAccounts(data.results);
      setTotal(data.count);
    } catch {
      setAccounts([]);
    } finally {
      setIsLoading(false);
    }
  }, [search, statusFilter]);

  useEffect(() => { void fetchAccounts(); }, [fetchAccounts]);

  useEffect(() => {
    function onStorage(e: StorageEvent) {
      if (e.key === "accountsUpdated") void fetchAccounts();
    }
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [fetchAccounts]);

  useEffect(() => {
    teamApi.listMembers().then(({ data }) => setMembers(data.results)).catch(() => {});
    teamApi.getMyProfile().then(({ data }) => setMyProfile(data)).catch(() => {});
  }, []);

  // My TeamMember record — matched by user FK id
  const myMemberId = myProfile
    ? (members.find((m) => m.user === myProfile.id)?.id ?? null)
    : null;

  const visibleAccounts = accounts;

  const myFirstName = myProfile?.display_name?.split(" ")[0] ?? myProfile?.username ?? null;

  function notifyAccountsUpdated() {
    window.dispatchEvent(new StorageEvent("storage", { key: "accountsUpdated", newValue: Date.now().toString() }));
  }

  async function handleSave(form: Partial<Account>) {
    if (modal && modal !== "new" && (modal as Account).id) {
      const { data } = await accountsApi.updateAccount((modal as Account).id, form);
      setDetail((d) => (d?.id === data.id ? data : d));
      addLog({
        category: "account",
        message: `Account "${data.company_name}" updated`,
        links: [{ label: "View account", path: `/accounts/${data.id}?glow=1` }],
        resource: { type: "account", id: data.id },
      });
    } else {
      const { data: newAccount } = await accountsApi.createAccount(form);
      addLog({
        category: "account",
        message: `Account "${newAccount.company_name}" created`,
        links: [{ label: "View account", path: `/accounts/${newAccount.id}?glow=1` }],
        resource: { type: "account", id: newAccount.id },
      });
      notifyAccountsUpdated();
      setModal(null);
      navigate(`/accounts/${newAccount.id}`);
      return;
    }
    setModal(null);
    void fetchAccounts();
    notifyAccountsUpdated();
  }

  async function handleDelete(id: number) {
    await accountsApi.deleteAccount(id);
    setModal(null);
    setDetail(null);
    void fetchAccounts();
    notifyAccountsUpdated();
  }

  async function handleAccountDropOnMember(e: React.DragEvent, member: TeamMember) {
    e.preventDefault();
    setDropTargetSidebarMemberId(null);
    const accountId = Number(e.dataTransfer.getData("accountId"));
    if (!accountId) return;
    const existingIds: number[] = JSON.parse(e.dataTransfer.getData("accountTeamMemberIds") || "[]");
    if (existingIds.includes(member.id)) return;
    const { data } = await accountsApi.updateAccount(accountId, {
      team_member_ids: [...existingIds, member.id],
    } as Partial<Account>);
    setAccounts((prev) => prev.map((a) => (a.id === data.id ? data : a)));
  }

  async function handleMemberDrop(e: React.DragEvent, account: Account) {
    e.preventDefault();
    setDropTargetId(null);
    const memberId = Number(e.dataTransfer.getData("memberId"));
    if (!memberId) return;
    const existing = (account.team_members ?? []).map((m) => m.id);
    if (existing.includes(memberId)) return;
    const { data } = await accountsApi.updateAccount(account.id, {
      team_member_ids: [...existing, memberId],
    } as Partial<Account>);
    setAccounts((prev) => prev.map((a) => (a.id === data.id ? data : a)));
    if (detail?.id === data.id) setDetail(data);
  }

  return (
    <div className="relative h-full overflow-hidden">
      {/* Toggle button — floats at top-left, becomes sidebar header when open */}
      <button
        onClick={() => setMemberPanelOpen((v) => !v)}
        className="absolute top-4 left-4 z-30 flex items-center gap-2 rounded-full px-4 py-2 text-sm font-semibold shadow-sm transition-all"
        style={memberPanelOpen
          ? { background: "var(--twilio-red, #e22)", border: "1px solid var(--twilio-red, #e22)", color: "#fff" }
          : { background: "var(--surface, #fff)", border: "1px solid var(--border, rgba(0,0,0,0.08))", color: "var(--text-primary, #111)" }}
      >
        <svg viewBox="0 0 16 16" fill="currentColor" className="w-3.5 h-3.5 shrink-0">
          <path fillRule="evenodd" d="M3 4a1 1 0 011-1h8a1 1 0 110 2H4a1 1 0 01-1-1zM3 8a1 1 0 011-1h8a1 1 0 110 2H4a1 1 0 01-1-1zM3 12a1 1 0 011-1h4a1 1 0 110 2H4a1 1 0 01-1-1z" clipRule="evenodd"/>
        </svg>
        Team Members
      </button>

      {/* Team Members overlay sidebar */}
      <div
        className={["absolute top-0 left-0 h-full z-20 flex flex-col shadow-2xl transition-transform duration-300 w-96", memberPanelOpen ? "translate-x-0" : "-translate-x-full"].join(" ")}
        style={{ background: "var(--surface, #fff)", borderRight: "1px solid var(--border, rgba(0,0,0,0.08))" }}
      >
        {/* Space for the floating button above */}
        <div className="h-16 shrink-0" />
        <p className="px-4 pb-2 text-[11px] text-[var(--twilio-gray-60)]">Drag to an account to add · or drag an account onto a member</p>
        <div className="flex-1 overflow-y-auto px-3 pb-3 space-y-2">
          {members.map((m) => (
            <DraggableMemberChip
              key={m.id}
              member={m}
              accounts={accounts}
              dropTarget={dropTargetSidebarMemberId === m.id}
              onDragOver={(e) => { e.preventDefault(); setDropTargetSidebarMemberId(m.id); }}
              onDragLeave={() => setDropTargetSidebarMemberId(null)}
              onDrop={(e) => void handleAccountDropOnMember(e, m)}
            />
          ))}
          {members.length === 0 && <p className="text-sm text-[var(--twilio-gray-60)] px-1">No members found.</p>}
        </div>
      </div>

      {/* Main content — shifts right when sidebar is open */}
      <div
        className="h-full overflow-auto px-6 py-8 transition-[padding] duration-300"
        style={{ fontFamily: "var(--font-base)", paddingLeft: memberPanelOpen ? "calc(384px + 24px)" : undefined }}
      >
      <div className="max-w-7xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-3xl font-semibold flex items-center gap-2" style={{ color: "var(--text-primary, #111)" }}><CorporateIcon width={24} height={24} style={{ flexShrink: 0 }} />Accounts</h1>
          <p className="text-sm mt-1" style={{ color: "var(--text-secondary, #888)" }}>{visibleAccounts.length} account{visibleAccounts.length !== 1 ? "s" : ""}</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setModal("new")}
            style={{ background: "var(--twilio-red, #e22)", color: "#fff", border: "none", fontFamily: "var(--font-base)" }}
            className="rounded-md px-4 py-2 text-sm font-medium hover:opacity-90 transition-opacity"
          >
            + New account
          </button>
        </div>
      </div>

      <div className="flex flex-wrap gap-3 mb-6 items-center">
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search accounts…"
          className="rounded-md px-3 py-2 text-sm w-64 focus:outline-none"
          style={{ border: "1px solid var(--border, rgba(0,0,0,0.08))", background: "var(--surface, #fff)", color: "var(--text-primary, #111)" }}
        />
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="rounded-md px-3 py-2 text-sm focus:outline-none"
          style={{ border: "1px solid var(--border, rgba(0,0,0,0.08))", background: "var(--surface, #fff)", color: "var(--text-primary, #111)" }}
        >
          <option value="">All statuses</option>
          <option value="prospect">Prospect</option>
          <option value="active">Active</option>
          <option value="inactive">Inactive</option>
          <option value="churned">Churned</option>
        </select>
        <div className="ml-auto">
          <ViewToggle value={viewMode} onChange={setViewMode} />
        </div>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center h-40 text-sm" style={{ color: "var(--text-secondary, #888)" }}>Loading…</div>
      ) : visibleAccounts.length === 0 ? (
        <div className="flex flex-col items-center justify-center h-40 gap-3">
          <p className="text-sm" style={{ color: "var(--text-secondary, #888)" }}>No accounts yet.</p>
          <button onClick={() => setModal("new")} className="text-sm underline" style={{ color: "var(--twilio-red, #e22)" }}>Add the first one</button>
        </div>
      ) : viewMode === "cards" ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {visibleAccounts.map((acct) => {
            const sel = exportMode && isSelected(`account:${acct.id}`);
            return (
              <AccountCardButton
                key={acct.id}
                acct={acct}
                exportMode={exportMode}
                sel={sel}
                dropTargetId={dropTargetId}
                onDragStart={(e) => {
                  e.dataTransfer.setData("accountId", String(acct.id));
                  e.dataTransfer.setData("accountTeamMemberIds", JSON.stringify((acct.team_members ?? []).map((m) => m.id)));
                  e.dataTransfer.effectAllowed = "copy";
                }}
                onClick={() => {
                  if (exportMode) {
                    toggleItem({
                      id: `account:${acct.id}`,
                      type: "account",
                      label: acct.company_name,
                      summary: `${acct.status} · ${acct.industry ?? ""} · ARR: ${acct.arr ?? "N/A"}`,
                      content: `Account: ${acct.company_name}\nStatus: ${acct.status}\nIndustry: ${acct.industry ?? "N/A"}\nARR: ${acct.arr ?? "N/A"}\nPrimary Contact: ${acct.primary_contact_name ?? "N/A"}\nTeam: ${(acct.team_members ?? []).map((m) => m.full_name).join(", ") || "None"}`,
                      accountId: acct.id,
                      accountName: acct.company_name,
                    });
                  } else {
                    navigate(`/accounts/${acct.id}`);
                  }
                }}
                onDragOver={(e) => { e.preventDefault(); setDropTargetId(acct.id); }}
                onDragLeave={() => setDropTargetId(null)}
                onDrop={(e) => void handleMemberDrop(e, acct)}
              />
            );
          })}
        </div>
      ) : viewMode === "list" ? (
        <div className="space-y-1">
          {visibleAccounts.map((acct) => (
            <button
              key={acct.id}
              draggable
              onDragStart={(e) => {
                e.dataTransfer.setData("accountId", String(acct.id));
                e.dataTransfer.setData("accountTeamMemberIds", JSON.stringify((acct.team_members ?? []).map((m) => m.id)));
                e.dataTransfer.effectAllowed = "copy";
              }}
              onClick={() => navigate(`/accounts/${acct.id}`)}
              onDragOver={(e) => { e.preventDefault(); setDropTargetId(acct.id); }}
              onDragLeave={() => setDropTargetId(null)}
              onDrop={(e) => void handleMemberDrop(e, acct)}
              className="w-full text-left flex items-center gap-4 rounded-lg px-4 py-3 transition-all cursor-grab active:cursor-grabbing"
              style={dropTargetId === acct.id
                ? { background: "rgba(226,34,34,0.05)", border: "2px solid var(--twilio-red, #e22)" }
                : { background: "var(--surface, #fff)", border: "1px solid var(--border, rgba(0,0,0,0.08))", boxShadow: "0 1px 4px rgba(0,0,0,0.06)" }}
            >
              <div className="h-8 w-8 rounded-full flex items-center justify-center shrink-0" style={{ background: "rgba(226,34,34,0.08)", color: "var(--twilio-red, #e22)" }}>
                <CorporateIcon className="w-4 h-4" />
              </div>
              <p className="w-48 shrink-0 text-sm font-semibold text-[var(--twilio-navy)] truncate">{acct.company_name}</p>
              <span className="shrink-0 rounded-md px-2 py-1 text-sm font-medium" style={STATUS_COLORS[acct.status]}>
                {acct.status}
              </span>
              <p className="flex-1 text-sm truncate" style={{ color: "var(--text-secondary, #888)" }}>{acct.industry || "—"}</p>
              <p className="w-20 shrink-0 text-sm tabular-nums text-right" style={{ color: "var(--text-primary, #111)" }}>{formatArr(acct.arr)}</p>
              <p className="w-36 shrink-0 text-sm truncate" style={{ color: "var(--twilio-red, #e22)" }}>{acct.primary_contact_name || "—"}</p>
              <div className="flex items-center gap-0.5 shrink-0">
                {(acct.team_members ?? []).slice(0, 4).map((m) => {
                  const ini = m.full_name.split(" ").map((n) => n[0]).join("").toUpperCase().slice(0, 2);
                  const mc = ROLE_META[getTitleRole(m.title)];
                  return m.avatar_url ? (
                    <img key={m.id} src={m.avatar_url} alt={m.full_name} title={m.full_name} className="h-6 w-6 rounded-full object-cover ring-1 ring-white -ml-1 first:ml-0" />
                  ) : (
                    <div key={m.id} title={m.full_name} className="h-6 w-6 rounded-full flex items-center justify-center text-[10px] font-semibold ring-1 ring-white -ml-1 first:ml-0" style={{ backgroundColor: mc.bg, color: mc.text }}>
                      {ini}
                    </div>
                  );
                })}
                {(acct.team_members ?? []).length > 4 && (
                  <span className="ml-1 text-[11px] text-[var(--twilio-gray-60)]">+{(acct.team_members ?? []).length - 4}</span>
                )}
              </div>
            </button>
          ))}
        </div>
      ) : (
        <div className="rounded-lg overflow-hidden" style={{ background: "var(--surface, #fff)", border: "1px solid var(--border, rgba(0,0,0,0.08))", boxShadow: "0 1px 4px rgba(0,0,0,0.06)" }}>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs font-bold uppercase tracking-wide" style={{ background: "var(--bg, #f5f5f5)", borderBottom: "1px solid var(--border, rgba(0,0,0,0.08))", color: "var(--text-secondary, #888)" }}>
                <th className="px-4 py-3">Company</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Industry</th>
                <th className="px-4 py-3">ARR</th>
                <th className="px-4 py-3">Contact</th>
                <th className="px-4 py-3">Team</th>
                <th className="px-4 py-3">Notes</th>
              </tr>
            </thead>
            <tbody style={{ borderTop: "1px solid var(--border, rgba(0,0,0,0.08))" }}>
              {visibleAccounts.map((acct) => (
                <tr
                  key={acct.id}
                  draggable
                  onDragStart={(e) => {
                    e.dataTransfer.setData("accountId", String(acct.id));
                    e.dataTransfer.setData("accountTeamMemberIds", JSON.stringify((acct.team_members ?? []).map((m) => m.id)));
                    e.dataTransfer.effectAllowed = "copy";
                  }}
                  onClick={() => navigate(`/accounts/${acct.id}`)}
                  onDragOver={(e) => { e.preventDefault(); setDropTargetId(acct.id); }}
                  onDragLeave={() => setDropTargetId(null)}
                  onDrop={(e) => void handleMemberDrop(e, acct)}
                  className="cursor-grab active:cursor-grabbing transition-all"
                  style={dropTargetId === acct.id
                    ? { background: "rgba(226,34,34,0.05)", outline: "2px solid var(--twilio-red, #e22)" }
                    : {}}
                >
                  <td className="px-4 py-3 font-medium text-[var(--twilio-navy)] truncate max-w-[160px]">{acct.company_name}</td>
                  <td className="px-4 py-3">
                    <span className="rounded-md px-2 py-1 text-sm font-medium" style={STATUS_COLORS[acct.status]}>
                      {acct.status}
                    </span>
                  </td>
                  <td className="px-4 py-3" style={{ color: "var(--text-secondary, #888)" }}>{acct.industry || "—"}</td>
                  <td className="px-4 py-3 tabular-nums" style={{ color: "var(--text-primary, #111)" }}>{formatArr(acct.arr)}</td>
                  <td className="px-4 py-3 truncate max-w-[140px]" style={{ color: "var(--twilio-red, #e22)" }}>{acct.primary_contact_name || "—"}</td>
                  <td className="px-4 py-3"><MemberAvatars members={acct.team_members ?? []} /></td>
                  <td className="px-4 py-3 text-[var(--twilio-navy)]">{acct.notes_count}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {modal !== null && (
        <AccountModal
          account={modal === "new" ? null : modal}
          members={members}
          onClose={() => setModal(null)}
          onSave={handleSave}
          onDelete={handleDelete}
        />
      )}

      {detail && !modal && (
        <AccountDetail
          account={detail}
          onEdit={() => { setModal(detail); setDetail(null); }}
          onClose={() => setDetail(null)}
        />
      )}
      </div> {/* end max-w-7xl */}
      </div> {/* end main content */}
    </div>
  );
}
