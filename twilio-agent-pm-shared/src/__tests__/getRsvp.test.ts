import { getRsvp } from "../brain/rsvp.js";
import { GET_RSVP_FIXTURES } from "../fixtures/getRsvp.fixtures.js";

describe("getRsvp", () => {
  for (const fixture of GET_RSVP_FIXTURES) {
    const label = fixture.note ?? `email=${fixture.userEmail} attendees=${fixture.attendees.length}`;
    it(`${label} → "${fixture.expected}"`, () => {
      expect(getRsvp({ attendees: fixture.attendees }, fixture.userEmail)).toBe(fixture.expected);
    });
  }
});
