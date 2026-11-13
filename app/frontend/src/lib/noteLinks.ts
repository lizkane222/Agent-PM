// Drag a note onto a project/goal → LINK it (reference only; the note stays where it is).
//
// One drag payload shared by Account Notes rows and Meeting Notes Timeline rows, and the
// pure helpers ProjectGoals and the badge use, so the key/shape cannot drift between them.

import type { NoteRef } from "../types/accounts";

/** Lowercase on purpose: `dataTransfer.types` is lowercased and dragover can only see types. */
export const NOTE_LINK_DRAG_TYPE = "projectnotelink";

export function noteRefKey(ref: Pick<NoteRef, "kind" | "id">): string {
  return `${ref.kind}:${ref.id}`;
}

/** Collapse HTML/markup to a short single-line label. */
export function noteLabel(text: string, max = 140): string {
  const plain = text.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
  return plain.length > max ? `${plain.slice(0, max - 1)}…` : plain;
}

/** A summary bullet is identified by its meeting plus its text (bullets have no ids). */
export function summaryRefId(meetingAirtableId: string, bulletText: string): string {
  return `${meetingAirtableId}::${bulletText.trim().slice(0, 120)}`;
}

export function setNoteDragData(e: React.DragEvent, ref: NoteRef): void {
  e.dataTransfer.setData(NOTE_LINK_DRAG_TYPE, JSON.stringify(ref));
  e.dataTransfer.effectAllowed = "copyMove";
}

export function isNoteLinkDrag(e: React.DragEvent): boolean {
  return Array.from(e.dataTransfer.types).includes(NOTE_LINK_DRAG_TYPE);
}

export function readNoteDragData(e: React.DragEvent): NoteRef | null {
  const raw = e.dataTransfer.getData(NOTE_LINK_DRAG_TYPE);
  if (!raw) return null;
  try {
    const p = JSON.parse(raw) as Partial<NoteRef>;
    if (p.kind !== "account_note" && p.kind !== "meeting_note" && p.kind !== "summary") return null;
    if (typeof p.id !== "string" || !p.id) return null;
    const ref: NoteRef = { kind: p.kind, id: p.id, label: typeof p.label === "string" ? p.label.slice(0, 300) : "" };
    if (typeof p.meetingId === "string" && p.meetingId) ref.meetingId = p.meetingId;
    return ref;
  } catch {
    return null;
  }
}

/** noteRefKey → names of the projects/goals the note is linked under. */
export type NoteLinkIndex = Record<string, string[]>;

export function buildNoteLinkIndex(goals: { name: string; noteRefs?: NoteRef[] }[]): NoteLinkIndex {
  const out: NoteLinkIndex = {};
  for (const g of goals) {
    for (const r of g.noteRefs ?? []) (out[noteRefKey(r)] ??= []).push(g.name || "Untitled");
  }
  return out;
}

/** Move-semantics link: strip `ref` from every goal, add it to `targetId`. */
export function linkNoteToGoal<G extends { id: string; noteRefs?: NoteRef[] }>(goals: G[], targetId: string, ref: NoteRef): G[] {
  const key = noteRefKey(ref);
  return goals.map((g) => {
    const without = (g.noteRefs ?? []).filter((r) => noteRefKey(r) !== key);
    if (g.id === targetId) return { ...g, noteRefs: [...without, ref] };
    return without.length === (g.noteRefs ?? []).length ? g : { ...g, noteRefs: without };
  });
}
