import { useEffect, useState } from "react";
import { useAccountTickets } from "../../hooks/useAccountTickets";
import { TICKET_KIND_TITLE, TICKET_STATUS_LABEL, TICKET_EMPTY_TEXT } from "../../lib/tickets";
import type { TicketKind } from "../../types";
import { useNotifications } from "../../hooks/useNotifications";
import { usePublicItems } from "../../hooks/usePublicItems";
import { userPageNoteApi } from "../../lib/api";
import { htmlToPreviewText } from "../../lib/noteHelpers";
import { CardList, RichHtml, fieldsOf, fmtDateTime, type FullCard } from "./fullscreen";
import { filledFields, type MiniNode, type SavedCanvas } from "./miniCanvas";
import type { UserPageNote } from "../../types";

/** The contents of the full-screen panels for the sections that own their own data. */

export function NotificationsFull({ accent }: { accent: string }) {
  const { data, loading, error } = useNotifications();
  if (loading) return <p style={{ fontSize: "0.875rem", color: "var(--text-secondary, #888)" }}>Loading…</p>;
  if (error) return <p style={{ fontSize: "0.875rem", color: "var(--ink-red)" }}>Could not load notifications.</p>;
  const cards: FullCard[] = data.map(n => ({
    id: n.id,
    title: <>{n.title || "Notification"}{!n.read_at && <span title="Unread" style={{ marginLeft: 8, color: "#dc2626" }}>●</span>}</>,
    subtitle: [n.channel, n.kind.replace(/_/g, " "), fmtDateTime(n.created_at)].filter(Boolean).join(" · "),
    fields: fieldsOf(n, { html: [], hide: ["id", "reminder", "can_snooze"] }),
    actions: n.link ? <a href={n.link} style={{ fontSize: "0.8125rem", fontWeight: 600, color: accent }}>Open</a> : undefined,
  }));
  return <CardList cards={cards} accent={accent} empty="No notifications yet." />;
}

export function PublicFull({ memberId, accent }: { memberId: number; accent: string }) {
  const { data, loading } = usePublicItems(memberId);
  if (loading) return <p style={{ fontSize: "0.875rem", color: "var(--text-secondary, #888)" }}>Loading…</p>;
  const cards: FullCard[] = data.map(i => ({
    id: i.id,
    title: i.title || "Untitled",
    subtitle: i.item_type.replace(/_/g, " "),
    fields: fieldsOf(i, { html: ["body"], hide: ["id", "owner", "position"] }),
    actions: (i.url || i.file_url)
      ? <a href={i.url || i.file_url} target="_blank" rel="noopener noreferrer" style={{ fontSize: "0.8125rem", fontWeight: 600, color: accent }}>Open</a>
      : undefined,
  }));
  return <CardList cards={cards} accent={accent} empty="Nothing public yet." />;
}

export function NotepadFull({ accent }: { accent: string }) {
  const [notes, setNotes] = useState<UserPageNote[] | null>(null);
  useEffect(() => { userPageNoteApi.list().then(r => setNotes(r.data)).catch(() => setNotes([])); }, []);
  if (notes === null) return <p style={{ fontSize: "0.875rem", color: "var(--text-secondary, #888)" }}>Loading…</p>;
  const cards: FullCard[] = notes.map(n => ({
    id: n.id,
    title: htmlToPreviewText(n.content).slice(0, 80) || "Empty note",
    subtitle: [n.account_name || "General note", `Updated ${fmtDateTime(n.updated_at)}`].join(" · "),
    fields: [
      { label: "Note", value: <RichHtml html={n.content} /> },
      ...fieldsOf(n, { hide: ["id", "owner", "owner_username", "content", "account", "account_ref_label"], labels: { account_name: "Linked account" } }),
    ],
  }));
  return <CardList cards={cards} accent={accent} empty="No notes yet." />;
}

function nodeSummary(n: MiniNode): string {
  return n.text?.trim() || n.record?.label || n.label || n.type;
}

function canvasCard(id: string, title: string, subtitle: string, nodes: MiniNode[]): FullCard {
  return {
    id,
    title,
    subtitle,
    fields: nodes.length === 0
      ? [{ label: "Components", value: "Nothing on this canvas." }]
      : nodes.map((n, i) => ({
          label: `${i + 1}. ${n.type}`,
          value: (
            <div>
              <div>{nodeSummary(n)}</div>
              {filledFields(n).map(f => (
                <div key={f.key} style={{ marginTop: 2, color: "var(--text-secondary, #666)" }}><strong>{f.label}:</strong> {f.value}</div>
              ))}
            </div>
          ),
        })),
  };
}

/** The mini canvas as it is stored: the current canvas first, then each saved one. */
export function MiniCanvasFull({ nodes, saved, accent }: { nodes: MiniNode[]; saved: SavedCanvas[]; accent: string }) {
  const cards = [
    canvasCard("current", "Current canvas", `${nodes.length} component${nodes.length === 1 ? "" : "s"}`, nodes),
    ...saved.map(s => canvasCard(s.id, s.label, `Saved ${fmtDateTime(new Date(s.savedAt).toISOString())} · ${s.nodes.length} component${s.nodes.length === 1 ? "" : "s"}`, s.nodes)),
  ];
  return <CardList cards={cards} accent={accent} empty="Nothing here yet." />;
}

/** A ticket kind's records as cards, the ones waiting for an account pinned first. */
export function TicketsFull({ kind, accent }: { kind: TicketKind; accent: string }) {
  const { data, loading } = useAccountTickets({ kind });
  const review = useAccountTickets({ review: "needs_review" });
  if (loading) return <p style={{ fontSize: "0.875rem", color: "var(--text-secondary, #888)" }}>Loading…</p>;
  const hide = ["id", "account", "created_by", "found_by", "review_state", "source_message_id", "kind"];
  const toCard = (t: (typeof data)[number], pinned: boolean): FullCard => ({
    id: `${pinned ? "p" : "t"}-${t.id}`,
    title: <>{pinned && <span title="Needs an account">📌 </span>}{t.title || t.external_key || t.url || "Untitled"}</>,
    subtitle: pinned ? "Found in your email · needs an account" : [t.account_name, TICKET_STATUS_LABEL[t.status], t.external_key].filter(Boolean).join(" · "),
    fields: fieldsOf(t, { html: ["notes"], hide }),
    actions: t.url ? <a href={t.url} target="_blank" rel="noopener noreferrer" style={{ fontSize: "0.8125rem", fontWeight: 600, color: accent }}>Open link</a> : undefined,
  });
  const cards = [
    ...review.data.filter((t) => t.kind === kind).map((t) => toCard(t, true)),
    ...data.map((t) => toCard(t, false)),
  ];
  return (
    <>
      <p style={{ margin: "0 0 10px", fontSize: "0.8125rem", color: "var(--text-secondary, #888)" }}>{TICKET_KIND_TITLE[kind]}</p>
      <CardList cards={cards} accent={accent} empty={TICKET_EMPTY_TEXT[kind]} />
    </>
  );
}
