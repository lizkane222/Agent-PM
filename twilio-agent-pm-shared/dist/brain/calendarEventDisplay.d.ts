import type { CalendarEvent } from "../types.js";
export interface CalendarEventDisplayProps {
    backgroundColor: string;
    borderColor: string;
    textColor: string;
    editable: boolean;
    title: string;
}
export declare function calendarEventDisplayProps(e: Pick<CalendarEvent, "calendar_id" | "google_event_id" | "is_synced" | "agentpm_airtable_id" | "status" | "title">): CalendarEventDisplayProps;
//# sourceMappingURL=calendarEventDisplay.d.ts.map