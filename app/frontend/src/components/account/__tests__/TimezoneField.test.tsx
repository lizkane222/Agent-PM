import { useState } from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import TimezoneField, { ContactLocalTime } from "../TimezoneField";

function Harness({ initial = "", spy }: { initial?: string; spy?: (z: string) => void }) {
  const [v, setV] = useState(initial);
  return <TimezoneField value={v} onChange={(z) => { setV(z); spy?.(z); }} />;
}

describe("TimezoneField", () => {
  it("suggests while typing and stores the clicked zone", () => {
    const spy = vi.fn();
    render(<Harness spy={spy} />);
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "chic" } });
    fireEvent.click(screen.getByRole("button", { name: /America\/Chicago/ }));
    expect(spy).toHaveBeenCalledWith("America/Chicago");
    expect(screen.getByTestId("timezone-resolved").textContent).toMatch(/^America\/Chicago · C[SD]T \(UTC-[56]\) · /);
  });

  it("Enter resolves an unambiguous input (state) and offers the other zone", () => {
    const spy = vi.fn();
    render(<Harness spy={spy} />);
    const input = screen.getByRole("combobox");
    fireEvent.change(input, { target: { value: "Texas" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(spy).toHaveBeenCalledWith("America/Chicago");
    expect(screen.getByTestId("timezone-alternatives").textContent).toContain("Other zone in this state");
    fireEvent.click(screen.getByRole("button", { name: /El Paso/ }));
    expect(spy).toHaveBeenLastCalledWith("America/Denver");
  });

  it("does not guess for a multi-zone country; shows a chooser instead", () => {
    const spy = vi.fn();
    render(<Harness spy={spy} />);
    const input = screen.getByRole("combobox");
    fireEvent.change(input, { target: { value: "Brazil" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(spy).not.toHaveBeenCalled();
    expect(screen.getAllByRole("option").length).toBeGreaterThan(1);
  });

  it("accepts an abbreviation and can be cleared", () => {
    const spy = vi.fn();
    render(<Harness spy={spy} />);
    const input = screen.getByRole("combobox");
    fireEvent.change(input, { target: { value: "PST" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(spy).toHaveBeenCalledWith("America/Los_Angeles");
    fireEvent.click(screen.getByRole("button", { name: "Clear" }));
    expect(spy).toHaveBeenLastCalledWith("");
    expect(screen.queryByTestId("timezone-resolved")).not.toBeInTheDocument();
  });

  it("shows an existing value with its local time", () => {
    render(<Harness initial="Asia/Kolkata" />);
    expect(screen.getByTestId("timezone-resolved").textContent).toMatch(/^Asia\/Kolkata · IST \(UTC\+5:30\) · /);
  });
});

describe("ContactLocalTime", () => {
  it("renders the contact's local time, nothing without a zone", () => {
    const { rerender, container } = render(<ContactLocalTime zone="Asia/Tokyo" />);
    expect(screen.getByTestId("contact-local-time").textContent).toMatch(/\d{1,2}:\d{2} (AM|PM) /);
    rerender(<ContactLocalTime zone="" />);
    expect(container.textContent).toBe("");
    rerender(<ContactLocalTime zone="Nope/Nowhere" />);
    expect(container.textContent).toBe("");
  });
});
