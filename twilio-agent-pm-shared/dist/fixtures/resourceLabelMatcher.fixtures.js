// The URL → resource label ordered-regex classifier.
// First-match wins; order matters for overlapping patterns.
export const RESOURCE_LABEL_FIXTURES = [
    // ── Airtable ──────────────────────────────────────────────────────────────
    { url: "/airtable/action-items/", method: "POST", expectedLabel: "Action Item" },
    { url: "/airtable/action-items/123/", method: "DELETE", expectedLabel: "Action Item" },
    { url: "/airtable/meetings/", method: "PATCH", expectedLabel: "Meeting" },
    { url: "/airtable/accounts/", method: "POST", expectedLabel: "Airtable Account" },
    // ── Accounts (must not match /airtable/accounts before /accounts) ─────────
    { url: "/accounts/notes/5/", method: "PATCH", expectedLabel: "Account Note" },
    { url: "/accounts/artifacts/3/", method: "DELETE", expectedLabel: "Account Artifact" },
    { url: "/accounts/contacts/", method: "POST", expectedLabel: "Contact" },
    { url: "/accounts/accounts/", method: "POST", expectedLabel: "Account" },
    { url: "/accounts/accounts/42/", method: "DELETE", expectedLabel: "Account" },
    // ── Scheduler ─────────────────────────────────────────────────────────────
    { url: "/scheduler/events/", method: "POST", expectedLabel: "Calendar Event" },
    { url: "/scheduler/action-items/", method: "POST", expectedLabel: "Action Item" },
    { url: "/scheduler/reminders/", method: "POST", expectedLabel: "Reminder" },
    { url: "/scheduler/tasks/", method: "POST", expectedLabel: "Task" },
    { url: "/scheduler/meeting-notes/", method: "POST", expectedLabel: "Meeting Note" },
    // ── Team ──────────────────────────────────────────────────────────────────
    { url: "/team/members/", method: "POST", expectedLabel: "Team Member" },
    { url: "/team/profiles/me/", method: "PATCH", expectedLabel: "Profile" },
    // ── Other ─────────────────────────────────────────────────────────────────
    { url: "/comments/comments/", method: "POST", expectedLabel: "Comment" },
    { url: "/skills/skills/", method: "POST", expectedLabel: "Claude Skill" },
    { url: "/layouts/", method: "POST", expectedLabel: "Page Layout" },
    { url: "/salesforce/log-time/", method: "POST", expectedLabel: "Salesforce Time Log" },
    { url: "/discover/applets/", method: "POST", expectedLabel: "Discover Applet" },
    // ── No-match cases ────────────────────────────────────────────────────────
    { url: "/auth/token/", method: "POST", expectedLabel: null, note: "auth — not tracked" },
    { url: "/realtime/activity/", method: "POST", expectedLabel: null, note: "realtime — not tracked" },
    // ── GET requests should not emit (verb not in METHOD_VERBS) ───────────────
];
//# sourceMappingURL=resourceLabelMatcher.fixtures.js.map