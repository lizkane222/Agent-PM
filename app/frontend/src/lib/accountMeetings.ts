import type { AirtableMeeting, CalendarEvent } from "../types";

/**
 * The meetings an account has, counted the way the Timeline draws them.
 *
 * The Timeline plots every dated Airtable meeting AND every calendar event for the account.
 * The sidebar used to count only `meetings.length`, which includes undated rows the
 * Timeline cannot place and leaves out every calendar-only meeting (most of them: a
 * Google-synced event has no Airtable meeting row until notes arrive). Both now derive from
 * this one function.
 *
 * A calendar event that is the calendar side of a listed meeting
 * (`event.agentpm_airtable_id === meeting.airtable_id`) is one meeting, not two.
 */
export function timelineMeetingCount(
  meetings: Pick<AirtableMeeting, "airtable_id" | "date">[],
  calendarEvents: Pick<CalendarEvent, "agentpm_airtable_id">[],
): { total: number; withRecord: number; calendarOnly: number } {
  const dated = meetings.filter((m) => Boolean(m.date));
  const known = new Set(dated.map((m) => m.airtable_id));
  const calendarOnly = calendarEvents.filter((e) => !e.agentpm_airtable_id || !known.has(e.agentpm_airtable_id)).length;
  return { total: dated.length + calendarOnly, withRecord: dated.length, calendarOnly };
}
