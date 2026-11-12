import { describe, it, expect } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { http, HttpResponse } from "msw";
import { server } from "../../../test/msw-server";
import { mockUserPageNote } from "../../../test/handlers/layouts";
import { LinkedNotepadNotes } from "../LinkedNotepadNotes";

const renderIt = (accountId = 7) =>
  render(<MemoryRouter><LinkedNotepadNotes accountId={accountId} /></MemoryRouter>);

const serve = (notes: unknown[], seen?: (search: string) => void) =>
  server.use(http.get("*/api/v1/layouts/page-notes/", ({ request }) => {
    seen?.(new URL(request.url).search);
    return HttpResponse.json({ count: notes.length, next: null, previous: null, results: notes });
  }));

describe("LinkedNotepadNotes", () => {
  it("asks only for the notes linked to this account", async () => {
    let search = "";
    serve([], s => { search = s; });
    renderIt(7);
    await waitFor(() => expect(search).toContain("account=7"));
  });

  it("lists linked notes, labelled as the user's own and private", async () => {
    serve([mockUserPageNote({ id: 1, account: 7, content: "<p>Renewal call went well</p>" })]);
    renderIt();
    expect(await screen.findByText("Renewal call went well")).toBeInTheDocument();
    expect(screen.getByText(/From your Notepad/i)).toBeInTheDocument();
    expect(screen.getByText(/Only you can see these/i)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Edit in Notepad/i }).getAttribute("href")).toBe("/profile");
  });

  it("renders lists and checklists in the note, not as bare lines", async () => {
    serve([mockUserPageNote({ content: "<ul><li><p>one</p></li></ul>" })]);
    const { container } = renderIt();
    await screen.findByText("one");
    expect(container.querySelector(".rich-text ul > li")).toBeTruthy();
  });

  it("shows nothing at all when no note is linked, so the section looks as it did before", async () => {
    serve([]);
    const { container } = renderIt();
    await new Promise(r => setTimeout(r, 50));
    expect(container.firstChild).toBeNull();
  });

  it("ignores a linked note with no text", async () => {
    serve([mockUserPageNote({ content: "<p></p>" })]);
    const { container } = renderIt();
    await new Promise(r => setTimeout(r, 50));
    expect(container.firstChild).toBeNull();
  });

  it("strips scripts from note HTML", async () => {
    serve([mockUserPageNote({ content: '<p>safe</p><img src=x onerror="window.__pwned=1"><script>window.__pwned=1</script>' })]);
    const { container } = renderIt();
    await screen.findByText("safe");
    expect(container.innerHTML).not.toContain("onerror");
    expect(container.innerHTML).not.toContain("<script");
  });

  it("shows nothing if the request fails", async () => {
    server.use(http.get("*/api/v1/layouts/page-notes/", () => new HttpResponse(null, { status: 500 })));
    const { container } = renderIt();
    await new Promise(r => setTimeout(r, 50));
    expect(container.firstChild).toBeNull();
  });
});
