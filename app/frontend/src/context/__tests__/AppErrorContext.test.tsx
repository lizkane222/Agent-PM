import { render, screen, fireEvent, act } from "@testing-library/react";
import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { AppErrorProvider, useAppError } from "../AppErrorContext";
import { getErrors } from "../../lib/errorLog";

function Trigger({ message, source }: { message: string; source?: string }) {
  const { reportError } = useAppError();
  return <button onClick={() => reportError(message, source)}>Report</button>;
}

describe("AppErrorContext", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("reportError shows a banner with the error message", () => {
    render(
      <AppErrorProvider>
        <Trigger message="Something broke" />
      </AppErrorProvider>
    );
    fireEvent.click(screen.getByText("Report"));
    expect(screen.getByRole("alert")).toBeInTheDocument();
    expect(screen.getByText("Something broke")).toBeInTheDocument();
  });

  it("banner shows source badge when source is provided", () => {
    render(
      <AppErrorProvider>
        <Trigger message="Fetch failed" source="comments" />
      </AppErrorProvider>
    );
    fireEvent.click(screen.getByText("Report"));
    expect(screen.getByText("comments")).toBeInTheDocument();
  });

  it("dismiss button removes the banner immediately", () => {
    render(
      <AppErrorProvider>
        <Trigger message="Dismiss me" />
      </AppErrorProvider>
    );
    fireEvent.click(screen.getByText("Report"));
    expect(screen.getByRole("alert")).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText("Dismiss error"));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("banner auto-dismisses after 5 seconds", () => {
    vi.useFakeTimers();
    render(
      <AppErrorProvider>
        <Trigger message="Auto dismiss" />
      </AppErrorProvider>
    );
    fireEvent.click(screen.getByText("Report"));
    expect(screen.getByRole("alert")).toBeInTheDocument();
    act(() => {
      vi.advanceTimersByTime(5001);
    });
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("banner is still visible just before the 5-second threshold", () => {
    vi.useFakeTimers();
    render(
      <AppErrorProvider>
        <Trigger message="Still visible" />
      </AppErrorProvider>
    );
    fireEvent.click(screen.getByText("Report"));
    act(() => {
      vi.advanceTimersByTime(4999);
    });
    expect(screen.getByRole("alert")).toBeInTheDocument();
  });

  it("reportError persists the error to errorLog", () => {
    render(
      <AppErrorProvider>
        <Trigger message="Persisted" source="hooks" />
      </AppErrorProvider>
    );
    fireEvent.click(screen.getByText("Report"));
    const errors = getErrors();
    expect(errors[0].message).toBe("Persisted");
    expect(errors[0].source).toBe("hooks");
  });

  it("multiple errors stack as separate banners", () => {
    function MultiTrigger() {
      const { reportError } = useAppError();
      return (
        <>
          <button onClick={() => reportError("Error A")}>A</button>
          <button onClick={() => reportError("Error B")}>B</button>
        </>
      );
    }
    render(
      <AppErrorProvider>
        <MultiTrigger />
      </AppErrorProvider>
    );
    fireEvent.click(screen.getByText("A"));
    fireEvent.click(screen.getByText("B"));
    const banners = screen.getAllByRole("alert");
    expect(banners).toHaveLength(2);
    expect(screen.getByText("Error A")).toBeInTheDocument();
    expect(screen.getByText("Error B")).toBeInTheDocument();
  });
});
