import { useRef, useState, useId, useEffect } from "react";
import { useLogGlow } from "../lib/useLogGlow";
import { teamApi, discoverApi } from "../lib/api";
import InnovationIcon from "../assets/icons/Innovation.svg?react";
import { useCurrentUser } from "../context/CurrentUserContext";
import type { TeamMember, DiscoverApplet } from "../types";

// ── Types ─────────────────────────────────────────────────────────────────────

type AppletCategory =
  | "Automation"
  | "Dashboard"
  | "Bot"
  | "Integration"
  | "Tool"
  | "Game"
  | "Utility";

type ItemType = "applet" | "repo";

type NewAppletData = Omit<DiscoverApplet, "id" | "airtable_id" | "submitted_by_username" | "created_at" | "updated_at">;


const ALL_CATEGORIES: AppletCategory[] = [
  "Automation",
  "Dashboard",
  "Bot",
  "Integration",
  "Tool",
  "Game",
  "Utility",
];

const CATEGORY_COLORS: Record<AppletCategory, { bg: string; text: string }> = {
  Automation: { bg: "#ede9fe", text: "#5b21b6" },
  Dashboard:  { bg: "#dbeafe", text: "#1d4ed8" },
  Bot:        { bg: "#dcfce7", text: "#15803d" },
  Integration:{ bg: "#fef9c3", text: "#854d0e" },
  Tool:       { bg: "#f1f5f9", text: "#334155" },
  Game:       { bg: "#fce7f3", text: "#9d174d" },
  Utility:    { bg: "#e0f2fe", text: "#0369a1" },
};

// ── Sub-components ────────────────────────────────────────────────────────────

function AppletCard({ item, canEdit, canDelete, onEdit, onDelete }: {
  item: DiscoverApplet;
  canEdit?: boolean;
  canDelete?: boolean;
  onEdit?: () => void;
  onDelete?: () => void;
}) {
  const cat = CATEGORY_COLORS[item.category as AppletCategory] ?? { bg: "#f3f4f6", text: "#6b7280" };
  const isRepo = item.type === "repo";

  return (
    <div
      className="bg-white rounded-xl flex flex-col gap-3 hover:shadow-blue-md transition-shadow"
      style={{ border: "1px solid var(--border, rgba(0,0,0,0.08))", padding: "18px 20px 16px", boxShadow: "0 1px 4px rgba(0,0,0,0.05)" }}
    >
      {/* Header */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2.5 min-w-0">
          {/* Icon */}
          <div
            className="shrink-0 flex items-center justify-center rounded-lg"
            style={{ width: 36, height: 36, background: isRepo ? "#f0fdf4" : "#eff6ff" }}
          >
            {isRepo ? (
              <svg viewBox="0 0 16 16" fill="currentColor" style={{ width: 18, height: 18, color: "#16a34a" }}>
                <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"/>
              </svg>
            ) : (
              <svg viewBox="0 0 16 16" fill="currentColor" style={{ width: 18, height: 18, color: "#2563eb" }}>
                <path d="M2 2.5A2.5 2.5 0 014.5 0h7A2.5 2.5 0 0114 2.5v13l-5-3-5 3V2.5z"/>
              </svg>
            )}
          </div>
          <h3 className="text-sm font-semibold text-[var(--twilio-navy)] truncate">{item.name}</h3>
        </div>
        <span
          className="shrink-0 text-[10px] font-semibold px-2 py-0.5 rounded-full"
          style={{ background: cat.bg, color: cat.text }}
        >
          {item.category}
        </span>
      </div>

      {/* Description */}
      <p className="text-xs leading-relaxed" style={{ color: "var(--text-secondary, #6b7280)" }}>
        {item.description}
      </p>

      {/* Tags */}
      {item.tags.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {item.tags.map((t) => (
            <span key={t} className="text-[10px] px-1.5 py-0.5 rounded-md font-medium" style={{ background: "#f3f4f6", color: "#6b7280" }}>
              {t}
            </span>
          ))}
        </div>
      )}

      {/* Footer */}
      <div className="flex items-center justify-between pt-1 mt-auto" style={{ borderTop: "1px solid rgba(0,0,0,0.06)" }}>
        <div className="flex items-center gap-2">
          <span className="text-[11px]" style={{ color: "var(--text-secondary, #9ca3af)" }}>by {item.author}</span>
          {canEdit && onEdit && (
            <button
              onClick={onEdit}
              className="flex items-center justify-center rounded hover:bg-gray-100 transition-colors"
              style={{ width: 18, height: 18, color: "var(--twilio-gray-60, #6b7280)" }}
              title="Edit applet"
            >
              <svg viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.8" style={{ width: 10, height: 10 }}>
                <path d="M8.5 1.5l2 2L4 10H2v-2L8.5 1.5z"/>
              </svg>
            </button>
          )}
          {canDelete && onDelete && (
            <button
              onClick={onDelete}
              className="flex items-center justify-center rounded hover:bg-red-50 transition-colors"
              style={{ width: 18, height: 18, color: "#e22" }}
              title="Delete applet"
            >
              <svg viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.8" style={{ width: 10, height: 10 }}>
                <path d="M1 3h10M4 3V2h4v1M5 5.5v3M7 5.5v3M2 3l.7 7h6.6L10 3"/>
              </svg>
            </button>
          )}
        </div>
        <a
          href={item.url}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-1 text-[11px] font-semibold transition-opacity hover:opacity-70"
          style={{ color: "var(--twilio-red, #e22)", textDecoration: "none" }}
          onClick={(e) => e.stopPropagation()}
        >
          {isRepo ? "View repo" : "Open applet"}
          <svg viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.8" style={{ width: 10, height: 10 }}>
            <path d="M2 10L10 2M10 2H5M10 2v5"/>
          </svg>
        </a>
      </div>
    </div>
  );
}

