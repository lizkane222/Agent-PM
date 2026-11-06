/**
 * RichTextMentionEditor — `@#--` dynamic lookup keywords.
 *
 * Real TipTap, text delivered by paste (ProseMirror ignores synthetic keydown). The mode is
 * opt-in via `enableKeywords`: every other editor must keep treating `@#--…` as a plain
 * `@#` record search.
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { server } from "../../../test/msw-server";
import RichTextMentionEditor from "../RichTextMentionEditor";

const pm = () => document.querySelector(".ProseMirror") as HTMLElement;

function type(text: string) {
  fireEvent.paste(pm(), {
    clipboardData: { getData: (t: string) => (t === "text/plain" ? text : ""), types: ["text/plain"], files: [] },
  });
}

function renderEditor(props: Partial<React.ComponentProps<typeof RichTextMentionEditor>> = {}) {
  const onChange = vi.fn();
  render(<RichTextMentionEditor value="" onChange={onChange} {...props} />);
  return { onChange };
}

describe("@#-- lookup keywords", () => {
  it("lists the lookup templates when enabled", async () => {
    renderEditor({ enableKeywords: true });
    type("@#--");
    expect(await screen.findByText("@#--all-action-items-${account_name}")).toBeInTheDocument();
    expect(screen.getByText("@#--all-meeting-notes-${account_name}-${date-range}")).toBeInTheDocument();
    expect(screen.getByText(/Every action item on the account/)).toBeInTheDocument();
  });

  it("filters the templates as you keep typing", async () => {
    renderEditor({ enableKeywords: true });
    type("@#--meeting");
    expect(await screen.findByText("@#--all-meeting-notes-${account_name}-${date-range}")).toBeInTheDocument();
    expect(screen.queryByText("@#--all-action-items-${account_name}")).not.toBeInTheDocument();
  });

  it("inserts the chosen template into the note", async () => {
    const { onChange } = renderEditor({ enableKeywords: true });
    type("@#--");
    fireEvent.mouseDown(await screen.findByText("@#--all-action-items-${account_name}"));
    await waitFor(() => expect(pm().textContent).toContain("@#--all-action-items-${account_name}"));
    expect(onChange).toHaveBeenLastCalledWith(expect.stringContaining("@#--all-action-items-${account_name}"));
    expect(document.querySelector("[data-mention-dropdown]")).not.toBeInTheDocument();
  });

  it("says when nothing matches", async () => {
    renderEditor({ enableKeywords: true });
    type("@#--zzzz");
    expect(await screen.findByText(/No lookups match/)).toBeInTheDocument();
  });

  it("is off by default: @#-- stays an ordinary record search", async () => {
    let catalogHits = 0;
    server.use(http.get("/api/v1/skills/agent-skills/resolve-keywords/", () => { catalogHits++; return HttpResponse.json({ keywords: [] }); }));
    renderEditor();
    type("@#--all");
    await waitFor(() => expect(document.querySelector("[data-mention-dropdown]")).toBeInTheDocument());
    expect(screen.queryByText(/Every action item on the account/)).not.toBeInTheDocument();
    expect(catalogHits).toBe(0);
  });

  it("advertises the lookups in the toolbar only when enabled", () => {
    const { unmount } = render(<RichTextMentionEditor value="" onChange={() => {}} enableKeywords />);
    expect(screen.getByText(/@#-- lookups/)).toBeInTheDocument();
    unmount();
    render(<RichTextMentionEditor value="" onChange={() => {}} />);
    expect(screen.queryByText(/@#-- lookups/)).not.toBeInTheDocument();
  });

  it("still opens the normal @# record search when keywords are enabled", async () => {
    renderEditor({ enableKeywords: true });
    type("@#");
    expect(await screen.findByText(/Type at least 2 characters to search records/i)).toBeInTheDocument();
  });
});
