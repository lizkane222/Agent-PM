export function getRsvp(event, userEmail) {
    if (!userEmail || event.attendees.length === 0)
        return "unknown";
    const me = event.attendees.find((a) => a.email.toLowerCase() === userEmail.toLowerCase());
    if (!me)
        return "unknown";
    return me.responseStatus ?? "unknown";
}
//# sourceMappingURL=rsvp.js.map