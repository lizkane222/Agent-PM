import { useState } from "react";
import { accountsApi } from "../../lib/api";
import { useAppError } from "../../context/AppErrorContext";
import { sanitizeHtml, plainToHtml } from "../../lib/noteHelpers";
import RichTextMentionEditor from "../shared/RichTextMentionEditor";
import LinkedRecordsList from "../shared/LinkedRecordsList";
import { ARTIFACT_ICON_CATALOG, ArtifactIconImg } from "./ArtifactIcon";
import type { AccountArtifact } from "../../types/accounts";
import type { CommentReference } from "../../types/comments";

const inputCls = "w-full text-xs rounded-lg border border-gray-200 px-2.5 py-1.5 focus:outline-none focus:ring-2 focus:ring-indigo-200";
const labelCls = "block text-[9px] font-semibold text-[var(--twilio-gray-60)] uppercase tracking-wide mb-1";

function fmtDate(iso: string | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

/** Sidebar of the artifact viewer: read-only details, plus an edit form when `canEdit`. */
export function ArtifactDetailsRail({ artifact, canEdit, onUpdated }: {
  artifact: AccountArtifact;
  canEdit: boolean;
  onUpdated: (a: AccountArtifact) => void;
}) {
  const { reportError } = useAppError();
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [name, setName] = useState(artifact.name);
  const [url, setUrl] = useState(artifact.url ?? "");
  const [iconKey, setIconKey] = useState(artifact.icon_key);
  const [description, setDescription] = useState(artifact.description);
  const [references, setReferences] = useState<CommentReference[]>(artifact.references ?? []);
  const isLink = artifact.artifact_type === "link";
  const usedIn = artifact.used_in ?? [];
  const linkIcons = ARTIFACT_ICON_CATALOG.filter((e) => !e.key.startsWith("file_"));

  function startEdit() {
    setName(artifact.name); setUrl(artifact.url ?? ""); setIconKey(artifact.icon_key);
    setDescription(artifact.description); setReferences(artifact.references ?? []);
    setEditing(true);
  }

  async function save() {
    const trimmed = name.trim();
    if (!trimmed) { reportError("An artifact needs a name."); return; }
    if (isLink && !url.trim()) { reportError("A link artifact needs a URL."); return; }
    const patch: Parameters<typeof accountsApi.updateArtifact>[1] = {
      name: trimmed, description, references, ...(isLink ? { url: url.trim(), icon_key: iconKey } : {}),
    };
    setSaving(true);
    try {
      const { data } = await accountsApi.updateArtifact(artifact.id, patch);
      onUpdated(data);
      setEditing(false);
    } catch (e) {
      const detail = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      reportError(detail ? `Could not save the artifact: ${detail}` : "Could not save the artifact. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <aside
      data-testid="artifact-details"
      style={{ width: "300px", flexShrink: 0, background: "var(--surface-card)", overflowY: "auto", padding: "16px", borderLeft: "1px solid rgba(0,0,0,0.08)" }}
    >
      {artifact.uploaded_by_username && (
        <div className="flex items-center gap-2 mb-1">
          <span className="w-6 h-6 rounded-full bg-indigo-600 text-white text-[10px] font-bold flex items-center justify-center shrink-0">
            {artifact.uploaded_by_username[0].toUpperCase()}
          </span>
          <span className="text-xs text-gray-600">
            Added by <span className="font-semibold text-gray-800">{artifact.uploaded_by_username}</span>
          </span>
        </div>
      )}
      {artifact.updated_by_username && (
        <p data-testid="artifact-updated-by" className="text-[11px] text-gray-500 mb-3">
          Updated by <span className="font-semibold text-gray-700">{artifact.updated_by_username}</span>
          {fmtDate(artifact.updated_at) && <> · {fmtDate(artifact.updated_at)}</>}
        </p>
      )}
      {!artifact.updated_by_username && <div className="mb-2" />}

      {canEdit && !editing && (
        <button type="button" onClick={startEdit} data-testid="artifact-edit-btn"
          className="mb-3 px-3 py-1 rounded-full text-xs font-medium bg-indigo-50 text-indigo-700 hover:bg-indigo-100">Edit</button>
      )}

      {editing ? (
        <form className="flex flex-col gap-3 mb-3" onSubmit={(e) => { e.preventDefault(); void save(); }}>
          <div>
            <label className={labelCls} htmlFor="artifact-edit-name">Name</label>
            <input id="artifact-edit-name" className={inputCls} value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          {isLink && (
            <div>
              <label className={labelCls} htmlFor="artifact-edit-url">URL</label>
              <input id="artifact-edit-url" className={inputCls} value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://…" />
            </div>
          )}
          {isLink && (
            <div>
              <p className={labelCls}>Category</p>
              <div className="flex flex-wrap gap-1" role="group" aria-label="Category">
                {linkIcons.map((entry) => (
                  <button key={entry.key} type="button" title={entry.label} aria-pressed={iconKey === entry.key}
                    data-testid={`artifact-edit-icon-${entry.key}`}
                    onClick={() => setIconKey(iconKey === entry.key ? "" : entry.key)}
                    className={`flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] ${iconKey === entry.key ? "bg-indigo-600 text-white" : "bg-gray-100 text-gray-600 hover:bg-gray-200"}`}>
                    <ArtifactIconImg entry={entry} size={12} />{entry.label}
                  </button>
                ))}
              </div>
            </div>
          )}
          <div>
            <p className={labelCls}>Description</p>
            <RichTextMentionEditor
              value={description}
              onChange={setDescription}
              placeholder="What is this, and when should someone reach for it?"
              minHeightClassName="min-h-[70px]"
              onReferenceInsert={(ref) => setReferences((prev) =>
                prev.some((r) => r.resource_type === ref.resource_type && r.resource_id === ref.resource_id) ? prev : [...prev, ref])}
            />
          </div>
          <div className="flex gap-2">
            <button type="submit" disabled={saving} data-testid="artifact-save-btn"
              className="px-3 py-1 rounded-full text-xs font-semibold bg-indigo-600 text-white disabled:opacity-50">{saving ? "Saving…" : "Save"}</button>
            <button type="button" disabled={saving} onClick={() => setEditing(false)}
              className="px-3 py-1 rounded-full text-xs font-medium bg-gray-100 text-gray-600">Cancel</button>
          </div>
        </form>
      ) : (
        artifact.description?.trim() && (
          <div className="mb-3">
            <p className="text-[9px] font-semibold text-[var(--twilio-gray-60)] uppercase tracking-wide">Description</p>
            <div className="mt-1 text-xs text-[var(--twilio-navy)] rich-text"
              dangerouslySetInnerHTML={{ __html: sanitizeHtml(plainToHtml(artifact.description)) }} />
          </div>
        )
      )}
      <LinkedRecordsList title="Mentions in description" references={editing ? references : (artifact.references ?? [])} className="mb-3" />
      <LinkedRecordsList title="Used in" references={usedIn} />
    </aside>
  );
}
