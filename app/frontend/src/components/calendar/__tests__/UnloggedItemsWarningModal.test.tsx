import { render, screen, fireEvent, act } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import UnloggedItemsWarningModal from "../UnloggedItemsWarningModal";
import {
  mockPlannedEntry,
  mockSkippedEvent,
  weekPlanReport,
} from "../../../test/handlers/salesforce";

describe("UnloggedItemsWarningModal", () => {
  it("renders nothing for a clean week", () => {
    // The happy path must stay silent — a modal on every successful Log Week would be
    // noise, and every pre-existing CalendarPage test's DOM depends on this.
    const { container } = render(
      <UnloggedItemsWarningModal report={weekPlanReport()} onClose={() => {}} />
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("renders nothing for a null report", () => {
    const { container } = render(
      <UnloggedItemsWarningModal report={null} onClose={() => {}} />
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("names the count and the titles of unlinked items", () => {
    render(
      <UnloggedItemsWarningModal
        report={weekPlanReport({
          unlinked_events: [
            mockSkippedEvent({ event_id: 1, title: "Mystery sync" }),
            mockSkippedEvent({ event_id: 2, title: "Coffee chat" }),
          ],
        })}
        onClose={() => {}}
      />
    );
    const row = screen.getByTestId("warning-unlinked");
    expect(row).toHaveTextContent("2 calendar items not linked to an account");
    expect(row).toHaveTextContent("Mystery sync");
    expect(row).toHaveTextContent("Coffee chat");
  });

  it("uses the singular noun for one item", () => {
    render(
      <UnloggedItemsWarningModal
        report={weekPlanReport({ unlinked_events: [mockSkippedEvent()] })}
        onClose={() => {}}
      />
    );
    expect(screen.getByTestId("warning-unlinked")).toHaveTextContent("1 calendar item not linked");
  });

  it("reports did-not-attend items separately", () => {
    render(
      <UnloggedItemsWarningModal
        report={weekPlanReport({
          not_attended_events: [
            mockSkippedEvent({ title: "Skipped standup", reason: "did_not_attend" }),
          ],
        })}
        onClose={() => {}}
      />
    );
    expect(screen.getByTestId("warning-not_attended")).toHaveTextContent("marked did not attend");
    expect(screen.queryByTestId("warning-unlinked")).toBeNull();
  });

  it("collapses a long list into a +N more suffix", () => {
    render(
      <UnloggedItemsWarningModal
        report={weekPlanReport({
          unlinked_events: Array.from({ length: 7 }, (_, i) =>
            mockSkippedEvent({ event_id: i, title: `Event ${i}` })
          ),
        })}
        onClose={() => {}}
      />
    );
    const row = screen.getByTestId("warning-unlinked");
    expect(row).toHaveTextContent("Event 0");
    expect(row).toHaveTextContent("+3 more");
    expect(row).not.toHaveTextContent("Event 6");
  });

  it("shows the no-project line only when that count is non-zero", () => {
    const { rerender } = render(
      <UnloggedItemsWarningModal
        report={weekPlanReport({ unlinked_events: [mockSkippedEvent()] })}
        onClose={() => {}}
      />
    );
    expect(screen.queryByTestId("warning-no_project")).toBeNull();

    rerender(
      <UnloggedItemsWarningModal
        report={weekPlanReport({
          account_without_project: [
            mockSkippedEvent({ reason: "no_cloud_coach_project", account_name: "Acme" }),
          ],
        })}
        onClose={() => {}}
      />
    );
    expect(screen.getByTestId("warning-no_project")).toHaveTextContent(
      "no Cloud Coach project"
    );
  });

  it("reports how much did land alongside what did not", () => {
    render(
      <UnloggedItemsWarningModal
        report={weekPlanReport({
          entries: [mockPlannedEntry({ minutes: 90, hours: 1.5 })],
          unlinked_events: [mockSkippedEvent()],
        })}
        onClose={() => {}}
      />
    );
    expect(screen.getByText(/1\.5 hrs logged to Cloud Coach across 1 entry/)).toBeTruthy();
  });

  it("says nothing was logged when the week wrote nothing", () => {
    render(
      <UnloggedItemsWarningModal
        report={weekPlanReport({ unlinked_events: [mockSkippedEvent()] })}
        onClose={() => {}}
      />
    );
    expect(screen.getByText("Nothing was logged to Cloud Coach.")).toBeTruthy();
  });

  it("surfaces already-logged and skipped-field notes", () => {
    render(
      <UnloggedItemsWarningModal
        report={weekPlanReport({
          unlinked_events: [mockSkippedEvent()],
          already_logged_count: 2,
          fields_skipped: ["Resource__c"],
        })}
        onClose={() => {}}
      />
    );
    expect(screen.getByTestId("warning-already-logged")).toHaveTextContent("2 already logged");
    expect(screen.getByTestId("warning-fields-skipped")).toHaveTextContent("Resource__c");
  });

  describe("dismissal", () => {
    const report = weekPlanReport({ unlinked_events: [mockSkippedEvent()] });

    it("closes on the ✕ button", () => {
      const onClose = vi.fn();
      render(<UnloggedItemsWarningModal report={report} onClose={onClose} />);
      fireEvent.click(screen.getByLabelText("Dismiss"));
      expect(onClose).toHaveBeenCalled();
    });

    it("closes on the Got it button", () => {
      const onClose = vi.fn();
      render(<UnloggedItemsWarningModal report={report} onClose={onClose} />);
      fireEvent.click(screen.getByText("Got it"));
      expect(onClose).toHaveBeenCalled();
    });

    it("closes on a backdrop click", () => {
      const onClose = vi.fn();
      render(<UnloggedItemsWarningModal report={report} onClose={onClose} />);
      fireEvent.click(screen.getByTestId("unlogged-warning-backdrop"));
      expect(onClose).toHaveBeenCalled();
    });

    it("does not close on a click inside the panel", () => {
      const onClose = vi.fn();
      render(<UnloggedItemsWarningModal report={report} onClose={onClose} />);
      fireEvent.click(screen.getByRole("alertdialog"));
      expect(onClose).not.toHaveBeenCalled();
    });

    it("closes on Escape", () => {
      const onClose = vi.fn();
      render(<UnloggedItemsWarningModal report={report} onClose={onClose} />);
      fireEvent.keyDown(window, { key: "Escape" });
      expect(onClose).toHaveBeenCalled();
    });
  });

  describe("auto-dismiss", () => {
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());

    const report = weekPlanReport({ unlinked_events: [mockSkippedEvent()] });

    it("closes itself after the timeout", () => {
      const onClose = vi.fn();
      render(
        <UnloggedItemsWarningModal report={report} onClose={onClose} autoDismissMs={5000} />
      );
      expect(onClose).not.toHaveBeenCalled();
      act(() => void vi.advanceTimersByTime(5000));
      expect(onClose).toHaveBeenCalledTimes(1);
    });

    it("pauses while the pointer is over it, so a long list can be read", () => {
      const onClose = vi.fn();
      render(
        <UnloggedItemsWarningModal report={report} onClose={onClose} autoDismissMs={5000} />
      );
      fireEvent.mouseEnter(screen.getByRole("alertdialog"));
      act(() => void vi.advanceTimersByTime(10_000));
      expect(onClose).not.toHaveBeenCalled();

      fireEvent.mouseLeave(screen.getByRole("alertdialog"));
      act(() => void vi.advanceTimersByTime(5000));
      expect(onClose).toHaveBeenCalledTimes(1);
    });

    it("never auto-closes when the timeout is disabled", () => {
      const onClose = vi.fn();
      render(
        <UnloggedItemsWarningModal report={report} onClose={onClose} autoDismissMs={0} />
      );
      act(() => void vi.advanceTimersByTime(60_000));
      expect(onClose).not.toHaveBeenCalled();
    });
  });
});
