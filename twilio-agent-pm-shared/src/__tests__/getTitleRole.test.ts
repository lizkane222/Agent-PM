import { getTitleRole } from "../brain/titleRoles.js";
import { GET_TITLE_ROLE_FIXTURES } from "../fixtures/getTitleRole.fixtures.js";

describe("getTitleRole", () => {
  for (const fixture of GET_TITLE_ROLE_FIXTURES) {
    const label = fixture.note
      ? `${JSON.stringify(fixture.input)} (${fixture.note})`
      : JSON.stringify(fixture.input);
    it(`${label} → "${fixture.expected}"`, () => {
      expect(getTitleRole(fixture.input)).toBe(fixture.expected);
    });
  }
});
