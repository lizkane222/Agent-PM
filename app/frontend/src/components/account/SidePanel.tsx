import type { PanelItem, AirtableActionItem, AirtableMeeting, TeamMember, Account, CustomerContact } from "../../types";
import { Avatar } from "./Avatar";
import { ReminderSection } from "./ReminderSection";
import { MeetingNotesPanel } from "./MeetingNotesPanel";
import { GongSummaryPanel } from "./GongSummaryPanel";
import { AttendeeList } from "./AttendeeList";
import { ActionItemSidePanelContent } from "./ActionItemSidePanelContent";
import { ContactSidePanelContent } from "./ContactSidePanelContent";

function fmtDuration(secs: number): string {
  if (!secs) return "—";
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

export function SidePanel({ panel, onClose, onCreatedActionItem, onMeetingUpdated, onUpdatedActionItem, teamMembers = [], airtableAccountId, account, contacts, onContactsChange }: { panel: PanelItem; onClose: () => void; onCreatedActionItem?: (item: AirtableActionItem) => void; onMeetingUpdated?: (updated: AirtableMeeting) => void; onUpdatedActionItem?: (updated: AirtableActionItem) => void; teamMembers?: TeamMember[]; airtableAccountId?: number | null; account?: Account | null; contacts?: CustomerContact[]; onContactsChange?: (c: CustomerContact[]) => void }) {
  return (
    <div className="w-full h-full bg-white flex flex-col">
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
        <p className="text-sm font-semibold text-[var(--twilio-navy)] capitalize">
          {panel.kind === "calendar" ? "Event Details" : panel.kind === "contact" ? "Customer Contact" : `${panel.kind} Details`}
        </p>
        <button onClick={onClose} className="text-lg leading-none hover:opacity-60 transition-opacity" style={{ color: "var(--text-secondary, #888)" }}>✕</button>
      </div>
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3 text-sm text-[var(--twilio-navy)]">
        {panel.kind === "action" && (
          <ActionItemSidePanelContent
            item={panel.item}
            teamMembers={teamMembers}
            onUpdated={onUpdatedActionItem}
          />
        )}
        {panel.kind === "meeting" && (
          <>
            <p className="font-semibold text-base leading-snug">{panel.item.name || <span className="italic opacity-50">Untitled meeting</span>}</p>
            {panel.item.date && <p><span className="opacity-50">Date </span>{new Date(panel.item.date).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric", year: "numeric" })}</p>}
            {panel.item.duration > 0 && <p><span className="opacity-50">Duration </span>{fmtDuration(panel.item.duration)}</p>}
            {panel.item.expected_topics && (
              <div>
                <p className="font-medium mb-1">Expected Topics</p>
                <p className="opacity-70 leading-relaxed whitespace-pre-wrap">{panel.item.expected_topics}</p>
              </div>
            )}
            {panel.item.gong_url && <a href={panel.item.gong_url} target="_blank" rel="noreferrer" className="underline text-xs" style={{ color: "var(--twilio-red, #e22)" }}>Gong recording ↗</a>}
            {panel.item.customer_slack && <a href={panel.item.customer_slack} target="_blank" rel="noreferrer" className="block underline text-xs" style={{ color: "var(--twilio-red, #e22)" }}>Customer Slack ↗</a>}
            <GongSummaryPanel eventId={0} meetingId={panel.item.id} existingNotes={panel.item.gong_notes} existingZoomNotes={panel.item.zoom_notes} accountName={panel.item.account_name} airtableAccountId={airtableAccountId} onCreatedActionItem={onCreatedActionItem} onSaved={onMeetingUpdated} teamMembers={teamMembers} />
          </>
        )}
        {panel.kind === "member" && (
          <>
            <div className="flex items-center gap-3">
              <Avatar name={panel.item.full_name} avatarUrl={panel.item.avatar_url} size={12} />
              <div>
                <p className="font-semibold">{panel.item.full_name}</p>
                {panel.item.title && <p className="text-xs opacity-60">{panel.item.title}</p>}
              </div>
            </div>
            {panel.item.department && <p><span className="opacity-50">Dept </span>{panel.item.department}</p>}
            {panel.item.email && <p className="text-xs" style={{ color: "var(--twilio-red, #e22)" }}>{panel.item.email}</p>}
            {panel.item.slack_handle && <p><span className="opacity-50">Slack </span>@{panel.item.slack_handle}</p>}
          </>
        )}
        {panel.kind === "contact" && (
          <ContactSidePanelContent
            key={panel.item.id}
            contact={panel.item}
            onUpdated={(updated) => {
              onContactsChange?.((contacts ?? []).map((c) => c.id === updated.id ? updated : c));
            }}
            onDeleted={(id) => {
              onContactsChange?.((contacts ?? []).filter((c) => c.id !== id));
              onClose();
            }}
          />
        )}
        {panel.kind === "calendar" && (() => {
          const ev = panel.item;
          const start = new Date(ev.start_datetime);
          const end = new Date(ev.end_datetime);
          const durationMin = Math.round((end.getTime() - start.getTime()) / 60000);
          const responseColor: Record<string, string> = {
            accepted: "#15803d", declined: "#dc2626", tentative: "#a16207", needsAction: "#888",
          };
          return (
            <>
              {/* Status badge */}
              {ev.status !== "confirmed" && (
                <span style={{ display: "inline-block", fontSize: "0.6875rem", fontWeight: 600, padding: "2px 8px", borderRadius: "6px", background: ev.status === "cancelled" ? "#fee2e2" : "#fef9c3", color: ev.status === "cancelled" ? "#dc2626" : "#a16207", marginBottom: "2px" }}>
                  {ev.status}
                </span>
              )}

              {/* Title */}
              <p className="font-semibold text-base leading-snug" style={{ color: "var(--text-primary, #111)" }}>{ev.title || <span className="italic opacity-50">Untitled event</span>}</p>

              {/* Time */}
              <div style={{ display: "flex", flexDirection: "column", gap: "2px" }}>
                <p>
                  <span className="opacity-50">Start </span>
                  {start.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric", year: "numeric" })}
                  {" "}
                  {ev.all_day ? <span className="opacity-50">(all day)</span> : start.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}
                </p>
                {!ev.all_day && durationMin > 0 && (
                  <p><span className="opacity-50">Duration </span>{durationMin < 60 ? `${durationMin}m` : `${Math.floor(durationMin / 60)}h${durationMin % 60 > 0 ? ` ${durationMin % 60}m` : ""}`}</p>
                )}
              </div>

              {/* Location */}
              {ev.location && (
                <p>
                  <span className="opacity-50">Location </span>
                  {/^https?:\/\//i.test(ev.location) ? (
                    <a href={ev.location} target="_blank" rel="noreferrer" style={{ color: "var(--twilio-red, #e22)", textDecoration: "underline" }}>{ev.location}</a>
                  ) : ev.location}
                </p>
              )}

              {/* Meet link */}
              {ev.meet_link && (
                <a href={ev.meet_link} target="_blank" rel="noreferrer" style={{ display: "inline-flex", alignItems: "center", gap: "5px", fontSize: "0.75rem", fontWeight: 600, color: "#fff", background: "#0f9d58", padding: "5px 10px", borderRadius: "6px", textDecoration: "none" }}>
                  <svg viewBox="0 0 24 24" fill="currentColor" style={{ width: "13px", height: "13px" }}><path d="M20 18h-2V7.25L11 12 4 7.25V18H2V6h1.2L11 10.75 18.8 6H20v12z"/></svg>
                  Join Google Meet ↗
                </a>
              )}

              {/* Description — render URLs as links */}
              {ev.description && (
                <div>
                  <p className="font-medium mb-1">Description</p>
                  <div className="opacity-70 leading-relaxed whitespace-pre-wrap break-words" style={{ fontSize: "0.75rem" }}>
                    {ev.description.split(/(https?:\/\/[^\s<>"]+)/g).map((part, i) =>
                      /^https?:\/\//i.test(part)
                        ? <a key={i} href={part} target="_blank" rel="noreferrer" style={{ color: "var(--twilio-red, #e22)", textDecoration: "underline", wordBreak: "break-all" }}>{part}</a>
                        : part
                    )}
                  </div>
                </div>
              )}

              {/* Attendees */}
              {ev.attendees?.length > 0 && (
                <AttendeeList
                  attendees={ev.attendees}
                  responseColor={responseColor}
                  account={account}
                  teamMembers={teamMembers}
                  contacts={contacts ?? []}
                  onAccountUpdated={(updated) => { /* account refresh handled by parent re-fetch */ void updated; }}
                  onContactsChange={onContactsChange}
                />
              )}

              {/* Reminders for this meeting */}
              {panel.kind === "calendar" && panel.onAddReminder && (
                <div style={{ borderTop: "1px solid rgba(0,0,0,0.06)", paddingTop: "10px", marginTop: "4px" }}>
                  <ReminderSection
                    reminders={panel.reminders ?? []}
                    onAdd={panel.onAddReminder}
                    onDismiss={panel.onDismissReminder ?? (() => Promise.resolve())}
                    compact
                  />
                </div>
              )}

              {/* Meeting notes — synced with Calendar page */}
              <div style={{ borderTop: "1px solid rgba(0,0,0,0.06)", paddingTop: "10px", marginTop: "4px" }}>
                <MeetingNotesPanel eventId={ev.id} accountName={ev.account_name} airtableAccountId={airtableAccountId} linkedMeetingId={panel.kind === "calendar" ? panel.linkedMeeting?.id : undefined} onCreatedActionItem={onCreatedActionItem} />
                <GongSummaryPanel eventId={ev.id} meetingId={panel.kind === "calendar" ? panel.linkedMeeting?.id : undefined} existingNotes={panel.kind === "calendar" ? panel.linkedMeeting?.gong_notes : undefined} existingZoomNotes={panel.kind === "calendar" ? panel.linkedMeeting?.zoom_notes : undefined} accountName={ev.account_name} airtableAccountId={airtableAccountId} onCreatedActionItem={onCreatedActionItem} onSaved={onMeetingUpdated} teamMembers={teamMembers} />
              </div>
            </>
          );
        })()}
      </div>
    </div>
  );
}
