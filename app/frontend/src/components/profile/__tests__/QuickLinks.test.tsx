import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import QuickLinks from "../QuickLinks";
import { QUICK_LINKS_KEY, reloadQuickLinks, MAX_QUICK_LINKS } from "../../../hooks/useQuickLinks";

beforeEach(() => {
  localStorage.clear();
  reloadQuickLinks();
});

const input = () => screen.getByLabelText("Add a quick link") as HTMLInputElement;
const type = (v: string) => fireEvent.change(input(), { target: { value: v } });

describe("QuickLinks", () => {
  it("starts with just the input", () => {
    render(<QuickLinks accent="#000" />);
    expect(input()).toBeInTheDocument();
    expect(screen.queryByRole("link")).toBeNull();
  });

  it("adds a link on Enter, shows it as a new-tab link, and clears the input", () => {
    render(<QuickLinks accent="#000" />);
    type("lucid.app/documents");
    fireEvent.keyDown(input(), { key: "Enter" });
    const link = screen.getByRole("link", { name: /lucid\.app/ });
    expect(link.getAttribute("href")).toBe("https://lucid.app/documents");
    expect(link.getAttribute("target")).toBe("_blank");
    expect(link.getAttribute("rel")).toContain("noopener");
    expect(input().value).toBe("");
  });

  it("adds a link with the Add button, which is disabled until something is typed", () => {
    render(<QuickLinks accent="#000" />);
    const add = screen.getByRole("button", { name: "Add quick link" }) as HTMLButtonElement;
    expect(add.disabled).toBe(true);
    type("example.com");
    expect(add.disabled).toBe(false);
    fireEvent.click(add);
    expect(screen.getByRole("link", { name: /example\.com/ })).toBeInTheDocument();
  });

  it("takes the icon from the link: a known service's icon, else the site's favicon", () => {
    render(<QuickLinks accent="#000" />);
    type("https://docs.google.com/spreadsheets/d/1"); fireEvent.keyDown(input(), { key: "Enter" });
    type("https://some-small-site.example.org/page"); fireEvent.keyDown(input(), { key: "Enter" });
    const imgs = screen.getAllByRole("img");
    expect(imgs[0].getAttribute("src")).toContain("gstatic.com");             // Google Sheets product icon
    expect(imgs[1].getAttribute("src")).toContain("favicons");                // the site's own favicon
    expect(imgs[1].getAttribute("src")).toContain("some-small-site.example.org");
  });

  it.each(["javascript:alert(1)", "not a link", "foo"])("rejects %j with a message and adds nothing", (bad) => {
    render(<QuickLinks accent="#000" />);
    type(bad);
    fireEvent.keyDown(input(), { key: "Enter" });
    expect(screen.getByRole("alert")).toHaveTextContent(/web link/i);
    expect(input().getAttribute("aria-invalid")).toBe("true");
    expect(screen.queryByRole("link")).toBeNull();
    expect(localStorage.getItem(QUICK_LINKS_KEY)).toBeNull();
  });

  it("clears the error as soon as the user edits", () => {
    render(<QuickLinks accent="#000" />);
    type("nope"); fireEvent.keyDown(input(), { key: "Enter" });
    expect(screen.getByRole("alert")).toBeInTheDocument();
    type("nope2");
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("says when a link is already there", () => {
    render(<QuickLinks accent="#000" />);
    type("example.com"); fireEvent.keyDown(input(), { key: "Enter" });
    type("https://example.com/"); fireEvent.keyDown(input(), { key: "Enter" });
    expect(screen.getByRole("alert")).toHaveTextContent(/already here/i);
    expect(screen.getAllByRole("link")).toHaveLength(1);
  });

  it("says when the list is full", () => {
    render(<QuickLinks accent="#000" />);
    for (let i = 0; i < MAX_QUICK_LINKS; i++) { type(`s${i}.example.com`); fireEvent.keyDown(input(), { key: "Enter" }); }
    type("extra.example.com"); fireEvent.keyDown(input(), { key: "Enter" });
    expect(screen.getByRole("alert")).toHaveTextContent(new RegExp(`${MAX_QUICK_LINKS} quick links`));
  });

  it("removes a link", () => {
    render(<QuickLinks accent="#000" />);
    type("example.com"); fireEvent.keyDown(input(), { key: "Enter" });
    fireEvent.click(screen.getByRole("button", { name: "Remove example.com" }));
    expect(screen.queryByRole("link")).toBeNull();
  });

  it("does nothing for a blank entry", () => {
    render(<QuickLinks accent="#000" />);
    type("   "); fireEvent.keyDown(input(), { key: "Enter" });
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("remembers links across a remount", () => {
    const first = render(<QuickLinks accent="#000" />);
    type("example.com"); fireEvent.keyDown(input(), { key: "Enter" });
    first.unmount();
    render(<QuickLinks accent="#000" />);
    expect(screen.getByRole("link", { name: /example\.com/ })).toBeInTheDocument();
  });
});
