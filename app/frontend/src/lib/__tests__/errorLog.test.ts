import { describe, it, expect, beforeEach, vi } from "vitest";
import { addError, getErrors, ERROR_LOG_KEY } from "../errorLog";

describe("errorLog", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("addError returns the stored entry with id and ts", () => {
    const entry = addError({ message: "Something failed", source: "comments" });
    expect(entry.message).toBe("Something failed");
    expect(entry.source).toBe("comments");
    expect(typeof entry.id).toBe("string");
    expect(entry.id.length).toBeGreaterThan(0);
    expect(typeof entry.ts).toBe("number");
  });

  it("getErrors returns entries newest-first", () => {
    addError({ message: "First" });
    addError({ message: "Second" });
    const errors = getErrors();
    expect(errors[0].message).toBe("Second");
    expect(errors[1].message).toBe("First");
  });

  it("addError dispatches a storage event with the correct key", () => {
    const listener = vi.fn();
    window.addEventListener("storage", listener);
    addError({ message: "Event test" });
    window.removeEventListener("storage", listener);
    expect(listener).toHaveBeenCalledWith(
      expect.objectContaining({ key: ERROR_LOG_KEY })
    );
  });

  it("works without a source field", () => {
    const entry = addError({ message: "No source" });
    expect(entry.source).toBeUndefined();
    expect(getErrors()[0].message).toBe("No source");
  });

  it("caps stored entries at 100", () => {
    for (let i = 0; i < 110; i++) {
      addError({ message: `Error ${i}` });
    }
    const errors = getErrors();
    expect(errors.length).toBe(100);
  });

  it("getErrors returns empty array when localStorage is empty", () => {
    expect(getErrors()).toEqual([]);
  });
});
