/**
 * GongSummaryPanel now holds two providers' summaries at once.
 *
 * What matters and is easy to break: the panel opens on Gong when Gong has content,
 * the toggle swaps the rendered bullets without a round-trip, and a save goes to the
 * column for the *active* provider — writing a Zoom paste into gong_notes would
 * silently clobber the Gong recap.
 */
import React from "react";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";

import { server } from "../../../test/msw-server";
import { GongSummaryPanel } from "../GongSummaryPanel";
import { mockAirtableMeeting } from "../../../test/handlers/accounts";

vi.mock("../../../context/CurrentUserContext", () => ({
  useCurrentUser: () => null,
  CurrentUserProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

const GONG_NOTES = "Recap\n- Gong said pricing";
const ZOOM_NOTES = "Recap\n- Zoom said rollout";

/** The mount effect re-reads the meeting; return whatever this test wants it to hold. */
function serveMeeting(overrides: { gong_notes?: string; zoom_notes?: string }) {
  server.use(
    http.get("/api/v1/airtable/meetings/:id/", () =>
      HttpResponse.json({ ...mockAirtableMeeting, gong_notes: "", zoom_notes: "", ...overrides })
    )
  );
}

function renderPanel(props: Partial<React.ComponentProps<typeof GongSummaryPanel>> = {}) {
  return render(
    <GongSummaryPanel
      eventId={0}
      meetingId={1}
      accountName="Acme Corp"
      teamMembers={[]}
      {...props}
    />
  );
}

describe("GongSummaryPanel — provider toggle", () => {
  beforeEach(() => {
    serveMeeting({});
  });

  it("opens on Gong and shows its bullets when Gong has notes", async () => {
    serveMeeting({ gong_notes: GONG_NOTES });
    renderPanel({ existingNotes: GONG_NOTES });

    expect(await screen.findByText("Gong said pricing")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Gong" })).toHaveAttribute("aria-pressed", "true");
  });

  it("opens on Zoom when only Zoom has notes", async () => {
    serveMeeting({ zoom_notes: ZOOM_NOTES });
    renderPanel({ existingZoomNotes: ZOOM_NOTES });

    expect(await screen.findByText("Zoom said rollout")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Zoom" })).toHaveAttribute("aria-pressed", "true");
  });

  it("prefers Gong when both providers have notes", async () => {
    serveMeeting({ gong_notes: GONG_NOTES, zoom_notes: ZOOM_NOTES });
    renderPanel({ existingNotes: GONG_NOTES, existingZoomNotes: ZOOM_NOTES });

    expect(await screen.findByText("Gong said pricing")).toBeInTheDocument();
    expect(screen.queryByText("Zoom said rollout")).not.toBeInTheDocument();
  });

  it("swaps the rendered bullets when the toggle is clicked", async () => {
    serveMeeting({ gong_notes: GONG_NOTES, zoom_notes: ZOOM_NOTES });
    renderPanel({ existingNotes: GONG_NOTES, existingZoomNotes: ZOOM_NOTES });

    await screen.findByText("Gong said pricing");
    await userEvent.click(screen.getByRole("button", { name: "Zoom" }));

    expect(await screen.findByText("Zoom said rollout")).toBeInTheDocument();
    expect(screen.queryByText("Gong said pricing")).not.toBeInTheDocument();
  });

  it("marks both providers populated when both have notes", async () => {
    serveMeeting({ gong_notes: GONG_NOTES, zoom_notes: ZOOM_NOTES });
    renderPanel({ existingNotes: GONG_NOTES, existingZoomNotes: ZOOM_NOTES });

    await screen.findByText("Gong said pricing");
    expect(screen.getByRole("button", { name: "Gong" })).toHaveAttribute("data-populated", "true");
    expect(screen.getByRole("button", { name: "Zoom" })).toHaveAttribute("data-populated", "true");
  });

  it("shows a Zoom-specific placeholder on the Zoom side", async () => {
    renderPanel();

    await userEvent.click(screen.getByRole("button", { name: "Zoom" }));

    expect(screen.getByPlaceholderText(/Zoom AI Companion summary/i)).toBeInTheDocument();
  });
});

describe("GongSummaryPanel — per-provider saves", () => {
  beforeEach(() => {
    serveMeeting({});
  });

  it("saves to the gong-notes endpoint while Gong is active", async () => {
    const calls: string[] = [];
    server.use(
      http.patch("/api/v1/airtable/meetings/:id/gong-notes/", async ({ request }) => {
        calls.push("gong");
        const body = await request.json() as { gong_notes: string };
        return HttpResponse.json({ ...mockAirtableMeeting, gong_notes: body.gong_notes });
      })
    );

    renderPanel();
    await userEvent.type(screen.getByRole("textbox"), "- Pasted a Gong recap");
    await userEvent.click(screen.getByRole("button", { name: /Parse & Save/i }));

    await waitFor(() => expect(calls).toEqual(["gong"]));
  });

  it("saves to the zoom-notes endpoint after switching to Zoom", async () => {
    const bodies: string[] = [];
    server.use(
      http.patch("/api/v1/airtable/meetings/:id/zoom-notes/", async ({ request }) => {
        const body = await request.json() as { zoom_notes: string };
        bodies.push(body.zoom_notes);
        return HttpResponse.json({ ...mockAirtableMeeting, zoom_notes: body.zoom_notes });
      }),
      http.patch("/api/v1/airtable/meetings/:id/gong-notes/", () => {
        throw new Error("Zoom paste must not be written to gong_notes");
      })
    );

    renderPanel();
    await userEvent.click(screen.getByRole("button", { name: "Zoom" }));
    await userEvent.type(screen.getByRole("textbox"), "- Pasted a Zoom recap");
    await userEvent.click(screen.getByRole("button", { name: /Parse & Save/i }));

    await waitFor(() => expect(bodies).toEqual(["- Pasted a Zoom recap"]));
  });

  it("leaves the other provider's notes intact after saving one", async () => {
    serveMeeting({ gong_notes: GONG_NOTES });
    server.use(
      http.patch("/api/v1/airtable/meetings/:id/zoom-notes/", async ({ request }) => {
        const body = await request.json() as { zoom_notes: string };
        return HttpResponse.json({
          ...mockAirtableMeeting, gong_notes: GONG_NOTES, zoom_notes: body.zoom_notes,
        });
      })
    );

    renderPanel({ existingNotes: GONG_NOTES });
    await screen.findByText("Gong said pricing");

    await userEvent.click(screen.getByRole("button", { name: "Zoom" }));
    await userEvent.type(screen.getByRole("textbox"), "- Pasted a Zoom recap");
    await userEvent.click(screen.getByRole("button", { name: /Parse & Save/i }));

    await screen.findByText("Pasted a Zoom recap");
    // Switching back still shows the Gong recap — the save didn't touch it.
    await userEvent.click(screen.getByRole("button", { name: "Gong" }));
    expect(await screen.findByText("Gong said pricing")).toBeInTheDocument();
  });

  it("surfaces a save failure without losing the typed text", async () => {
    server.use(
      http.patch("/api/v1/airtable/meetings/:id/gong-notes/", () =>
        new HttpResponse(null, { status: 500 })
      )
    );

    renderPanel();
    await userEvent.type(screen.getByRole("textbox"), "- Pasted a Gong recap");
    await userEvent.click(screen.getByRole("button", { name: /Parse & Save/i }));

    expect(await screen.findByText("Save failed")).toBeInTheDocument();
    expect(screen.getByText("Pasted a Gong recap")).toBeInTheDocument();
  });

  it("treats a newline-only recap as empty and offers the paste box", async () => {
    // Airtable's richText columns report "\n" for a cell that was written and later
    // cleared, and never drop the key again. Rendering that as content would hide the
    // paste box behind a summary that isn't there.
    serveMeeting({ gong_notes: "\n" });
    renderPanel();

    expect(await screen.findByRole("textbox")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Gong" })).toHaveAttribute("data-populated", "false");
  });

  it("picks up a summary imported by the email scan on mount", async () => {
    // Panel mounts with no props, but the server already holds an imported recap.
    serveMeeting({ zoom_notes: ZOOM_NOTES });
    renderPanel();

    expect(await screen.findByText("Zoom said rollout")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Zoom" })).toHaveAttribute("aria-pressed", "true");
  });
});
