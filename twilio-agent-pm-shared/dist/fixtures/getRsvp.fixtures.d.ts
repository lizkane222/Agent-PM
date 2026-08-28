import type { Attendee, RsvpStatus } from "../types.js";
export interface GetRsvpFixture {
    attendees: Attendee[];
    userEmail: string | null;
    expected: RsvpStatus;
    note?: string;
}
export declare const GET_RSVP_FIXTURES: GetRsvpFixture[];
//# sourceMappingURL=getRsvp.fixtures.d.ts.map