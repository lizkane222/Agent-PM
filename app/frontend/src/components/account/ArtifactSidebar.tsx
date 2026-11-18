import { useState } from "react";
import { useArtifactNotes } from "../../hooks/useArtifactNotes";
import { useCommentSummary } from "../../hooks/useCommentSummary";
import type { AccountArtifact, CommentReference } from "../../types";
import InlineCommentThread from "../comments/InlineCommentThread";
import { ArtifactDetailsRail } from "./ArtifactDetailsRail";
import ArtifactNotesPanel from "./ArtifactNotesPanel";
import { NoteBulletActions } from "./NoteBulletActions";

type Tab = "notes" | "comments";

/**
 * The preview overlay's right-hand side: who added the artifact, its description, every record
 * it is linked to (the details rail), then the artifact's Notes and Comments, each with history,
 * threaded replies and the create-action-item / set-reminder / create-meeting / copy buttons.
 *
 * Notes are a feature of artifacts (accounts.ArtifactNote). Comments are the app's shared
 * comment system (resource type "artifact"), the same thread the artifact card's badge counts.
 */
export default function ArtifactSidebar({ artifact, canEdit, onUpdated, accountName, airtableAccountId, linked, onLinked }: {
  artifact: AccountArtifact;
  canEdit: boolean;
  onUpdated: (a: AccountArtifact) => void;
  accountName?: string | null;
  airtableAccountId?: number | null;
  /** Records linked from the buttons since the artifact was loaded (shown under "Used in"). */
  linked: CommentReference[];
  onLinked: (ref: CommentReference) => void;
}) {
  const [tab, setTab] = useState<Tab>("notes");
  const notes = useArtifactNotes(artifact.id);
  const commentCount = useCommentSummary("artifact", artifact.id)?.count;

  const shown: AccountArtifact = linked.length
    ? { ...artifact, used_in: [...(artifact.used_in ?? []), ...linked.filter((l) => !(artifact.used_in ?? []).some((u) => u.resource_type === l.resource_type && u.resource_id === l.resource_id))] }
    : artifact;

  const tabBtn = (id: Tab, label: string, count?: number) => (
    <button
      type="button" role="tab" id={`artifact-tab-${id}`} aria-selected={tab === id} aria-controls={`artifact-panel-${id}`}
      onClick={() => setTab(id)}
      className={`flex-1 py-1.5 text-xs font-semibold border-b-2 ${tab === id ? "border-indigo-600 text-indigo-700" : "border-transparent text-gray-500 hover:text-gray-700"}`}
    >
      {label}{count ? ` (${count})` : ""}
    </button>
  );

  return (
    <aside
      data-testid="artifact-sidebar"
      style={{ width: "360px", flexShrink: 0, background: "var(--surface-card)", overflowY: "auto", padding: "16px", borderLeft: "1px solid rgba(0,0,0,0.08)" }}
    >
      <ArtifactDetailsRail artifact={shown} canEdit={canEdit} onUpdated={onUpdated} embedded />

      <div role="tablist" aria-label="Notes and comments" className="flex mt-4 border-b border-gray-200">
        {tabBtn("notes", "Notes", notes.data.length)}
        {tabBtn("comments", "Comments", commentCount)}
      </div>
      <div className="pt-3" role="tabpanel" id={`artifact-panel-${tab}`} aria-labelledby={`artifact-tab-${tab}`}>
        {tab === "notes" ? (
          <ArtifactNotesPanel artifact={artifact} notes={notes} accountName={accountName} airtableAccountId={airtableAccountId} onLinked={onLinked} />
        ) : (
          <InlineCommentThread
            compact heading="Comments" resourceType="artifact" resourceId={artifact.id} resourceLabel={artifact.name}
            listClassName="max-h-[420px] overflow-y-auto"
            renderActions={(c) => (
              <NoteBulletActions
                text={c.content} copyable onLinked={onLinked}
                source={{ resourceType: "artifact", resourceId: artifact.id, label: artifact.name, url: artifact.file_url ?? artifact.url, accountId: artifact.account }}
                accountName={accountName} airtableAccountId={airtableAccountId}
              />
            )}
          />
        )}
      </div>
    </aside>
  );
}
