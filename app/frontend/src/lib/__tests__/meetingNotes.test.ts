import { describe, it, expect } from "vitest";
import { isRecordingOnlyNotes, meetingHasNotes } from "../meetingNotes";

describe("meetingHasNotes", () => {
  it("is false when neither provider has notes", () => {
    expect(meetingHasNotes({ gong_notes: "", zoom_notes: "" })).toBe(false);
  });
  it("treats Airtable's cleared-cell newline as empty", () => {
    expect(meetingHasNotes({ gong_notes: "\n", zoom_notes: " \n" })).toBe(false);
  });
  it("is true for Gong alone or Zoom alone", () => {
    expect(meetingHasNotes({ gong_notes: "Recap", zoom_notes: "" })).toBe(true);
    expect(meetingHasNotes({ gong_notes: "", zoom_notes: "Recap" })).toBe(true);
  });
});

describe("recording-only notes", () => {
  const block = "Recording\n- Duration: 00:31:24\n- Shareable link: https://twilio.zoom.us/rec/share/abc";

  it("recognises the Recording block and nothing else", () => {
    expect(isRecordingOnlyNotes(block)).toBe(true);
    expect(isRecordingOnlyNotes("Recap\n- x")).toBe(false);
    expect(isRecordingOnlyNotes(`${block}\nKey Points\n- y`)).toBe(false);
    expect(isRecordingOnlyNotes("")).toBe(false);
    expect(isRecordingOnlyNotes(undefined)).toBe(false);
  });

  it("does not count a recording link as the meeting having notes", () => {
    expect(meetingHasNotes({ gong_notes: "", zoom_notes: block })).toBe(false);
  });

  it("counts a real summary even when the other provider only has a recording block", () => {
    expect(meetingHasNotes({ gong_notes: "Recap\n- x", zoom_notes: block })).toBe(true);
  });
});
