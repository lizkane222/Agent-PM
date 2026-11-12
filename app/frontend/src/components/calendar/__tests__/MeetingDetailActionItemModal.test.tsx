/**
 * MeetingDetail — double-clicking an Action Items card opens the shared ActionItemModal
 * (not the retired inline edit modal), and saving updates the card in place.
 */
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { http, HttpResponse } from "msw";
import { server } from "../../../test/msw-server";
import { mockCalendarEvents } from "../../../test/handlers/scheduler";
import { mockActionItem } from "../../../test/handlers/action_items";
import { ExportProvider } from "../../../context/ExportContext";
import MeetingDetail from "../MeetingDetail";

vi.mock("../../../assets/icons/Corporate.svg?react", () => ({ default: () => null }));
vi.mock("../../shared/RichTextMentionEditor", () => ({
  default: React.forwardRef(({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder?: string }, ref: React.Ref<{ clear: () => void }>) => {
    React.useImperativeHandle(ref, () => ({ clear: () => onChange("") }));
    return <textarea value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} />;
  }),
  plainToHtml: (text: string) => text,
}));

class FakeSocket {
  static CONNECTING = 0;
  readyState = 1;
  onopen: (() => void) | null = null;
  onmessage: ((e: MessageEvent) => void) | null = null;
  onerror: (() => void) | null = null;
  onclose: (() => void) | null = null;
  send() {}
  close() {}
}

const item = { ...mockActionItem, airtable_id: "recMODAL1", task: "Send recap deck", status: "Open", linked_meeting: null, linked_meeting_name: null };

function serve() {
  const patches: Array<{ id: string; body: Record<string, unknown> }> = [];
  server.use(
    http.get("/api/v1/scheduler/meeting-notes/", () => HttpResponse.json({ results: [] })),
    http.post("/api/v1/airtable/match/", () =>
      HttpResponse.json({ account: null, matched: false, needs_categorization: true, action_items: [item], meetings: [] })),
    http.get("/api/v1/airtable/action-items/", () => HttpResponse.json([item])),
    http.get("/api/v1/airtable/action-items/:id/attachments/", () => HttpResponse.json([])),
    http.get("/api/v1/salesforce/projects/", () => HttpResponse.json({ results: [] })),
    http.patch("/api/v1/airtable/action-items/:id/fields/", async ({ request, params }) => {
      const body = (await request.json()) as Record<string, unknown>;
      patches.push({ id: String(params.id), body });
      return HttpResponse.json({ ...item, ...body });
    }),
    http.post("/api/v1/realtime/activity/", () => HttpResponse.json({ id: 1 }, { status: 201 })),
  );
  return patches;
}

async function openModal() {
  render(<MemoryRouter><ExportProvider><MeetingDetail event={mockCalendarEvents[0]} /></ExportProvider></MemoryRouter>);
  const titles = await screen.findAllByText("Send recap deck");
  const card = titles.map((t) => t.closest("[draggable='true']")).find(Boolean) as HTMLElement;
  fireEvent.doubleClick(card);
  return await screen.findByTestId("action-item-modal-panel");
}

describe("MeetingDetail — standard action item modal", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.stubGlobal("WebSocket", FakeSocket);
  });

  it("double-click opens the shared ActionItemModal", async () => {
    serve();
    const panel = await openModal();
    // Unique to the shared modal: labelled fields and the Upload / Add Link / + Artifact controls.
    expect(within(panel).getByLabelText("Est. Time (min)")).toBeInTheDocument();
    expect(within(panel).getByRole("button", { name: "Add Link" })).toBeInTheDocument();
    expect(within(panel).getByRole("button", { name: "+ Artifact" })).toBeInTheDocument();
    expect(screen.queryByText("Edit Action Item")).not.toBeInTheDocument();
  });

  it("saving PATCHes the item's fields endpoint and updates the card", async () => {
    const patches = serve();
    const panel = await openModal();
    fireEvent.change(within(panel).getByLabelText("Task"), { target: { value: "Send final deck" } });
    fireEvent.click(within(panel).getByRole("button", { name: /Save changes/ }));

    await waitFor(() => expect(patches).toHaveLength(1));
    expect(patches[0].id).toBe("recMODAL1");
    expect(patches[0].body).toEqual({ task: "Send final deck" });
    await waitFor(() => expect(screen.queryByTestId("action-item-modal-panel")).not.toBeInTheDocument());
    expect((await screen.findAllByText("Send final deck")).length).toBeGreaterThan(0);
    expect(screen.queryByText("Send recap deck")).not.toBeInTheDocument();
  });
});
