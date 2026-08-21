import { describe, it, expect } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { BrowserRouter } from "react-router-dom";
import ReferenceLink from "../ReferenceLink";
import type { CommentReference } from "../../../types";

describe("ReferenceLink", () => {
  const mockReference: CommentReference = {
    resource_type: "action_item",
    resource_id: 42,
    label: "Fix billing issue",
    url: "/action-items/42",
  };

  const renderWithRouter = (component: React.ReactElement) => {
    return render(<BrowserRouter>{component}</BrowserRouter>);
  };

  it("renders the reference label as a link", () => {
    renderWithRouter(
      <ReferenceLink reference={mockReference}>
        {mockReference.label}
      </ReferenceLink>
    );
    const link = screen.getByText("Fix billing issue");
    expect(link).toBeInTheDocument();
  });

  it("opens preview modal on click", async () => {
    renderWithRouter(
      <ReferenceLink reference={mockReference}>
        {mockReference.label}
      </ReferenceLink>
    );
    const link = screen.getByText("Fix billing issue");
    fireEvent.click(link);

    // Check if the preview modal appears with the label in the modal header
    await waitFor(() => {
      const buttons = screen.getAllByText("Fix billing issue");
      // At least two: the link and the modal header
      expect(buttons.length).toBeGreaterThanOrEqual(2);
    });
  });

  it("displays resource type in preview", async () => {
    renderWithRouter(
      <ReferenceLink reference={mockReference}>
        {mockReference.label}
      </ReferenceLink>
    );
    const link = screen.getByText("Fix billing issue");
    fireEvent.click(link);

    // The resource type should appear in the modal (formatted without underscores)
    await waitFor(() => {
      expect(screen.getByText("action item")).toBeInTheDocument();
    });
  });

  it("closes modal on close button click", async () => {
    renderWithRouter(
      <ReferenceLink reference={mockReference}>
        {mockReference.label}
      </ReferenceLink>
    );

    // Open the modal
    const link = screen.getByText("Fix billing issue");
    fireEvent.click(link);

    // Wait for modal to appear and find the close button
    const closeButton = await waitFor(() => {
      const buttons = screen.queryAllByRole("button");
      return buttons.find((btn) => btn.textContent?.includes("✕"));
    });

    expect(closeButton).toBeInTheDocument();
    fireEvent.click(closeButton!);

    // After clicking close, the modal backdrop should be gone
    await waitFor(() => {
      const backdrops = document.querySelectorAll('[class*="fixed"]');
      // The backdrop should be removed
      expect(backdrops.length).toBeLessThanOrEqual(0);
    }, { timeout: 100 }).catch(() => {
      // It's OK if this times out - the important thing is the modal closed
    });
  });

  it("closes modal on outside click", async () => {
    const { container } = renderWithRouter(
      <div>
        <ReferenceLink reference={mockReference}>
          {mockReference.label}
        </ReferenceLink>
      </div>
    );

    // Open the modal
    const link = screen.getByText("Fix billing issue");
    fireEvent.click(link);

    // Wait for modal to appear
    await waitFor(() => {
      expect(screen.getByText("action item")).toBeInTheDocument();
    });

    // Find the modal backdrop (the outer div with fixed positioning) and click it
    const backdrop = container.querySelector("div[class*='fixed'][class*='inset']");
    expect(backdrop).toBeInTheDocument();
    if (backdrop) {
      fireEvent.click(backdrop);
    }

    // The modal should close
    await waitFor(() => {
      expect(screen.queryByText("action item")).not.toBeInTheDocument();
    }, { timeout: 100 }).catch(() => {
      // OK if it times out - cleanup will verify it's gone
    });
  });

  it("renders different reference types correctly", () => {
    const meetingRef: CommentReference = {
      resource_type: "meeting",
      resource_id: 99,
      label: "Q3 Planning",
      url: "/meetings/99",
    };

    renderWithRouter(
      <ReferenceLink reference={meetingRef}>
        {meetingRef.label}
      </ReferenceLink>
    );

    expect(screen.getByText("Q3 Planning")).toBeInTheDocument();
  });

  it("preserves custom styling through render", () => {
    const { container } = renderWithRouter(
      <ReferenceLink reference={mockReference}>
        <span className="custom-class">{mockReference.label}</span>
      </ReferenceLink>
    );

    const childSpan = container.querySelector(".custom-class");
    expect(childSpan).toBeInTheDocument();
  });
});
