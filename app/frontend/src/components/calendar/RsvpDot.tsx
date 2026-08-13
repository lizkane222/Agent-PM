import type { RsvpStatus } from "twilio-agent-pm-shared";

export default function RsvpDot({ rsvp }: { rsvp: RsvpStatus }) {
  if (rsvp === "accepted") {
    return <span className="h-2 w-2 rounded-full bg-green-400 shrink-0 mt-0.5" />;
  }
  if (rsvp === "tentative") {
    return <span className="h-2 w-2 rounded-full bg-yellow-400 shrink-0 mt-0.5" />;
  }
  if (rsvp === "needsAction") {
    return <span className="h-2 w-2 rounded-full bg-sky-400 shrink-0 mt-0.5 animate-pulse" />;
  }
  if (rsvp === "unknown") {
    return <span className="h-2 w-2 rounded-full bg-gray-400 shrink-0 mt-0.5" />;
  }
  // declined — no dot
  return null;
}
