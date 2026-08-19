import { render, screen, fireEvent, within } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import EventColorsPopover from "../EventColorsPopover";
import {
  ALL_SWATCHES,
  DEFAULT_CATEGORY_COLORS,
  EVENT_TYPE_META,
  PALETTES,
  type ColorableEventType,
} from "../../../lib/eventColors";

function renderPopover(overrides: Partial<Parameters<typeof EventColorsPopover>[0]> = {}) {
  const props = {
    colorFor: (type: ColorableEventType) => DEFAULT_CATEGORY_COLORS[type],
    onSelect: vi.fn(),
    onReset: vi.fn(),
    onClose: vi.fn(),
    ...overrides,
  };
  render(<EventColorsPopover {...props} />);
  return props;
}

describe("EventColorsPopover", () => {
  it("renders one row per colorable event type", () => {
    renderPopover();
    for (const { id, label } of EVENT_TYPE_META) {
      const row = screen.getByTestId(`color-row-${id}`);
      expect(row).toHaveTextContent(label);
    }
  });

  it("shows each type name on its current color", () => {
    renderPopover();
    for (const { id } of EVENT_TYPE_META) {
      expect(screen.getByTestId(`color-row-${id}`)).toHaveAttribute(
        "data-color",
        DEFAULT_CATEGORY_COLORS[id],
      );
    }
  });

  it("keeps the swatch grid closed until a row is clicked", () => {
    renderPopover();
    expect(screen.queryByText("Bubblegum")).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId("color-row-task"));
    expect(screen.getByText("Bubblegum")).toBeInTheDocument();
  });

  it("groups all 20 swatches under the four palette headings", () => {
    renderPopover();
    fireEvent.click(screen.getByTestId("color-row-meeting"));
    for (const palette of PALETTES) {
      expect(screen.getByText(palette.name)).toBeInTheDocument();
    }
    for (const swatch of ALL_SWATCHES) {
      expect(screen.getByTestId(`swatch-meeting-${swatch}`)).toBeInTheDocument();
    }
  });

  it("reports the chosen type and color, then collapses the grid", () => {
    const { onSelect } = renderPopover();
    fireEvent.click(screen.getByTestId("color-row-focus_time"));
    fireEvent.click(screen.getByTestId("swatch-focus_time-#842D78"));

    expect(onSelect).toHaveBeenCalledWith("focus_time", "#842D78");
    expect(screen.queryByText("Ocean")).not.toBeInTheDocument();
  });

  it("lets a color from any palette be applied to any type", () => {
    const { onSelect } = renderPopover();
    fireEvent.click(screen.getByTestId("color-row-appointment"));
    // An Ocean swatch on a type whose default came from Purple Pastel.
    fireEvent.click(screen.getByTestId("swatch-appointment-#5F97AA"));
    expect(onSelect).toHaveBeenCalledWith("appointment", "#5F97AA");
  });

  it("opens one row at a time", () => {
    renderPopover();
    fireEvent.click(screen.getByTestId("color-row-task"));
    expect(screen.getByTestId("color-row-task")).toHaveAttribute("aria-expanded", "true");
    fireEvent.click(screen.getByTestId("color-row-meeting"));
    expect(screen.getByTestId("color-row-task")).toHaveAttribute("aria-expanded", "false");
    expect(screen.getByTestId("color-row-meeting")).toHaveAttribute("aria-expanded", "true");
  });

  it("marks the current color as selected in the grid", () => {
    renderPopover();
    fireEvent.click(screen.getByTestId("color-row-task"));
    const current = screen.getByTestId(`swatch-task-${DEFAULT_CATEGORY_COLORS.task}`);
    expect(current.className).toContain("ring-2");
  });

  it("reflects a chosen color that is not the default", () => {
    renderPopover({ colorFor: () => "#E5A836" });
    expect(screen.getByTestId("color-row-meeting")).toHaveAttribute("data-color", "#E5A836");
  });

  it("surfaces a save failure", () => {
    renderPopover({ error: "Could not save that color. Please try again." });
    expect(screen.getByRole("alert")).toHaveTextContent("Could not save that color");
  });

  it("exposes a reset control", () => {
    const { onReset } = renderPopover();
    fireEvent.click(screen.getByRole("button", { name: "Reset" }));
    expect(onReset).toHaveBeenCalled();
  });

  it("closes on Escape and on an outside click", () => {
    const { onClose } = renderPopover();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
    fireEvent.mouseDown(document.body);
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it("does not close when clicking inside the panel", () => {
    const { onClose } = renderPopover();
    fireEvent.mouseDown(within(screen.getByRole("dialog")).getByText("Event colors"));
    expect(onClose).not.toHaveBeenCalled();
  });

  it("offers Reminder, which has no event_category of its own", () => {
    renderPopover();
    const row = screen.getByTestId("color-row-reminder");
    expect(row).toHaveTextContent("Reminder");
    expect(row).toHaveAttribute("data-color", DEFAULT_CATEGORY_COLORS.reminder);
  });

  it("ignores a mousedown on the trigger named by ignoreSelector", () => {
    // The trigger lives outside the panel (a FullCalendar toolbar button), so without
    // this the mousedown closes the panel and the trigger's click reopens it.
    const trigger = document.createElement("button");
    trigger.className = "trigger-btn";
    document.body.appendChild(trigger);
    try {
      const { onClose } = renderPopover({ ignoreSelector: ".trigger-btn" });
      fireEvent.mouseDown(trigger);
      expect(onClose).not.toHaveBeenCalled();
      // Anything else outside still dismisses.
      fireEvent.mouseDown(document.body);
      expect(onClose).toHaveBeenCalledTimes(1);
    } finally {
      trigger.remove();
    }
  });
});
