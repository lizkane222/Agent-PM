import { useEffect, useState } from "react";
import { agentSkillsApi } from "../../lib/api";
import { markdownToHtml } from "../../lib/markdownToHtml";

/** Read-only in-app view of an attached document's extracted text. */
export default function AttachmentViewer({
  skillId, attachmentId, onClose,
}: {
  skillId: number;
  attachmentId: number;
  onClose: () => void;
}) {
  const [doc, setDoc] = useState<{ name: string; text: string } | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    agentSkillsApi.getAttachment(skillId, attachmentId)
      .then((r) => { if (!cancelled) setDoc({ name: r.data.name, text: r.data.text }); })
      .catch(() => { if (!cancelled) setError(true); });
    return () => { cancelled = true; };
  }, [skillId, attachmentId]);

  return (
    <div role="dialog" aria-label="Attachment" onClick={onClose} style={{
      position: "fixed", inset: 0, zIndex: 400, background: "rgba(0,0,0,0.4)", display: "flex", alignItems: "center", justifyContent: "center",
    }}>
      <div onClick={(e) => e.stopPropagation()} style={{
        width: "min(760px, 92vw)", maxHeight: "86vh", overflowY: "auto", background: "var(--surface, #fff)", borderRadius: "12px", padding: "22px 26px",
      }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "12px" }}>
          <h3 style={{ margin: 0, fontSize: "1rem" }}>{doc?.name ?? "Attachment"}</h3>
          <button type="button" onClick={onClose} aria-label="Close" style={{ border: "none", background: "transparent", fontSize: "1.25rem", cursor: "pointer" }}>×</button>
        </div>
        {error && <p style={{ color: "#dc2626" }}>Couldn't load that document.</p>}
        {!doc && !error && <p>Loading…</p>}
        {doc && <div className="prose prose-sm max-w-none" dangerouslySetInnerHTML={{ __html: markdownToHtml(doc.text) }} />}
      </div>
    </div>
  );
}
