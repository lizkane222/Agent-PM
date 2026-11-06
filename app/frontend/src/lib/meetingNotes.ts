import type { AirtableMeeting } from "../types";

/** Window event fired when a background check added notes, so open pages re-read meetings. */
export const MEETING_NOTES_UPDATED_EVENT = "meetingNotesUpdated";

/** The Zoom tab's stand-in when the email only linked a recording: a "Recording" block of
 *  duration + link, no recap. Mirrors `is_recording_only` in integrations/meeting_notes.py. */
export function isRecordingOnlyNotes(text: string | null | undefined): boolean {
  const t = (text ?? "").trim();
  return t.split("\n")[0].trim() === "Recording" && !/^(recap|key points|next steps)\s*:?$/im.test(t);
}

/** True once either provider's recap is stored. Whitespace-only counts as empty (Airtable
 *  normalises a cleared richText cell to "\n"), and so does a recording-only block, which
 *  is a link to the recording rather than notes. */
export function meetingHasNotes(m: Pick<AirtableMeeting, "gong_notes" | "zoom_notes">): boolean {
  const real = (t: string | undefined) => Boolean((t ?? "").trim()) && !isRecordingOnlyNotes(t);
  return real(m.gong_notes) || real(m.zoom_notes);
}
