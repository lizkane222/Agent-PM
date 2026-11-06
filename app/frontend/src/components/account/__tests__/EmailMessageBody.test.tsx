import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { EmailMessageBody } from "../EmailMessageBody";

describe("EmailMessageBody", () => {
  it("renders links safely in a new tab and shows the sender header", () => {
    render(<EmailMessageBody from='"Jane" <j@x.com>' date="2026-11-03T10:00:00Z" body="Docs at https://x.com/a." threadSubject="T" />);
    const a = screen.getByRole("link", { name: "https://x.com/a" });
    expect(a).toHaveAttribute("target", "_blank");
    expect(a.getAttribute("rel")).toContain("noopener");
    expect(screen.getByText("Jane")).toBeInTheDocument();
  });
  it("never injects HTML from the body", () => {
    const { container } = render(<EmailMessageBody from="a" date="" body={'<p>hi</p><img src=x onerror="window.__x=1"><script>window.__x=1</script>'} />);
    expect(container.querySelector("img,script")).toBeNull();
    expect((window as unknown as { __x?: number }).__x).toBeUndefined();
  });
  it("collapses quoted text behind a toggle", () => {
    render(<EmailMessageBody from="a" date="" body={"New reply\n\nOn Mon, Jane wrote:\n> old stuff here"} />);
    expect(screen.queryByTestId("quoted-text")).toBeNull();
    fireEvent.click(screen.getByText("Show quoted text"));
    expect(screen.getByTestId("quoted-text")).toHaveTextContent("old stuff here");
    fireEvent.click(screen.getByText("Hide quoted text"));
    expect(screen.queryByTestId("quoted-text")).toBeNull();
  });
  it("shows a message subject only when it differs from the thread", () => {
    const { rerender } = render(<EmailMessageBody from="a" date="" subject="Same" threadSubject="Same" body="x" />);
    expect(screen.queryByText("Same")).toBeNull();
    rerender(<EmailMessageBody from="a" date="" subject="Other" threadSubject="Same" body="x" />);
    expect(screen.getByText("Other")).toBeInTheDocument();
  });
});
