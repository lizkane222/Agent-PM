import { useState } from "react";
import { Link } from "react-router-dom";
import RichTextMentionEditor from "../shared/RichTextMentionEditor";
import { sanitizeHtml, plainToHtml } from "../../lib/noteHelpers";
import { usePublicItems } from "../../hooks/usePublicItems";
import { useAppError } from "../../context/AppErrorContext";
import ScheduleCallModal from "./ScheduleCallModal";
import LeaveNoteModal from "./LeaveNoteModal";
import HorizontalScroller from "./HorizontalScroller";
import type { PublicItem, PublicItemType } from "../../types/team";

interface Props {
  /** TeamMember id of the person whose public section this is. */
  memberId: number;
  personName: string;
  personEmail: string;
  /** True on your own page: you may add, edit and delete. Everyone else is read-only. */
  isSelf: boolean;
  accent?: { border: string; bg: string; text: string };
}

const TYPE_LABEL: Record<PublicItemType, string> = {
  artifact_link: "Link",
  artifact_file: "File",
  note: "Note",
  record_ref: "Record",
};

const card = { background: "var(--surface, #fff)", border: "1px solid var(--border, rgba(0,0,0,0.08))", borderRadius: 10, padding: "10px 12px" } as const;
const input = { width: "100%", padding: "7px 9px", borderRadius: 7, border: "1px solid var(--border, rgba(0,0,0,0.15))", fontSize: "0.8125rem", fontFamily: "var(--font-base)", boxSizing: "border-box" as const };

