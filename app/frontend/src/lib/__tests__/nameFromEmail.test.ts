import { describe, it, expect } from "vitest";
import { nameFromEmail, fullNameFromEmail, properCase } from "../nameFromEmail";

const n = (e: string, known?: string[]) => nameFromEmail(e, known);

describe("nameFromEmail", () => {
  it.each([
    ["jane.doe@x.com", "Jane", "Doe"],
    ["jane_doe@x.com", "Jane", "Doe"],
    ["jane-doe@x.com", "Jane", "Doe"],
    ["JANE.DOE@X.COM", "Jane", "Doe"],
    ["jane.doe+tag@x.com", "Jane", "Doe"],
    ["jane.doe2@x.com", "Jane", "Doe"],
    ["pat.o'brien@x.com", "Pat", "O'Brien"],
    ["pat.mcdonald@x.com", "Pat", "McDonald"],
    ["josé.núñez@x.com", "José", "Núñez"],
    ["john.q.public@x.com", "John", "Public"],
  ])("%s is high confidence", (email, first, last) => {
    expect(n(email)).toEqual({ first, last, confidence: "high" });
  });

  it("does not reverse order", () => {
    expect(n("doe.jane@x.com")).toEqual({ first: "Doe", last: "Jane", confidence: "high" });
  });

  it("reads initial + surname as low confidence", () => {
    expect(n("j.doe@x.com")).toEqual({ first: "J", last: "Doe", confidence: "low" });
    expect(n("jdoe@x.com")).toEqual({ first: "J", last: "Doe", confidence: "low" });
  });

  it("takes first and last token of 3+ parts, low confidence", () => {
    expect(n("mary.ann.smith@x.com")).toEqual({ first: "Mary", last: "Smith", confidence: "low" });
  });

  it("does not guess an unseparated full name", () => {
    expect(n("janedoe@x.com").confidence).toBe("none");
    expect(n("marcus@x.com").confidence).toBe("none");
  });

  it("resolves an unseparated name from known names", () => {
    expect(n("janedoe@x.com", ["Jane Doe"])).toEqual({ first: "Jane", last: "Doe", confidence: "high" });
    expect(n("jdoe@x.com", ["Jane Doe"])).toEqual({ first: "Jane", last: "Doe", confidence: "low" });
  });

  it.each(["info", "sales", "support", "noreply", "no-reply", "admin", "hello", "team", "billing", "accounts", "sales.team", "no.reply"])(
    "ignores generic mailbox %s",
    (local) => {
      expect(n(`${local}@x.com`)).toEqual({ first: "", last: "", confidence: "none" });
    },
  );

  it("handles junk input", () => {
    expect(n("").confidence).toBe("none");
    expect(n("nope").confidence).toBe("none");
    expect(n("@x.com").confidence).toBe("none");
    expect(n("123@x.com").confidence).toBe("none");
    expect(n("a@x.com").confidence).toBe("none");
  });

  it("fullNameFromEmail joins names", () => {
    expect(fullNameFromEmail("jane.doe@x.com")).toEqual({ name: "Jane Doe", confidence: "high" });
    expect(fullNameFromEmail("info@x.com")).toEqual({ name: "", confidence: "none" });
  });

  it("properCase handles apostrophes and Mc", () => {
    expect(properCase("o'brien")).toBe("O'Brien");
    expect(properCase("mcdonald")).toBe("McDonald");
    expect(properCase("MCA")).toBe("Mca");
  });
});
