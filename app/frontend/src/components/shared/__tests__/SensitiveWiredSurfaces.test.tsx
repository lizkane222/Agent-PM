/**
 * Wired surfaces: the masks reach real screens (ActionItemModal, CommentPanel, a card menu).
 * The secret must be gone from the DOM, and a mark made through one screen must show on another.
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { MemoryRouter } from "react-router-dom";
import { server } from "../../../test/msw-server";
import { sensitiveMarksResponse } from "../../../test/handlers/sensitive";
import { mockComment } from "../../../test/handlers/comments";
import { CurrentUserProvider } from "../../../context/CurrentUserContext";
import CommentPanel from "../../comments/CommentPanel";
import { ActionItemModal } from "../../account/ActionItemModal";
import { ContextMenu } from "../../action-items/ContextMenu";
import SensitiveText from "../SensitiveText";
import type { AirtableActionItem } from "../../../types";

vi.mock("../../comments/CommentContext", () => ({
  useCommentContext: () => ({ openComments: vi.fn(), closeComments: vi.fn() }),
  CommentProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock("../RichTextMentionEditor", () => ({
  default: ({ value }: { value: string }) => <textarea data-testid="details-editor" defaultValue={value} />,
}));
vi.mock("../../account/ActionItemCardOccurrences", () => ({ ActionItemCardOccurrences: () => null }));
vi.mock("../../ActivityLogSection", () => ({ default: () => null }));
vi.mock("../../CommentIcon", () => ({ default: () => null }));
vi.mock("../../../assets/icons/Corporate.svg?react", () => ({ default: () => null }));

const item = {
  id: 7, airtable_id: "recAAA001", account: 1, account_name: "Acme", task: "Renew Falcon contract",
  task_details: "<p>Budget is 5M</p>", status: "Open", priority: "High", due_date: null, estimated_time: 0,
  time_spent: 0, prep_time: 0, slack_thread_url: "", salesforce_task_id: "", assignee_airtable_id: "",
  assignee_name: "", reminder: null, reminder_id: null, reminder_due_at: null, reminder_status: null,
  linked_meeting: null, linked_meeting_name: null, created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z", marked_done_at: null, last_synced: "",
} as AirtableActionItem;

function modalHandlers() {
  server.use(
    http.get("/api/v1/airtable/action-items/:id/attachments/", () => HttpResponse.json([])),
    http.get("/api/v1/accounts/accounts/:id/artifacts/", () => HttpResponse.json([])),
    http.get("/api/v1/airtable/action-items/field-options/", () => HttpResponse.json({ status: ["Open"], priority: ["High"] })),
  );
}

describe("ActionItemModal", () => {
  it("a hidden task shows a mask instead of the editor, and Show to edit reveals it", async () => {
    modalHandlers();
    server.use(sensitiveMarksResponse({ "7": [{ id: 1, field: "task", text: "", line_key: "" }] }));
    render(<ActionItemModal item={item} accountId={1} onClose={vi.fn()} />);
    await waitFor(() => expect(document.querySelector("[data-row='task'] [data-sensitive-mask]")).toBeTruthy());
    expect(screen.queryByDisplayValue("Renew Falcon contract")).toBeNull();
    expect(document.body.textContent).not.toContain("Renew Falcon contract");
    fireEvent.click(screen.getAllByText("Show to edit")[0]);
    expect(screen.getByDisplayValue("Renew Falcon contract")).toBeTruthy();
  });

  it("without marks the editor is exactly as before", async () => {
    modalHandlers();
    render(<ActionItemModal item={item} accountId={1} onClose={vi.fn()} />);
    expect(screen.getByDisplayValue("Renew Falcon contract")).toBeTruthy();
    expect(screen.queryByText("Show to edit")).toBeNull();
  });

  it("an unsaved local draft is never marked or fetched", async () => {
    modalHandlers();
    let hits = 0;
    server.use(http.get("/api/v1/sensitive/marks/", () => { hits++; return HttpResponse.json({ results: {} }); }));
    render(<ActionItemModal item={{ ...item, airtable_id: "local-1" }} accountId={1} onClose={vi.fn()} />);
    await new Promise((r) => setTimeout(r, 30));
    expect(hits).toBe(0);
  });
});

describe("CommentPanel", () => {
  it("masks a hidden comment body for everyone and keeps others readable", async () => {
    server.use(
      http.get("/api/v1/comments/comments/", () =>
        HttpResponse.json({ results: [{ ...mockComment, content: "the password is hunter2" }], count: 1 })),
      sensitiveMarksResponse({ "1": [{ id: 3, field: "content", text: "hunter2", line_key: "" }] }),
    );
    render(
      <MemoryRouter><CurrentUserProvider>
        <CommentPanel resourceType="action_item" resourceId={10} resourceLabel="x" onClose={vi.fn()} />
      </CurrentUserProvider></MemoryRouter>,
    );
    await waitFor(() => expect(document.querySelector("[data-sensitive-mask]")).toBeTruthy());
    expect(document.body.textContent).toContain("the password is");
    expect(document.body.textContent).not.toContain("hunter2");
  });
});

describe("existing card menus pick up the hide options", () => {
  it("right-click on text inside a surface that opens a ContextMenu adds the entries to that menu", async () => {
    function Card() {
      const [pos, setPos] = (require("react") as typeof import("react")).useState<{ x: number; y: number } | null>(null);
      return (
        <div onContextMenu={(e) => { e.preventDefault(); setPos({ x: e.clientX, y: e.clientY }); }}>
          <SensitiveText resourceType="action_item" resourceId={7} field="task" text="Renew contract" />
          {pos && <ContextMenu x={pos.x} y={pos.y} items={[{ label: "Pin to Focus", onClick: () => {} }]} onClose={() => setPos(null)} />}
        </div>
      );
    }
    const { container } = render(<Card />);
    fireEvent.contextMenu(container.querySelector("span")!);
    expect(await screen.findByText("Pin to Focus")).toBeTruthy();
    expect(screen.getByText("Hide this line")).toBeTruthy();
    expect(screen.getByText(/screen-share aid/)).toBeTruthy();
  });

  it("a menu opened without right-clicking sensitive text gets no extra entries", async () => {
    render(<ContextMenu x={1} y={1} items={[{ label: "Only me", onClick: () => {} }]} onClose={() => {}} />);
    expect(screen.getByText("Only me")).toBeTruthy();
    expect(screen.queryByText("Hide this line")).toBeNull();
  });
});
