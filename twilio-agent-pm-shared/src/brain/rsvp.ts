import type { Attendee, CalendarEvent, RsvpStatus } from "../types.js";

export function getRsvp(
  event: Pick<CalendarEvent, "attendees">,
  userEmail: string | null,
): RsvpStatus {
  if (!userEmail || event.attendees.length === 0) return "unknown";
  const me = event.attendees.find(
    (a: Attendee) => a.email.toLowerCase() === userEmail.toLowerCase(),
  );
  if (!me) return "unknown";
  return (me.responseStatus as RsvpStatus) ?? "unknown";
}
