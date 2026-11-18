import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { useState } from "react";
import TagPicker from "../TagPicker";

const OPTIONS = [{ name: "sms", count: 3 }, { name: "Python", count: 2 }, { name: "go", count: 1 }];

function Harness({ initial = [] as string[], onChange = vi.fn() }) {
  const [v, setV] = useState(initial);
  return <TagPicker value={v} options={OPTIONS} onChange={(t) => { setV(t); onChange(t); }} />;
}

describe("TagPicker", () => {
  it("lists existing tags and toggles them, highlighting selected ones", () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    const sms = screen.getByRole("button", { name: /^sms/ });
    expect(sms).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(sms);
    expect(onChange).toHaveBeenLastCalledWith(["sms"]);
    expect(screen.getByRole("button", { name: /^sms/ })).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(screen.getByRole("button", { name: /^sms/ }));
    expect(onChange).toHaveBeenLastCalledWith([]);
  });

  it("searches the existing tags", () => {
    render(<Harness />);
    fireEvent.change(screen.getByPlaceholderText(/search tags/i), { target: { value: "py" } });
    expect(screen.getByRole("button", { name: /^Python/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^sms/ })).toBeNull();
  });

  it("creates a new tag on Enter, trimmed", () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    const input = screen.getByPlaceholderText(/search tags/i);
    fireEvent.change(input, { target: { value: "  brand   new " } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onChange).toHaveBeenLastCalledWith(["brand new"]);
  });

  it("typing an existing tag in a different case selects the existing one, no duplicate", () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    const input = screen.getByPlaceholderText(/search tags/i);
    fireEvent.change(input, { target: { value: "SMS" } });
    expect(screen.queryByRole("button", { name: /Create/ })).toBeNull();
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onChange).toHaveBeenLastCalledWith(["sms"]);
  });

  it("refuses tags over 30 characters and more than 10 per item", () => {
    const onChange = vi.fn();
    const { rerender } = render(<TagPicker value={[]} options={[]} onChange={onChange} />);
    const input = screen.getByPlaceholderText(/search tags/i);
    fireEvent.change(input, { target: { value: "x".repeat(31) } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByText(/at most 30/i)).toBeInTheDocument();

    const ten = Array.from({ length: 10 }, (_, i) => `t${i}`);
    rerender(<TagPicker value={ten} options={[]} onChange={onChange} />);
    fireEvent.change(screen.getByPlaceholderText(/search tags/i), { target: { value: "eleventh" } });
    fireEvent.keyDown(screen.getByPlaceholderText(/search tags/i), { key: "Enter" });
    expect(onChange).not.toHaveBeenCalled();
  });
});
