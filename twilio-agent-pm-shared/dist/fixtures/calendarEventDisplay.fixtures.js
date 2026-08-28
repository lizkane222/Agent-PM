// Derives display props from a CalendarEvent.
// toFullCalendarEvent() is a pure transform — no I/O.
export const CALENDAR_EVENT_DISPLAY_FIXTURES = [
    // ── Regular confirmed meeting ─────────────────────────────────────────────
    {
        input: { calendar_id: "primary", google_event_id: "abc123", is_synced: true, agentpm_airtable_id: "", status: "confirmed", title: "Standup" },
        expected: { backgroundColor: "#3b82f6", borderColor: "#3b82f6", textColor: "#ffffff", editable: true },
        note: "confirmed regular meeting — blue, editable",
    },
    // ── Tentative meeting ─────────────────────────────────────────────────────
    {
        input: { calendar_id: "primary", google_event_id: "abc124", is_synced: true, agentpm_airtable_id: "", status: "tentative", title: "Tentative sync" },
        expected: { backgroundColor: "#60a5fa", borderColor: "#60a5fa", textColor: "#ffffff", editable: true },
        note: "tentative — lighter blue",
    },
    // ── Cancelled meeting ─────────────────────────────────────────────────────
    {
        input: { calendar_id: "primary", google_event_id: "abc125", is_synced: true, agentpm_airtable_id: "", status: "cancelled", title: "Cancelled" },
        expected: { backgroundColor: "#d1d5db", borderColor: "#d1d5db", textColor: "#ffffff", editable: true },
        note: "cancelled — gray",
    },
    // ── Work-tracking session (db-backed, editable) ───────────────────────────
    {
        input: { calendar_id: "work_tracking", google_event_id: "wt-001", is_synced: true, agentpm_airtable_id: "recABC", status: "confirmed", title: "Deep work" },
        expected: { backgroundColor: "#a78bfa", borderColor: "#a78bfa", textColor: "#ffffff", editable: true, titlePrefix: "⏱ " },
        note: "work session with airtable_id + is_synced — violet, editable",
    },
    // ── Work-tracking session (not yet synced — not editable) ─────────────────
    {
        input: { calendar_id: "work_tracking", google_event_id: "wt-002", is_synced: false, agentpm_airtable_id: "", status: "confirmed", title: "Focus" },
        expected: { backgroundColor: "#a78bfa", borderColor: "#a78bfa", textColor: "#ffffff", editable: false, titlePrefix: "⏱ " },
        note: "work session not synced — not editable",
    },
    // ── Scheduled action item drop (google_event_id starts with 'scheduled-') ─
    {
        input: { calendar_id: "primary", google_event_id: "scheduled-recXYZ", is_synced: false, agentpm_airtable_id: "", status: "confirmed", title: "Task block" },
        expected: { backgroundColor: "#3b82f6", borderColor: "#3b82f6", textColor: "#ffffff", editable: true },
        note: "scheduled action item — editable, no prefix",
    },
    // ── Scheduled reminder ────────────────────────────────────────────────────
    {
        input: { calendar_id: "primary", google_event_id: "scheduled-reminder-rem1", is_synced: false, agentpm_airtable_id: "", status: "confirmed", title: "Reminder" },
        // "scheduled-reminder-" starts with "scheduled-", so isScheduled=true and editable=true.
        // The amber colors still apply via isScheduledReminder.
        expected: { backgroundColor: "#FFFBEB", borderColor: "#f59e0b", textColor: "#92400e", editable: true },
        note: "scheduled reminder — amber/warm, editable (isScheduled wins over isScheduledReminder for editability)",
    },
];
//# sourceMappingURL=calendarEventDisplay.fixtures.js.map