export default function PublicSection({ memberId, personName, personEmail, isSelf, accent }: Props) {
  const { reportError } = useAppError();
  const { data, loading, error, addItem, removeItem } = usePublicItems(memberId);
  const [adding, setAdding] = useState<PublicItemType | null>(null);
  const [title, setTitle] = useState("");
  const [url, setUrl] = useState("");
  const [body, setBody] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [refLabel, setRefLabel] = useState("");
  const [refUrl, setRefUrl] = useState("");
  const [showSchedule, setShowSchedule] = useState(false);
  const [showNote, setShowNote] = useState(false);
  const border = accent?.border ?? "#0d1b2e";
  const first = personName.split(" ")[0] || personName;

  function reset() {
    setAdding(null); setTitle(""); setUrl(""); setBody(""); setFile(null); setRefLabel(""); setRefUrl("");
  }

  async function save() {
    if (!adding) return;
    try {
      if (adding === "artifact_file") {
        const fd = new FormData();
        fd.append("item_type", adding);
        fd.append("title", title.trim());
        if (file) fd.append("file", file);
        await addItem(fd);
      } else {
        await addItem({
          item_type: adding,
          title: title.trim(),
          url: adding === "artifact_link" ? url.trim() : "",
          body: adding === "note" ? body : "",
          ref: adding === "record_ref" ? { resource_type: "link", resource_id: refUrl.trim(), label: refLabel.trim() || title.trim(), url: refUrl.trim() } : {},
        });
      }
      reset();
    } catch (err) {
      reportError(err instanceof Error ? err.message : "Could not save that item.");
    }
  }

  const canSave = title.trim() && (adding !== "artifact_link" || url.trim()) && (adding !== "artifact_file" || file) && (adding !== "record_ref" || refUrl.trim());

  const actionBtn = { padding: "7px 14px", borderRadius: 8, border: `1px solid ${border}`, background: "var(--surface, #fff)", color: "var(--text-primary, #111)", fontSize: "0.8125rem", fontWeight: 600, cursor: "pointer", fontFamily: "var(--font-base)", textDecoration: "none", display: "inline-block" } as const;

  function open(item: PublicItem) {
    const href = item.item_type === "artifact_file" ? item.file_url : item.item_type === "record_ref" ? item.ref.url : item.url;
    if (!href) return <span>{item.title}</span>;
    const internal = href.startsWith("/");
    return internal
      ? <Link to={href} style={{ color: border, fontWeight: 600 }}>{item.title}</Link>
      : <a href={href} target="_blank" rel="noopener noreferrer" style={{ color: border, fontWeight: 600 }}>{item.title}</a>;
  }

  return (
    <div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 14 }}>
        {!isSelf && (
          <>
            <button style={actionBtn} onClick={() => setShowSchedule(true)}>Schedule call with {first}</button>
            <a
              style={actionBtn}
              href={`https://mail.google.com/mail/?view=cm&fs=1&to=${encodeURIComponent(personEmail)}`}
              target="_blank"
              rel="noopener noreferrer"
            >
              Email {first}
            </a>
            <button style={actionBtn} onClick={() => setShowNote(true)}>Leave a note for {first}</button>
          </>
        )}
      </div>

      {loading && <p style={{ fontSize: "0.8125rem", color: "var(--text-secondary, #888)" }}>Loading…</p>}
      {error && <p style={{ fontSize: "0.8125rem", color: "var(--ink-red)" }}>Could not load the public section.</p>}
      {!loading && !error && data.length === 0 && (
        <div style={{ ...card, borderStyle: "dashed", fontSize: "0.8125rem", color: "var(--text-secondary, #888)" }}>
          {isSelf ? "Nothing public yet. Add something others can see on your profile." : `${first} hasn't shared anything yet.`}
        </div>
      )}

      {data.length > 0 && (
        <HorizontalScroller label="Public items">
          {data.map((item) => (
            <div key={item.id} style={{ ...card, width: 260, flexShrink: 0, boxSizing: "border-box", display: "flex", flexDirection: "column", gap: 6 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ fontSize: "0.625rem", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", padding: "2px 7px", borderRadius: 10, background: accent?.bg ?? "#eef", color: accent?.text ?? "#333", flexShrink: 0 }}>{TYPE_LABEL[item.item_type]}</span>
                <span style={{ flex: 1 }} />
                {isSelf && (
                  <button
                    aria-label={`Remove ${item.title}`}
                    onClick={() => void removeItem(item.id).catch((e) => reportError(e instanceof Error ? e.message : "Could not remove that item."))}
                    style={{ background: "none", border: "none", cursor: "pointer", color: "#999" }}
                  >✕</button>
                )}
              </div>
              <div style={{ fontSize: "0.875rem", overflowWrap: "anywhere" }}>{open(item)}</div>
              {item.item_type === "note" && item.body && (
                <div className="rich-text" style={{ fontSize: "0.8125rem", maxHeight: 120, overflow: "hidden" }} dangerouslySetInnerHTML={{ __html: sanitizeHtml(plainToHtml(item.body)) }} />
              )}
            </div>
          ))}
        </HorizontalScroller>
      )}

      {isSelf && !adding && (
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 12 }}>
          {(["artifact_link", "artifact_file", "note", "record_ref"] as PublicItemType[]).map((t) => (
            <button key={t} onClick={() => setAdding(t)} style={{ ...actionBtn, padding: "5px 11px", fontSize: "0.75rem" }}>+ {TYPE_LABEL[t]}</button>
          ))}
        </div>
      )}

      {isSelf && adding && (
        <div style={{ ...card, marginTop: 12, display: "grid", gap: 8 }}>
          <strong style={{ fontSize: "0.8125rem" }}>Add {TYPE_LABEL[adding].toLowerCase()}</strong>
          <input aria-label="Title" style={input} placeholder="Title" value={title} onChange={(e) => setTitle(e.target.value)} />
          {adding === "artifact_link" && <input aria-label="URL" style={input} placeholder="https://…" value={url} onChange={(e) => setUrl(e.target.value)} />}
          {adding === "artifact_file" && <input aria-label="File" type="file" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />}
          {adding === "note" && <RichTextMentionEditor value={body} onChange={setBody} placeholder="Write a note…" />}
          {adding === "record_ref" && (
            <>
              <input aria-label="Record label" style={input} placeholder="Label (e.g. Acme account)" value={refLabel} onChange={(e) => setRefLabel(e.target.value)} />
              <input aria-label="Record link" style={input} placeholder="/accounts/12 or https://…" value={refUrl} onChange={(e) => setRefUrl(e.target.value)} />
            </>
          )}
          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
            <button onClick={reset} style={{ ...actionBtn, borderColor: "var(--border, rgba(0,0,0,0.15))" }}>Cancel</button>
            <button onClick={() => void save()} disabled={!canSave} style={{ ...actionBtn, background: border, color: "#fff", opacity: canSave ? 1 : 0.5 }}>Add</button>
          </div>
        </div>
      )}

      {showSchedule && <ScheduleCallModal personName={personName} personEmail={personEmail} onClose={() => setShowSchedule(false)} />}
      {showNote && <LeaveNoteModal memberId={memberId} personName={personName} onClose={() => setShowNote(false)} />}
    </div>
  );
}
