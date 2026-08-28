export interface CalendarEventDisplayInput {
    calendar_id: string;
    google_event_id: string;
    is_synced: boolean;
    agentpm_airtable_id: string;
    status: "confirmed" | "tentative" | "cancelled";
    title: string;
}
export interface CalendarEventDisplayExpected {
    backgroundColor: string;
    borderColor: string;
    textColor: string;
    editable: boolean;
    titlePrefix?: string;
}
export interface CalendarEventDisplayFixture {
    input: CalendarEventDisplayInput;
    expected: CalendarEventDisplayExpected;
    note?: string;
}
export declare const CALENDAR_EVENT_DISPLAY_FIXTURES: CalendarEventDisplayFixture[];
//# sourceMappingURL=calendarEventDisplay.fixtures.d.ts.map