/**
 * The Gong/Zoom toggle and its "prefer Gong" default.
 *
 * Both meeting-summary panels (the shared component and the diverged local copy in
 * AccountDetailPage) render this control, so its behaviour is pinned once here.
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import {
  MeetingSummarySourceToggle,
  preferredMeetingSource,
} from "../MeetingSummarySourceToggle";

describe("preferredMeetingSource", () => {
  it("prefers Gong when both providers have notes", () => {
    expect(preferredMeetingSource("gong recap", "zoom recap")).toBe("gong");
  });

  it("prefers Gong when only Gong has notes", () => {
    expect(preferredMeetingSource("gong recap", "")).toBe("gong");
  });

  it("falls back to Zoom when only Zoom has notes", () => {
    expect(preferredMeetingSource("", "zoom recap")).toBe("zoom");
  });

  it("lands on Gong when neither has notes so the paste box writes the primary field", () => {
    expect(preferredMeetingSource("", "")).toBe("gong");
    expect(preferredMeetingSource(undefined, undefined)).toBe("gong");
  });

  it("treats whitespace-only notes as empty", () => {
    expect(preferredMeetingSource("   \n  ", "zoom recap")).toBe("zoom");
  });
});

describe("MeetingSummarySourceToggle", () => {
  function setup(props: Partial<React.ComponentProps<typeof MeetingSummarySourceToggle>> = {}) {
    const onChange = vi.fn();
    render(
      <MeetingSummarySourceToggle
        value="gong"
        onChange={onChange}
        hasGong
        hasZoom={false}
        {...props}
      />
    );
    return { onChange };
  }

  it("renders both providers", () => {
    setup();
    expect(screen.getByRole("button", { name: "Gong" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Zoom" })).toBeInTheDocument();
  });

  it("marks the active provider as pressed", () => {
    setup({ value: "zoom" });
    expect(screen.getByRole("button", { name: "Zoom" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Gong" })).toHaveAttribute("aria-pressed", "false");
  });

  it("reports which providers actually hold notes", () => {
    setup({ hasGong: true, hasZoom: false });
    expect(screen.getByRole("button", { name: "Gong" })).toHaveAttribute("data-populated", "true");
    expect(screen.getByRole("button", { name: "Zoom" })).toHaveAttribute("data-populated", "false");
  });

  it("calls onChange with the clicked provider", async () => {
    const { onChange } = setup();
    await userEvent.click(screen.getByRole("button", { name: "Zoom" }));
    expect(onChange).toHaveBeenCalledWith("zoom");
  });

  it("keeps an empty provider clickable so a first recap can be pasted into it", async () => {
    const { onChange } = setup({ hasZoom: false });
    const zoom = screen.getByRole("button", { name: "Zoom" });
    expect(zoom).not.toBeDisabled();
    await userEvent.click(zoom);
    expect(onChange).toHaveBeenCalledWith("zoom");
  });

  it("explains an empty provider in its title", () => {
    setup({ hasZoom: false });
    expect(screen.getByRole("button", { name: "Zoom" })).toHaveAttribute(
      "title", "No Zoom notes yet"
    );
  });
});
