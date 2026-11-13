import { describe, it, expect, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { server } from "../../../test/msw-server";
import { PinNoteProvider, PinNoteButton, PIN_TITLE, PINNED_TITLE, buildPinnedContent, isAlreadyPinned } from "../PinNoteButton";
const reportError = vi.hoisted(() => vi.fn());
vi.mock("../../../context/AppErrorContext", () => ({ useAppError: () => ({ reportError }) }));
const source = { accountId: 5, accountName: "Acme", label: "QBR", date: "2026-11-02T10:00:00Z", resourceId: 9, url: "/accounts/5" };

function Row({ onPinned }: { onPinned?: (n: unknown) => void }) {
  return (
      <PinNoteProvider value={{ ...source, onPinned: onPinned as never }}>
        <div className="group">
          <button title="Delete">del</button>
          <PinNoteButton text="Ship <it> @Bob" />
          <PinNoteButton text="<p>Rich <b>note</b></p>" isHtml />
        </div>
      </PinNoteProvider>
  );
}

describe("PinNoteButton", () => {
  it("pins a bullet with escaped body and a meeting reference, and reports it", async () => {
    let body: any;
    server.use(
      http.get("*/accounts/accounts/5/notes/", () => HttpResponse.json([])),
      http.post("*/accounts/accounts/5/notes/", async ({ request }) => { body = await request.json(); return HttpResponse.json({ id: 1, content: body.content, references: body.references }, { status: 201 }); }),
    );
    const onPinned = vi.fn();
    render(<Row onPinned={onPinned} />);
    const btns = screen.getAllByTitle(PIN_TITLE);
    expect(screen.getByTitle("Delete").compareDocumentPosition(btns[0]) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    await userEvent.click(btns[0]);
    await waitFor(() => expect(onPinned).toHaveBeenCalled());
    expect(body.content).toContain("<p>Ship &lt;it&gt; @Bob</p>");
    expect(body.content).toContain("From QBR (2026-11-02)");
    expect(body.references).toEqual([{ resource_type: "meeting", resource_id: 9, label: "QBR", url: "/accounts/5" }]);
    expect(await screen.findByTitle(PINNED_TITLE)).toBeTruthy();
  });

  it("does not create a duplicate when already pinned", async () => {
    const post = vi.fn();
    server.use(
      http.get("*/accounts/accounts/5/notes/", () => HttpResponse.json([{ id: 2, content: buildPinnedContent("Ship <it> @Bob", false, source), references: [{ resource_type: "meeting", resource_id: 9 }] }])),
      http.post("*/accounts/accounts/5/notes/", () => { post(); return HttpResponse.json({}, { status: 201 }); }),
    );
    render(<Row />);
    await userEvent.click(screen.getAllByTitle(PIN_TITLE)[0]);
    expect(await screen.findByText("Already pinned")).toBeTruthy();
    expect(post).not.toHaveBeenCalled();
  });

  it("second click on a pinned note is a no-op", async () => {
    const post = vi.fn();
    server.use(
      http.get("*/accounts/accounts/5/notes/", () => HttpResponse.json([])),
      http.post("*/accounts/accounts/5/notes/", () => { post(); return HttpResponse.json({ id: 3, content: "x" }, { status: 201 }); }),
    );
    render(<Row />);
    await userEvent.click(screen.getAllByTitle(PIN_TITLE)[0]);
    await userEvent.click(await screen.findByTitle(PINNED_TITLE));
    expect(post).toHaveBeenCalledTimes(1);
    expect(screen.getByText("Already pinned")).toBeTruthy();
  });

  it("surfaces a failure", async () => {
    server.use(
      http.get("*/accounts/accounts/5/notes/", () => HttpResponse.json([])),
      http.post("*/accounts/accounts/5/notes/", () => HttpResponse.json({}, { status: 500 })),
    );
    render(<Row />);
    await userEvent.click(screen.getAllByTitle(PIN_TITLE)[1]);
    await waitFor(() => expect(reportError).toHaveBeenCalled());
  });

  it("keeps rich HTML as-is and matches it for duplicates", () => {
    const c = buildPinnedContent("<p>Rich <b>note</b></p>", true, source);
    expect(c.startsWith("<p>Rich <b>note</b></p>")).toBe(true);
    expect(isAlreadyPinned([{ content: c, references: [{ resource_type: "meeting", resource_id: 9 }] } as never], "<p>Rich <b>note</b></p>", true, source)).toBe(true);
    expect(isAlreadyPinned([{ content: c, references: [{ resource_type: "meeting", resource_id: 10 }] } as never], "<p>Rich <b>note</b></p>", true, source)).toBe(false);
  });
});
