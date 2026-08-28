export const GET_RSVP_FIXTURES = [
    // ── No attendees ─────────────────────────────────────────────────────────
    { attendees: [], userEmail: "user@twilio.com", expected: "unknown", note: "no attendees" },
    { attendees: [], userEmail: null, expected: "unknown", note: "null email + no attendees" },
    // ── Null email ────────────────────────────────────────────────────────────
    {
        attendees: [{ email: "user@twilio.com", responseStatus: "accepted" }],
        userEmail: null,
        expected: "unknown",
        note: "null email always returns unknown",
    },
    // ── User found ────────────────────────────────────────────────────────────
    {
        attendees: [{ email: "user@twilio.com", responseStatus: "accepted" }],
        userEmail: "user@twilio.com",
        expected: "accepted",
    },
    {
        attendees: [{ email: "user@twilio.com", responseStatus: "declined" }],
        userEmail: "user@twilio.com",
        expected: "declined",
    },
    {
        attendees: [{ email: "user@twilio.com", responseStatus: "tentative" }],
        userEmail: "user@twilio.com",
        expected: "tentative",
    },
    {
        attendees: [{ email: "user@twilio.com", responseStatus: "needsAction" }],
        userEmail: "user@twilio.com",
        expected: "needsAction",
    },
    // ── Case-insensitive match ────────────────────────────────────────────────
    {
        attendees: [{ email: "User@Twilio.COM", responseStatus: "accepted" }],
        userEmail: "user@twilio.com",
        expected: "accepted",
        note: "email comparison is case-insensitive",
    },
    // ── User not in attendee list ─────────────────────────────────────────────
    {
        attendees: [{ email: "other@twilio.com", responseStatus: "accepted" }],
        userEmail: "user@twilio.com",
        expected: "unknown",
        note: "user not among attendees",
    },
    // ── Multiple attendees, user is one of them ───────────────────────────────
    {
        attendees: [
            { email: "other@twilio.com", responseStatus: "accepted" },
            { email: "user@twilio.com", responseStatus: "needsAction" },
        ],
        userEmail: "user@twilio.com",
        expected: "needsAction",
    },
];
//# sourceMappingURL=getRsvp.fixtures.js.map