// ── URL test ──────────────────────────────────────────────────────────────────

type UrlStatus = "idle" | "testing" | "ok" | "unreachable";

async function testUrl(url: string): Promise<UrlStatus> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5000);
    await fetch(url, { method: "HEAD", mode: "no-cors", signal: controller.signal });
    clearTimeout(timer);
    return "ok";
  } catch {
    return "unreachable";
  }
}

// ── Creator combobox ──────────────────────────────────────────────────────────

function CreatorCombobox({
  value,
  onChange,
  members,
  error,
  uid,
}: {
  value: string;
  onChange: (name: string) => void;
  members: TeamMember[];
  error?: string;
  uid: string;
}) {
  const [query, setQuery] = useState(value);
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const field = "w-full rounded-md border border-gray-200 bg-white px-3 py-2 text-sm text-[var(--twilio-navy)] placeholder:text-[var(--twilio-gray-40)] focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 transition-colors";

  const matches = query.trim()
    ? members.filter((m) => m.full_name.toLowerCase().includes(query.toLowerCase()))
    : members;

  useEffect(() => {
    setQuery(value);
  }, [value]);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  return (
    <div ref={containerRef} className="relative">
      <label htmlFor={`${uid}-author`} className="block text-xs font-semibold text-[var(--twilio-gray-80)] mb-1">Creator *</label>
      <input
        id={`${uid}-author`}
        className={field}
        value={query}
        autoComplete="off"
        placeholder="Type a name to search teammates…"
        onChange={(e) => {
          setQuery(e.target.value);
          onChange(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
      />
      {error && <p className="text-xs text-red-600 mt-1">{error}</p>}
      {open && matches.length > 0 && (
        <ul
          className="absolute z-50 w-full mt-1 rounded-md border border-gray-200 bg-white shadow-lg max-h-48 overflow-y-auto"
          onMouseDown={(e) => e.preventDefault()}
        >
          {matches.map((m) => (
            <li key={m.id}>
              <button
                type="button"
                className="w-full text-left px-3 py-2 text-sm hover:bg-gray-50 flex items-center gap-2"
                style={{ color: "var(--twilio-navy)" }}
                onClick={() => {
                  onChange(m.full_name);
                  setQuery(m.full_name);
                  setOpen(false);
                }}
              >
                {m.avatar_url ? (
                  <img src={m.avatar_url} alt="" className="w-5 h-5 rounded-full shrink-0" />
                ) : (
                  <span className="w-5 h-5 rounded-full shrink-0 flex items-center justify-center text-[10px] font-bold text-white" style={{ background: "var(--twilio-red, #e22)" }}>
                    {m.full_name.charAt(0)}
                  </span>
                )}
                <span>{m.full_name}</span>
                {m.title && <span className="text-xs" style={{ color: "var(--text-secondary, #9ca3af)" }}>{m.title}</span>}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ── Applet Form (create + edit) ───────────────────────────────────────────────

function AppletForm({
  onSave,
  onCancel,
  members,
  defaultAuthor,
  initialValues,
  editingId,
}: {
  onSave: (data: NewAppletData, id?: number) => void;
  onCancel: () => void;
  members: TeamMember[];
  defaultAuthor: string;
  initialValues?: DiscoverApplet;
  editingId?: number;
}) {
  const isEdit = editingId !== undefined;
  const uid = useId();
  const [name, setName] = useState(initialValues?.name ?? "");
  const [description, setDescription] = useState(initialValues?.description ?? "");
  const [url, setUrl] = useState(initialValues?.url ?? "");
  const [type, setType] = useState<ItemType>((initialValues?.type as ItemType) ?? "applet");
  const [category, setCategory] = useState<AppletCategory>((initialValues?.category as AppletCategory) ?? "Tool");
  const [author, setAuthor] = useState(initialValues?.author ?? defaultAuthor);
  const [tagsRaw, setTagsRaw] = useState(initialValues?.tags.join(", ") ?? "");
  const [urlStatus, setUrlStatus] = useState<UrlStatus>("idle");
  const [errors, setErrors] = useState<Record<string, string>>({});

  const handleTestUrl = async () => {
    if (!url.trim()) return;
    setUrlStatus("testing");
    const result = await testUrl(url.trim());
    setUrlStatus(result);
  };

  const validate = () => {
    const e: Record<string, string> = {};
    if (!name.trim()) e.name = "Name is required.";
    if (!description.trim()) e.description = "Description is required.";
    if (!url.trim()) e.url = "URL is required.";
    else {
      try { new URL(url.trim()); } catch { e.url = "Must be a valid URL."; }
    }
    if (!author.trim()) e.author = "Creator is required.";
    return e;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const errs = validate();
    if (Object.keys(errs).length) { setErrors(errs); return; }

    if (urlStatus === "idle") {
      setUrlStatus("testing");
      const result = await testUrl(url.trim());
      setUrlStatus(result);
      if (result === "unreachable") return;
    }
    if (urlStatus === "unreachable") return;

    const tags = tagsRaw.split(",").map((t) => t.trim()).filter(Boolean);
    onSave({ type, name: name.trim(), description: description.trim(), url: url.trim(), category, author: author.trim(), tags }, editingId);
  };

  const field = "w-full rounded-md border border-gray-200 bg-white px-3 py-2 text-sm text-[var(--twilio-navy)] placeholder:text-[var(--twilio-gray-40)] focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 transition-colors";
  const labelCls = "block text-xs font-semibold text-[var(--twilio-gray-80)] mb-1";

  return (
    <div className="flex-1 overflow-y-auto px-6 py-8">
      <div className="max-w-xl mx-auto">
        <button onClick={onCancel} className="flex items-center gap-1.5 text-xs text-[var(--twilio-gray-60)] hover:text-[var(--twilio-navy)] mb-6 transition-colors">
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" style={{ width: 12, height: 12 }}>
            <path d="M10 2L4 8l6 6"/>
          </svg>
          Back to Discover
        </button>

        <h1 className="text-2xl font-semibold text-[var(--twilio-navy)] mb-1">{isEdit ? "Edit Applet" : "Add an Applet"}</h1>
        <p className="text-sm text-[var(--twilio-gray-60)] mb-8">{isEdit ? "Update the details below." : "Share a tool, bot, or repo you've built with your team."}</p>

        <form onSubmit={handleSubmit} className="space-y-5">

          {/* Name */}
          <div>
            <label htmlFor={`${uid}-name`} className={labelCls}>Name *</label>
            <input id={`${uid}-name`} className={field} value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Webhook Debugger" />
            {errors.name && <p className="text-xs text-red-600 mt-1">{errors.name}</p>}
          </div>

          {/* Type + Category row */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label htmlFor={`${uid}-type`} className={labelCls}>Type *</label>
              <select id={`${uid}-type`} className={field} value={type} onChange={(e) => setType(e.target.value as ItemType)}>
                <option value="applet">Applet</option>
                <option value="repo">GitHub Repo</option>
              </select>
            </div>
            <div>
              <label htmlFor={`${uid}-category`} className={labelCls}>Category *</label>
              <select id={`${uid}-category`} className={field} value={category} onChange={(e) => setCategory(e.target.value as AppletCategory)}>
                {ALL_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
          </div>

          {/* Description */}
          <div>
            <label htmlFor={`${uid}-desc`} className={labelCls}>Description *</label>
            <textarea id={`${uid}-desc`} className={`${field} resize-none`} rows={3} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="What does it do? One or two sentences." />
            {errors.description && <p className="text-xs text-red-600 mt-1">{errors.description}</p>}
          </div>

          {/* URL */}
          <div>
            <label htmlFor={`${uid}-url`} className={labelCls}>URL *</label>
            <div className="flex gap-2">
              <input
                id={`${uid}-url`}
                className={`${field} flex-1`}
                value={url}
                onChange={(e) => { setUrl(e.target.value); setUrlStatus("idle"); }}
                placeholder={type === "repo" ? "https://github.com/..." : "https://..."}
                type="url"
              />
              <button
                type="button"
                onClick={handleTestUrl}
                disabled={!url.trim() || urlStatus === "testing"}
                className="shrink-0 px-3 py-2 text-xs font-medium border border-gray-200 bg-white text-[var(--twilio-gray-80)] hover:bg-gray-50 disabled:opacity-50 transition-colors"
              >
                {urlStatus === "testing" ? "Testing…" : "Test URL"}
              </button>
            </div>
            {errors.url && <p className="text-xs text-red-600 mt-1">{errors.url}</p>}
            {urlStatus === "ok" && (
              <p className="text-xs text-green-700 mt-1 flex items-center gap-1">
                <svg viewBox="0 0 12 12" fill="currentColor" style={{ width: 10, height: 10 }}><path d="M10.28 1.28L4.5 7.06 1.72 4.28.28 5.72l4.22 4.22 7.22-7.22-1.44-1.44z"/></svg>
                URL is reachable.
              </p>
            )}
            {urlStatus === "unreachable" && (
              <p className="text-xs text-red-600 mt-1 flex items-center gap-1">
                <svg viewBox="0 0 12 12" fill="currentColor" style={{ width: 10, height: 10 }}><path d="M6 0a6 6 0 100 12A6 6 0 006 0zm.75 9H5.25V7.5h1.5V9zm0-3H5.25V3h1.5v3z"/></svg>
                Could not reach this URL. Fix the link or remove it to continue.
              </p>
            )}
          </div>

          {/* Creator */}
          <CreatorCombobox
            value={author}
            onChange={setAuthor}
            members={members}
            error={errors.author}
            uid={uid}
          />

          {/* Tags */}
          <div>
            <label htmlFor={`${uid}-tags`} className={labelCls}>Tags <span className="font-normal text-[var(--twilio-gray-40)]">(optional, comma-separated)</span></label>
            <input id={`${uid}-tags`} className={field} value={tagsRaw} onChange={(e) => setTagsRaw(e.target.value)} placeholder="e.g. sms, automation, python" />
          </div>

          {/* Actions */}
          <div className="flex items-center justify-end gap-3 pt-2">
            <button type="button" onClick={onCancel} className="px-4 py-2 text-sm font-medium border border-gray-200 bg-white text-[var(--twilio-gray-80)] hover:bg-gray-50 transition-colors">
              Cancel
            </button>
            <button type="submit" className="px-5 py-2 text-sm font-medium bg-indigo-600 text-white hover:bg-indigo-700 transition-colors">
              {isEdit ? "Save Changes" : "Add Applet"}
            </button>
          </div>

        </form>
      </div>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function DiscoverPage() {
  const pageRef = useRef<HTMLDivElement>(null);
  useLogGlow(pageRef);
  const currentUser = useCurrentUser();

  const [items, setItems] = useState<DiscoverApplet[]>([]);
  const [loading, setLoading] = useState(true);
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [editingItem, setEditingItem] = useState<DiscoverApplet | null>(null);
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState<"all" | "applet" | "repo">("all");
  const [categoryFilter, setCategoryFilter] = useState<string>("");
  const [authorFilter, setAuthorFilter] = useState("");

  const loadApplets = () => {
    setLoading(true);
    discoverApi.listApplets({ page_size: "200" })
      .then(({ data }) => setItems(data.results))
      .catch(() => {})
      .finally(() => setLoading(false));
  };

  useEffect(() => { loadApplets(); }, []);

  useEffect(() => {
    teamApi.listMembers({ page_size: "200" })
      .then(({ data }) => setMembers(data.results))
      .catch(() => {});
  }, []);

  const defaultAuthor = currentUser?.display_name ?? "";

  const allAuthors = [...new Set(items.map((i) => i.author))].sort();

  const filtered = items.filter((item) => {
    if (typeFilter !== "all" && item.type !== typeFilter) return false;
    if (categoryFilter && item.category !== categoryFilter) return false;
    if (authorFilter && item.author !== authorFilter) return false;
    if (search) {
      const q = search.toLowerCase();
      return (
        item.name.toLowerCase().includes(q) ||
        item.description.toLowerCase().includes(q) ||
        item.tags.some((t) => t.toLowerCase().includes(q)) ||
        item.author.toLowerCase().includes(q)
      );
    }
    return true;
  });

  const applets = filtered.filter((i) => i.type === "applet");
  const repos   = filtered.filter((i) => i.type === "repo");

  const handleFormSave = (data: NewAppletData, id?: number) => {
    const req = id
      ? discoverApi.updateApplet(id, data)
      : discoverApi.createApplet(data);
    req.then(() => {
      loadApplets();
      setShowForm(false);
      setEditingItem(null);
    }).catch(() => {});
  };

  const handleFormCancel = () => { setShowForm(false); setEditingItem(null); };

  if (showForm || editingItem) {
    return (
      <div ref={pageRef} className="flex h-full overflow-hidden">
        <aside
          className="w-56 shrink-0 flex flex-col gap-4 px-3 py-5 overflow-y-auto"
          style={{ background: "var(--surface, #fff)", borderRight: "1px solid var(--border, rgba(0,0,0,0.08))" }}
        >
          <p className="text-xs text-[var(--twilio-gray-60)] px-2">
            {editingItem ? "Update the fields and save." : "Fill in the form to add your applet to the directory."}
          </p>
        </aside>
        <AppletForm
          onSave={handleFormSave}
          onCancel={handleFormCancel}
          members={members}
          defaultAuthor={defaultAuthor}
          initialValues={editingItem ?? undefined}
          editingId={editingItem?.id}
        />
      </div>
    );
  }

  return (
    <div ref={pageRef} className="flex h-full overflow-hidden">

      {/* ── Left sidebar ── */}
      <aside
        className="w-56 shrink-0 flex flex-col"
        style={{ background: "var(--surface, #fff)", borderRight: "1px solid var(--border, rgba(0,0,0,0.08))" }}
      >
        <div className="flex-1 flex flex-col gap-4 px-3 py-5 overflow-y-auto">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-widest mb-2" style={{ color: "var(--text-secondary, #9ca3af)" }}>Search</p>
          <div className="relative">
            <svg viewBox="0 0 16 16" fill="currentColor" className="absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" style={{ width: 12, height: 12, color: "#9ca3af" }}>
              <path d="M11.742 10.344a6.5 6.5 0 10-1.397 1.398h-.001c.03.04.062.078.098.115l3.85 3.85a1 1 0 001.415-1.414l-3.85-3.85a1.007 1.007 0 00-.115-.099zm-5.242 1.156a5.5 5.5 0 110-11 5.5 5.5 0 010 11z"/>
            </svg>
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search applets…"
              className="w-full rounded-lg border border-gray-200 pl-7 pr-3 py-1.5 text-xs focus:outline-none focus:border-red-300 focus:ring-1 focus:ring-red-100"
            />
          </div>
        </div>

        {/* Type */}
        <div>
          <p className="text-[10px] font-bold uppercase tracking-widest mb-2" style={{ color: "var(--text-secondary, #9ca3af)" }}>Type</p>
          <div className="space-y-0.5">
            {([["all", "All"], ["applet", "Applets"], ["repo", "GitHub Repos"]] as const).map(([v, label]) => (
              <button
                key={v}
                onClick={() => setTypeFilter(v)}
                className="card-btn w-full text-left px-2.5 py-1.5 rounded-lg text-xs font-medium transition-colors"
                style={typeFilter === v
                  ? { background: "var(--twilio-red, #e22)", color: "#fff" }
                  : { background: "transparent", color: "var(--text-primary, #111)" }}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        {/* Category */}
        <div>
          <p className="text-[10px] font-bold uppercase tracking-widest mb-2" style={{ color: "var(--text-secondary, #9ca3af)" }}>Category</p>
          <div className="space-y-0.5">
            <button
              onClick={() => setCategoryFilter("")}
              className="card-btn w-full text-left px-2.5 py-1.5 rounded-lg text-xs font-medium transition-colors"
              style={categoryFilter === ""
                ? { background: "rgba(226,34,34,0.08)", color: "var(--twilio-red, #e22)" }
                : { background: "transparent", color: "var(--text-primary, #111)" }}
            >
              All categories
            </button>
            {ALL_CATEGORIES.map((cat) => {
              const c = CATEGORY_COLORS[cat];
              const active = categoryFilter === cat;
              return (
                <button
                  key={cat}
                  onClick={() => setCategoryFilter(active ? "" : cat)}
                  className="card-btn w-full text-left px-2.5 py-1.5 rounded-lg text-xs font-medium transition-colors flex items-center gap-2"
                  style={active
                    ? { background: c.bg, color: c.text }
                    : { background: "transparent", color: "var(--text-primary, #111)" }}
                >
                  <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: c.text }} />
                  {cat}
                </button>
              );
            })}
          </div>
        </div>

        {/* Author */}
        <div>
          <p className="text-[10px] font-bold uppercase tracking-widest mb-2" style={{ color: "var(--text-secondary, #9ca3af)" }}>Creator</p>
          <div className="space-y-0.5">
            <button
              onClick={() => setAuthorFilter("")}
              className="card-btn w-full text-left px-2.5 py-1.5 rounded-lg text-xs font-medium transition-colors"
              style={authorFilter === ""
                ? { background: "rgba(226,34,34,0.08)", color: "var(--twilio-red, #e22)" }
                : { background: "transparent", color: "var(--text-primary, #111)" }}
            >
              All creators
            </button>
            {allAuthors.map((a) => (
              <button
                key={a}
                onClick={() => setAuthorFilter(authorFilter === a ? "" : a)}
                className="card-btn w-full text-left px-2.5 py-1.5 rounded-lg text-xs font-medium truncate transition-colors"
                style={authorFilter === a
                  ? { background: "rgba(226,34,34,0.08)", color: "var(--twilio-red, #e22)" }
                  : { background: "transparent", color: "var(--text-primary, #111)" }}
              >
                {a}
              </button>
            ))}
          </div>
        </div>
        </div>{/* end scrollable filters */}

        {/* ── New Applet button ── */}
        <div className="px-3 py-3" style={{ borderTop: "1px solid var(--border, rgba(0,0,0,0.08))" }}>
          <button
            onClick={() => setShowForm(true)}
            className="card-btn w-full flex items-center justify-center gap-2 px-3 py-2 rounded-lg text-xs font-semibold transition-colors"
            style={{ background: "var(--twilio-red, #DB131A)", color: "#fff" }}
          >
            <svg viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2.2" style={{ width: 11, height: 11 }}>
              <path d="M6 1v10M1 6h10"/>
            </svg>
            New Applet
          </button>
        </div>
      </aside>

      {/* ── Main content ── */}
      <div className="flex-1 overflow-y-auto px-6 py-6">
        <div className="max-w-6xl mx-auto">

          {/* Page header */}
          <div className="mb-6">
            <h1 className="text-3xl font-semibold text-[var(--twilio-navy)] flex items-center gap-2"><InnovationIcon width={24} height={24} style={{ flexShrink: 0 }} />Discover</h1>
            <p className="text-sm text-[var(--twilio-navy)] mt-1">
              Applets and repos built by Twilions — {filtered.length} result{filtered.length !== 1 ? "s" : ""}
            </p>
          </div>

          {loading ? (
            <div className="flex items-center justify-center py-24">
              <p className="text-sm" style={{ color: "var(--text-secondary, #9ca3af)" }}>Loading…</p>
            </div>
          ) : filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-24 gap-3">
              {items.length === 0 ? (
                <>
                  <p className="text-sm" style={{ color: "var(--text-secondary, #9ca3af)" }}>No applets yet — be the first to add one.</p>
                  <button
                    onClick={() => setShowForm(true)}
                    className="text-xs font-semibold underline"
                    style={{ color: "var(--twilio-red, #e22)" }}
                  >
                    Add an applet
                  </button>
                </>
              ) : (
                <>
                  <p className="text-sm" style={{ color: "var(--text-secondary, #9ca3af)" }}>No applets match your filters.</p>
                  <button
                    onClick={() => { setSearch(""); setTypeFilter("all"); setCategoryFilter(""); setAuthorFilter(""); }}
                    className="text-xs underline"
                    style={{ color: "var(--twilio-red, #e22)" }}
                  >
                    Clear all filters
                  </button>
                </>
              )}
            </div>
          ) : (
            <div className="space-y-8">

              {/* Applets section */}
              {(typeFilter === "all" || typeFilter === "applet") && applets.length > 0 && (
                <section>
                  <div className="flex items-center gap-2 mb-4">
                    <svg viewBox="0 0 16 16" fill="currentColor" style={{ width: 14, height: 14, color: "#2563eb" }}>
                      <path d="M2 2.5A2.5 2.5 0 014.5 0h7A2.5 2.5 0 0114 2.5v13l-5-3-5 3V2.5z"/>
                    </svg>
                    <h2 className="text-sm font-bold uppercase tracking-widest text-[var(--twilio-navy)]">Applets</h2>
                    <span className="text-xs font-semibold px-2 py-0.5 rounded-full" style={{ background: "#eff6ff", color: "#2563eb" }}>{applets.length}</span>
                  </div>
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                    {applets.map((item) => (
                      <AppletCard
                        key={item.id}
                        item={item}
                        canEdit={item.submitted_by_username === currentUser?.username}
                        canDelete={item.submitted_by_username === currentUser?.username}
                        onEdit={() => setEditingItem(item)}
                        onDelete={() => discoverApi.deleteApplet(item.id).then(loadApplets).catch(() => {})}
                      />
                    ))}
                  </div>
                </section>
              )}

              {/* Repos section */}
              {(typeFilter === "all" || typeFilter === "repo") && repos.length > 0 && (
                <section>
                  <div className="flex items-center gap-2 mb-4">
                    <svg viewBox="0 0 16 16" fill="currentColor" style={{ width: 14, height: 14, color: "#16a34a" }}>
                      <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"/>
                    </svg>
                    <h2 className="text-sm font-bold uppercase tracking-widest text-[var(--twilio-navy)]">GitHub Repos</h2>
                    <span className="text-xs font-semibold px-2 py-0.5 rounded-full" style={{ background: "#f0fdf4", color: "#16a34a" }}>{repos.length}</span>
                  </div>
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                    {repos.map((item) => (
                      <AppletCard
                        key={item.id}
                        item={item}
                        canEdit={item.submitted_by_username === currentUser?.username}
                        canDelete={item.submitted_by_username === currentUser?.username}
                        onEdit={() => setEditingItem(item)}
                        onDelete={() => discoverApi.deleteApplet(item.id).then(loadApplets).catch(() => {})}
                      />
                    ))}
                  </div>
                </section>
              )}

            </div>
          )}
        </div>
      </div>
    </div>
  );
}
