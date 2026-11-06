import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import MeetingNotesToast from "../MeetingNotesToast";

const n = { id: 1, title: "Gong notes added to Siemens Call", metadata: { account_name: "Siemens" } };

describe("MeetingNotesToast", () => {
  it("renders nothing when empty", () => {
    const { container } = render(<MeetingNotesToast notifications={[]} onDismiss={() => {}} />);
    expect(container).toBeEmptyDOMElement();
  });
  it("shows the title and account, and dismisses", () => {
    const onDismiss = vi.fn();
    render(<MeetingNotesToast notifications={[n]} onDismiss={onDismiss} />);
    expect(screen.getByText(/Gong notes added to Siemens Call/)).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText("Dismiss notification"));
    expect(onDismiss).toHaveBeenCalledWith(1);
  });
});
