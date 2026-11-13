import { describe, it, expect } from "vitest";
import { sendFailureMessage, tooLongMessage, CHAT_MESSAGE_MAX } from "../chatSend";

describe("sendFailureMessage", () => {
  it("explains the length refusal in words", () => {
    const m = sendFailureMessage(400, JSON.stringify({ message: ["Ensure this field has no more than 10000 characters."] }));
    expect(m).toContain("10,000-character limit");
    expect(m).not.toContain("Ensure this field");
  });
  it("prefers the server's own detail", () => expect(sendFailureMessage(403, '{"detail":"Blocked."}')).toBe("Blocked."));
  it("falls back by status for non-JSON bodies", () => {
    expect(sendFailureMessage(401, "<html>")).toMatch(/expired/);
    expect(sendFailureMessage(429, "")).toMatch(/Too many/);
    expect(sendFailureMessage(500, "boom")).toContain("500");
  });
  it("states the size and the cap for an over-long message", () => {
    expect(tooLongMessage(12345)).toContain("12,345");
    expect(CHAT_MESSAGE_MAX).toBe(10_000);
  });
});
