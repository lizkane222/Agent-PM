import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { http, HttpResponse } from "msw";
import { server } from "../../test/msw-server";
import { AppErrorProvider } from "../../context/AppErrorContext";
import { useSlackLinkAutosave, saveSlackThreadUrl } from "../useSlackLinkAutosave";
import type { AirtableActionItem } from "../../types";

const URL = "https://acme.slack.com/archives/C123/p456";

const item = {
  airtable_id: "recAAA001",
  slack_thread_url: "",
} as Pick<AirtableActionItem, "airtable_id" | "slack_thread_url">;

/** Bodies of every fields PATCH the suite saw. */
let patches: Array<{ body: Record<string, unknown>; id: string }>;

function registerPatch(status = 200) {
  server.use(
    http.patch("/api/v1/airtable/action-items/:id/fields/", async ({ request, params }) => {
      const body = (await request.json()) as Record<string, unknown>;
      patches.push({ body, id: String(params.id) });
      if (status !== 200) return new HttpResponse(null, { status });
      return HttpResponse.json({ ...item, ...body, id: 1 });
    })
  );
}

/** Minimal host that fires the autosave on click, so the hook runs inside a real render. */
function Host({ target = item, onUpdated }: { target?: typeof item; onUpdated?: (u: AirtableActionItem) => void }) {
  const autosave = useSlackLinkAutosave();
  return <button onClick={() => autosave(target, URL, onUpdated)}>save</button>;
}

describe("saveSlackThreadUrl", () => {
  beforeEach(() => { patches = []; });

  it("PATCHes only the slack_thread_url field", async () => {
    registerPatch();
    const updated = await saveSlackThreadUrl(item, URL);
    expect(patches).toEqual([{ id: "recAAA001", body: { slack_thread_url: URL } }]);
    expect(updated).not.toBeNull();
  });

  it("trims the URL before writing", async () => {
    registerPatch();
    await saveSlackThreadUrl(item, `  ${URL}  `);
    expect(patches[0]?.body).toEqual({ slack_thread_url: URL });
  });

  it("skips a local-* draft entirely", async () => {
    registerPatch();
    // promoteBlankItem throws that id away, so a write against it would be lost anyway — and
    // there is no server record to patch.
    const updated = await saveSlackThreadUrl({ airtable_id: "local-1", slack_thread_url: "" }, URL);
    expect(updated).toBeNull();
    expect(patches).toHaveLength(0);
  });

  it("skips an unchanged URL", async () => {
    registerPatch();
    // A blur straight after a paste-commit re-offers the same value; that must not be a write.
    const updated = await saveSlackThreadUrl({ airtable_id: "recAAA001", slack_thread_url: URL }, URL);
    expect(updated).toBeNull();
    expect(patches).toHaveLength(0);
  });

  it("treats null and empty string as the same stored value", async () => {
    registerPatch();
    // The API type says `string`, but Airtable hands back null for a never-set URL — so the
    // guard has to normalise rather than compare strictly.
    const stored = { airtable_id: "recAAA001", slack_thread_url: null as unknown as string };
    const updated = await saveSlackThreadUrl(stored, "  ");
    expect(updated).toBeNull();
    expect(patches).toHaveLength(0);
  });
});

describe("useSlackLinkAutosave", () => {
  beforeEach(() => { patches = []; });

  it("hands the saved item back to the caller", async () => {
    registerPatch();
    const onUpdated = vi.fn();
    render(<AppErrorProvider><Host onUpdated={onUpdated} /></AppErrorProvider>);
    fireEvent.click(screen.getByText("save"));

    await waitFor(() => expect(onUpdated).toHaveBeenCalledOnce());
    expect(onUpdated.mock.calls[0]?.[0]).toMatchObject({ slack_thread_url: URL });
  });

  it("reports a failed save instead of failing silently", async () => {
    registerPatch(500);
    render(<AppErrorProvider><Host /></AppErrorProvider>);
    fireEvent.click(screen.getByText("save"));

    // The chip renders the new link straight from local form state, so the user has every
    // reason to think it saved. Silence is the worst possible outcome here.
    await waitFor(() => expect(screen.getByText(/Could not save the Slack link/i)).toBeInTheDocument());
  });

  it("does not report anything when there was nothing to save", async () => {
    registerPatch();
    render(
      <AppErrorProvider>
        <Host target={{ airtable_id: "recAAA001", slack_thread_url: URL }} />
      </AppErrorProvider>
    );
    fireEvent.click(screen.getByText("save"));

    await new Promise((r) => setTimeout(r, 20));
    expect(patches).toHaveLength(0);
    expect(screen.queryByText(/Could not save the Slack link/i)).not.toBeInTheDocument();
  });
});
