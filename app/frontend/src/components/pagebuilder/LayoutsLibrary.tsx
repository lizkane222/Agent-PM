import { useCallback, useEffect, useState } from "react";
import { layoutsApi } from "../../lib/api";
import type { PageLayout } from "../../types";

interface Props {
  currentUserId: number | null;
  isStaff: boolean;
  activeLayoutId: number | null;
  onLoad: (layout: PageLayout) => void;
  onDeleted?: (id: number) => void;
  onClose: () => void;
}

type Tab = "all" | "pinned" | "mine";

export default function LayoutsLibrary({
  currentUserId,
  isStaff,
  activeLayoutId,
  onLoad,
  onDeleted,
  onClose,
}: Props) {
  const [tab, setTab] = useState<Tab>("all");
  const [layouts, setLayouts] = useState<PageLayout[]>([]);
  const [loading, setLoading] = useState(true);
  const [forkingId, setForkingId] = useState<number | null>(null);
  const [forkName, setForkName] = useState<Record<number, string>>({});
  const [renamingId, setRenamingId] = useState<number | null>(null);
  const [renameValue, setRenameValue] = useState<string>("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      if (tab === "pinned") {
        const { data } = await layoutsApi.listPinned();
        setLayouts(data);
      } else if (tab === "mine") {
        const { data } = await layoutsApi.list({ creator: "me" });
        setLayouts(data.results);
      } else {
        const { data } = await layoutsApi.list();
        setLayouts(data.results);
      }
    } finally {
      setLoading(false);
    }
  }, [tab]);

  useEffect(() => { load(); }, [load]);

  async function toggleHeart(layout: PageLayout) {
    const { data } = await layoutsApi.heart(layout.id);
    setLayouts((prev) =>
      prev.map((l) =>
        l.id === layout.id
          ? { ...l, hearted: data.hearted, heart_count: data.heart_count }
          : l
      )
    );
  }

  async function togglePin(layout: PageLayout) {
    const { data } = await layoutsApi.pin(layout.id);
    setLayouts((prev) => {
      if (tab === "pinned" && !data.pinned) {
        return prev.filter((l) => l.id !== layout.id);
      }
      return prev.map((l) =>
        l.id === layout.id ? { ...l, pinned: data.pinned } : l
      );
    });
  }

  async function handleFork(layout: PageLayout) {
    const name = forkName[layout.id] || `${layout.name} (fork)`;
    const { data } = await layoutsApi.fork(layout.id, name);
    setForkingId(null);
    setLayouts((prev) => [data, ...prev]);
  }

  function startRename(layout: PageLayout) {
    setRenamingId(layout.id);
    setRenameValue(layout.name);
  }

  async function commitRename(layout: PageLayout) {
    const trimmed = renameValue.trim();
    if (!trimmed || trimmed === layout.name) {
      setRenamingId(null);
      return;
    }
    try {
      const { data } = await layoutsApi.update(layout.id, { name: trimmed });
      setLayouts((prev) => prev.map((l) => (l.id === layout.id ? data : l)));
    } catch {
      // swallow — leave list unchanged on error
    } finally {
      setRenamingId(null);
    }
  }

  async function handleDelete(layout: PageLayout) {
    if (!window.confirm(`Delete "${layout.name}"? This cannot be undone.`)) return;
    try {
      await layoutsApi.delete(layout.id);
      setLayouts((prev) => prev.filter((l) => l.id !== layout.id));
      onDeleted?.(layout.id);
    } catch {
      // no-op — list stays as-is
    }
  }

  return (
    <div className="fixed inset-0 z-40 flex">
      {/* Backdrop */}
      <div className="flex-1 bg-black/30" onClick={onClose} />

      {/* Panel */}
      <div className="w-[420px] bg-white h-full flex flex-col shadow-2xl border-l border-gray-200">
        {/* Header */}
        <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between shrink-0">
          <div>
            <h2 className="text-sm font-bold text-[var(--twilio-navy)]">Layout Library</h2>
            <p className="text-xs text-[var(--twilio-gray-40)] mt-0.5">Browse, fork, rename, and load saved layouts</p>
          </div>
          <button
            onClick={onClose}
            className="text-[var(--twilio-gray-40)] hover:text-[var(--twilio-navy)] text-lg leading-none"
          >
            ✕
          </button>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 px-4 pt-3 pb-2 shrink-0 border-b border-gray-100">
          {(["all", "pinned", "mine"] as Tab[]).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold capitalize transition-colors ${
                tab === t
                  ? "bg-[var(--twilio-blue)] text-white"
                  : "text-[var(--twilio-gray-60)] hover:bg-gray-100"
              }`}
            >
              {t === "mine" ? "My Layouts" : t === "pinned" ? "Pinned" : "All Layouts"}
            </button>
          ))}
        </div>

        {/* List */}
        <div className="flex-1 overflow-y-auto px-4 py-3 flex flex-col gap-2">
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <div className="w-5 h-5 border-2 border-[var(--twilio-blue)] border-t-transparent rounded-full animate-spin" />
            </div>
          ) : layouts.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <p className="text-3xl opacity-10 mb-2">⬡</p>
              <p className="text-sm text-[var(--twilio-gray-60)] font-medium">
                {tab === "pinned" ? "No pinned layouts yet" : tab === "mine" ? "You haven't saved any layouts" : "No layouts available"}
              </p>
              <p className="text-xs text-[var(--twilio-gray-40)] mt-1">
                {tab !== "pinned" && "Build something and save it!"}
              </p>
            </div>
          ) : (
            layouts.map((layout) => {
              const canManage = isStaff || (currentUserId !== null && layout.creator === currentUserId);
              return (
                <LayoutCard
                  key={layout.id}
                  layout={layout}
                  canManage={canManage}
                  isActive={activeLayoutId === layout.id}
                  isForkingOpen={forkingId === layout.id}
                  forkNameValue={forkName[layout.id] ?? ""}
                  isRenaming={renamingId === layout.id}
                  renameValue={renameValue}
                  onRenameChange={setRenameValue}
                  onStartRename={() => startRename(layout)}
                  onCommitRename={() => commitRename(layout)}
                  onCancelRename={() => setRenamingId(null)}
                  onForkNameChange={(v) => setForkName((p) => ({ ...p, [layout.id]: v }))}
                  onToggleFork={() => setForkingId(forkingId === layout.id ? null : layout.id)}
                  onForkConfirm={() => handleFork(layout)}
                  onHeart={() => toggleHeart(layout)}
                  onPin={() => togglePin(layout)}
                  onDelete={() => handleDelete(layout)}
                  onLoad={() => { onLoad(layout); onClose(); }}
                />
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}

function LayoutCard({
  layout,
  canManage,
  isActive,
  isForkingOpen,
  forkNameValue,
  isRenaming,
  renameValue,
  onRenameChange,
  onStartRename,
  onCommitRename,
  onCancelRename,
  onForkNameChange,
  onToggleFork,
  onForkConfirm,
  onHeart,
  onPin,
  onDelete,
  onLoad,
}: {
  layout: PageLayout;
  canManage: boolean;
  isActive: boolean;
  isForkingOpen: boolean;
  forkNameValue: string;
  isRenaming: boolean;
  renameValue: string;
  onRenameChange: (v: string) => void;
  onStartRename: () => void;
  onCommitRename: () => void;
  onCancelRename: () => void;
  onForkNameChange: (v: string) => void;
  onToggleFork: () => void;
  onForkConfirm: () => void;
  onHeart: () => void;
  onPin: () => void;
  onDelete: () => void;
  onLoad: () => void;
}) {
  return (
    <div className={`rounded-xl border ${isActive ? "border-[var(--twilio-blue)] ring-1 ring-[var(--twilio-blue)]/40" : "border-gray-200"} bg-white hover:border-gray-300 transition-colors p-3 flex flex-col gap-2`}>
      {/* Top row */}
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          {isRenaming ? (
            <input
              autoFocus
              type="text"
              value={renameValue}
              onChange={(e) => onRenameChange(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") { e.preventDefault(); onCommitRename(); }
                if (e.key === "Escape") { e.preventDefault(); onCancelRename(); }
              }}
              onBlur={onCommitRename}
              className="w-full rounded-lg border border-gray-200 px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--twilio-blue)]"
            />
          ) : (
            <p className="text-sm font-semibold text-[var(--twilio-navy)] truncate">{layout.name}</p>
          )}
          <p className="text-xs text-[var(--twilio-gray-40)] truncate mt-0.5">
            {layout.creator_name ?? "Unknown"}
            {layout.forked_from_name && (
              <span className="ml-1 text-[var(--twilio-gray-40)]">· forked from <span className="italic">{layout.forked_from_name}</span></span>
            )}
          </p>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          {/* Heart */}
          <ActionButton
            active={layout.hearted}
            onClick={onHeart}
            title={layout.hearted ? "Unheart" : "Heart"}
            activeClass="text-red-500"
          >
            {layout.hearted ? "♥" : "♡"}
            {layout.heart_count > 0 && (
              <span className="text-[10px] ml-0.5">{layout.heart_count}</span>
            )}
          </ActionButton>

          {/* Pin */}
          <ActionButton
            active={layout.pinned}
            onClick={onPin}
            title={layout.pinned ? "Unpin" : "Pin"}
            activeClass="text-amber-500"
          >
            {layout.pinned ? "📌" : "📍"}
          </ActionButton>
        </div>
      </div>

      {/* Stats row */}
      <div className="flex items-center gap-3 text-[11px] text-[var(--twilio-gray-40)]">
        <span>{(layout.nodes as unknown[]).length} root node{(layout.nodes as unknown[]).length !== 1 ? "s" : ""}</span>
        {layout.fork_count > 0 && <span>{layout.fork_count} fork{layout.fork_count !== 1 ? "s" : ""}</span>}
        {layout.is_public && <span className="text-emerald-500 font-medium">Public</span>}
      </div>

      {/* Fork input (conditional) */}
      {isForkingOpen && (
        <div className="flex gap-2 items-center mt-1">
          <input
            autoFocus
            type="text"
            value={forkNameValue || `${layout.name} (fork)`}
            onChange={(e) => onForkNameChange(e.target.value)}
            placeholder={`${layout.name} (fork)`}
            className="flex-1 rounded-lg border border-gray-200 px-2 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-[var(--twilio-blue)]"
          />
          <button
            onClick={onForkConfirm}
            className="px-3 py-1 rounded-lg text-xs font-semibold bg-[var(--twilio-blue)] text-white hover:opacity-90"
          >
            Fork
          </button>
          <button
            onClick={onToggleFork}
            className="px-2 py-1 rounded-lg text-xs text-[var(--twilio-gray-60)] hover:bg-gray-100"
          >
            Cancel
          </button>
        </div>
      )}

      {/* Action buttons */}
      <div className="flex gap-2 pt-1">
        <button
          onClick={onLoad}
          className="flex-1 py-1.5 rounded-lg text-xs font-semibold bg-[var(--twilio-navy)] text-white hover:opacity-90 transition-opacity"
        >
          Load onto Canvas
        </button>
        <button
          onClick={onToggleFork}
          className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition-colors ${
            isForkingOpen
              ? "border-[var(--twilio-blue)] text-[var(--twilio-blue)]"
              : "border-gray-200 text-[var(--twilio-gray-60)] hover:border-gray-300"
          }`}
        >
          Fork
        </button>
        {canManage && !isRenaming && (
          <button
            onClick={onStartRename}
            title="Rename layout"
            className="px-2 py-1.5 rounded-lg text-xs font-semibold border border-gray-200 text-[var(--twilio-gray-60)] hover:border-gray-300 hover:bg-gray-50 transition-colors"
          >
            ✎
          </button>
        )}
        {canManage && (
          <button
            onClick={onDelete}
            title="Delete layout"
            className="px-2 py-1.5 rounded-lg text-xs font-semibold border border-gray-200 text-red-500 hover:border-red-300 hover:bg-red-50 transition-colors"
          >
            🗑
          </button>
        )}
      </div>
    </div>
  );
}

function ActionButton({
  active,
  onClick,
  title,
  activeClass,
  children,
}: {
  active: boolean;
  onClick: () => void;
  title: string;
  activeClass: string;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      className={`flex items-center px-1.5 py-0.5 rounded-md text-sm transition-colors hover:bg-gray-100 ${
        active ? activeClass : "text-[var(--twilio-gray-40)]"
      }`}
    >
      {children}
    </button>
  );
}
