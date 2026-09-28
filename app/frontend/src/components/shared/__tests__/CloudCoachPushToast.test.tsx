import { render, screen, fireEvent, act } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import CloudCoachPushToast from "../CloudCoachPushToast";
import { mockCloudCoachPush } from "../../../test/handlers/salesforce";

describe("CloudCoachPushToast", () => {
  it("renders nothing when there are no results", () => {
    const { container } = render(<CloudCoachPushToast results={[]} onClose={() => {}} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("renders nothing for null", () => {
    const { container } = render(<CloudCoachPushToast results={null} onClose={() => {}} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("reports a success with the server's own wording", () => {
    render(
      <CloudCoachPushToast
        results={[mockCloudCoachPush({ message: "Jane Doe added to Acme Rollout in Cloud Coach." })]}
        onClose={() => {}}
      />
    );
    expect(screen.getByText("Jane Doe added to Acme Rollout in Cloud Coach.")).toBeTruthy();
    expect(screen.getByTestId("cloud-coach-toast")).toHaveAttribute("data-tone", "ok");
  });

  it("treats already-a-member as a success", () => {
    render(
      <CloudCoachPushToast
        results={[mockCloudCoachPush({ status: "already_member", message: "Already on it." })]}
        onClose={() => {}}
      />
    );
    expect(screen.getByTestId("cloud-coach-toast")).toHaveAttribute("data-tone", "ok");
  });

  it("warns when a role slot could not be found", () => {
    render(
      <CloudCoachPushToast
        results={[mockCloudCoachPush({
          status: "no_free_slot",
          message: "Every project role on Acme Rollout is already filled.",
        })]}
        onClose={() => {}}
      />
    );
    expect(screen.getByTestId("cloud-coach-toast")).toHaveAttribute("data-tone", "warn");
    expect(screen.getByText(/already filled/)).toBeTruthy();
  });

  it("warns when any one of a batch failed", () => {
    // A single failure among successes still needs to read as needing attention.
    render(
      <CloudCoachPushToast
        results={[
          mockCloudCoachPush({ status: "pushed", message: "Jane added." }),
          mockCloudCoachPush({ status: "error", message: "Bob could not be added." }),
        ]}
        onClose={() => {}}
      />
    );
    expect(screen.getByTestId("cloud-coach-toast")).toHaveAttribute("data-tone", "warn");
    expect(screen.getByText("1 added to Cloud Coach, 1 could not be added.")).toBeTruthy();
    // The per-member detail is listed so it is clear *who* failed.
    expect(screen.getByText("Bob could not be added.")).toBeTruthy();
  });

  it("omits the per-member list for a single result", () => {
    render(
      <CloudCoachPushToast
        results={[mockCloudCoachPush({ message: "Only one." })]}
        onClose={() => {}}
      />
    );
    expect(screen.queryByRole("list")).toBeNull();
  });

  it("is announced to assistive tech", () => {
    render(<CloudCoachPushToast results={[mockCloudCoachPush()]} onClose={() => {}} />);
    const toast = screen.getByRole("status");
    expect(toast).toHaveAttribute("aria-live", "polite");
  });

  it("closes on the dismiss button", () => {
    const onClose = vi.fn();
    render(<CloudCoachPushToast results={[mockCloudCoachPush()]} onClose={onClose} />);
    fireEvent.click(screen.getByLabelText("Dismiss"));
    expect(onClose).toHaveBeenCalled();
  });

  describe("auto-dismiss", () => {
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());

    it("closes itself after the timeout", () => {
      const onClose = vi.fn();
      render(
        <CloudCoachPushToast
          results={[mockCloudCoachPush()]}
          onClose={onClose}
          autoDismissMs={4000}
        />
      );
      expect(onClose).not.toHaveBeenCalled();
      act(() => void vi.advanceTimersByTime(4000));
      expect(onClose).toHaveBeenCalledTimes(1);
    });

    it("pauses while hovered, so a multi-member list can be read", () => {
      const onClose = vi.fn();
      render(
        <CloudCoachPushToast
          results={[mockCloudCoachPush()]}
          onClose={onClose}
          autoDismissMs={4000}
        />
      );
      fireEvent.mouseEnter(screen.getByRole("status"));
      act(() => void vi.advanceTimersByTime(10_000));
      expect(onClose).not.toHaveBeenCalled();

      fireEvent.mouseLeave(screen.getByRole("status"));
      act(() => void vi.advanceTimersByTime(4000));
      expect(onClose).toHaveBeenCalledTimes(1);
    });

    it("never auto-closes when disabled", () => {
      const onClose = vi.fn();
      render(
        <CloudCoachPushToast
          results={[mockCloudCoachPush()]}
          onClose={onClose}
          autoDismissMs={0}
        />
      );
      act(() => void vi.advanceTimersByTime(60_000));
      expect(onClose).not.toHaveBeenCalled();
    });
  });
});
