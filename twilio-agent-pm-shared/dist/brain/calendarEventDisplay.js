const WORK_TRACKING_COLOR = "#a78bfa";
function statusColor(status) {
    if (status === "cancelled")
        return "#d1d5db";
    if (status === "tentative")
        return "#60a5fa";
    return "#3b82f6";
}
export function calendarEventDisplayProps(e) {
    const isWorkSession = e.calendar_id === "work_tracking";
    const isScheduled = e.google_event_id?.startsWith("scheduled-");
    const isScheduledReminder = e.google_event_id?.startsWith("scheduled-reminder-");
    const isDbWorkTracking = isWorkSession && !!e.agentpm_airtable_id && e.is_synced;
    const backgroundColor = isScheduledReminder
        ? "#FFFBEB"
        : isWorkSession
            ? WORK_TRACKING_COLOR
            : statusColor(e.status);
    const borderColor = isScheduledReminder
        ? "#f59e0b"
        : isWorkSession
            ? WORK_TRACKING_COLOR
            : statusColor(e.status);
    const textColor = isScheduledReminder ? "#92400e" : "#ffffff";
    const editable = isScheduled || isDbWorkTracking || (!isWorkSession && !isScheduledReminder);
    const title = isWorkSession && !isScheduledReminder ? `⏱ ${e.title}` : e.title;
    return { backgroundColor, borderColor, textColor, editable, title };
}
//# sourceMappingURL=calendarEventDisplay.js.map