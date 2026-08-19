import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { server } from "../../../test/msw-server";
import ArtifactPicker from "../ArtifactPicker";

vi.mock("../../account/ArtifactIcon", () => ({
  ArtifactIconImg: () => null,
  CATALOG_BY_KEY: { link: { key: "link" } },
  getAutoIconKey: () => "link",
}));

const ACTION_ITEM_ID = 7;
const ACCOUNT_ID = 3;

const artifact = (id: number, name: string, url = `https://example.com/${id}`) => ({
  id,
  account: ACCOUNT_ID,
  name,
  url,
  file_url: null,
  icon_key: "link",
  artifact_type: "link",
  created_at: "2026-01-01T00:00:00Z",
});

/** Serve the account lookup + artifact list, recording what was requested. */
function serve({
  artifacts = [artifact(1, "Architecture diagram")],
  accounts = [{ id: ACCOUNT_ID, company_name: "Acme Corp" }],
}: { artifacts?: ReturnType<typeof artifact>[]; accounts?: { id: number; company_name: string }[] } = {}) {
  const calls = { search: [] as (string | null)[], artifactsFor: [] as string[], attached: [] as unknown[] };
  server.use(
    http.get("/api/v1/accounts/accounts/", ({ request }) => {
      calls.search.push(new URL(request.url).searchParams.get("search"));
      return HttpResponse.json({ results: accounts, count: accounts.length });
    }),
    http.get("/api/v1/accounts/accounts/:id/artifacts/", ({ params }) => {
      calls.artifactsFor.push(String(params.id));
      return HttpResponse.json(artifacts);
    }),
    http.post("/api/v1/airtable/action-items/:id/attachments/", async ({ request }) => {
      const body = await request.json();
      calls.attached.push(body);
      return HttpResponse.json({ id: 99, artifact_type: "link", name: "Architecture diagram", url: "u", file_url: null }, { status: 201 });
    }),
  );
  return calls;
}

function renderPicker(props: Partial<React.ComponentProps<typeof ArtifactPicker>> = {}) {
  const onAttached = vi.fn();
  const onError = vi.fn();
  render(
    <ArtifactPicker
      actionItemId={ACTION_ITEM_ID}
      accountName="Acme Corp"
      onAttached={onAttached}
      onError={onError}
      {...props}
    />
  );
  return { onAttached, onError };
}

const openMenu = () => fireEvent.click(screen.getByRole("button", { name: "+ Artifact" }));

describe("ArtifactPicker", () => {
  beforeEach(() => { serve(); });

  it("renders the + Artifact control", () => {
    renderPicker();
    expect(screen.getByRole("button", { name: "+ Artifact" })).toBeInTheDocument();
  });

  it("fetches nothing until the menu is opened", async () => {
    const calls = serve();
    renderPicker();

    await new Promise((r) => setTimeout(r, 20));
    // Eager loading would mean two requests per rendered action item.
    expect(calls.artifactsFor).toEqual([]);
    expect(calls.search).toEqual([]);
  });

  it("lists the account's artifacts on open", async () => {
    serve({ artifacts: [artifact(1, "Architecture diagram"), artifact(2, "Runbook")] });
    renderPicker();

    openMenu();

    await waitFor(() => expect(screen.getByText("Architecture diagram")).toBeInTheDocument());
    expect(screen.getByText("Runbook")).toBeInTheDocument();
  });

  it("resolves the account by name when no accountId is supplied", async () => {
    const calls = serve();
    renderPicker();

    openMenu();

    await waitFor(() => expect(screen.getByText("Architecture diagram")).toBeInTheDocument());
    expect(calls.search).toEqual(["Acme Corp"]);
    expect(calls.artifactsFor).toEqual([String(ACCOUNT_ID)]);
  });

  it("skips the name lookup when accountId is supplied", async () => {
    const calls = serve();
    renderPicker({ accountId: ACCOUNT_ID });

    openMenu();

    await waitFor(() => expect(screen.getByText("Architecture diagram")).toBeInTheDocument());
    expect(calls.search).toEqual([]);
    expect(calls.artifactsFor).toEqual([String(ACCOUNT_ID)]);
  });

  it("matches the account name case-insensitively", async () => {
    const calls = serve({ accounts: [{ id: 42, company_name: "ACME CORP" }] });
    renderPicker({ accountName: "acme corp" });

    openMenu();

    await waitFor(() => expect(calls.artifactsFor).toEqual(["42"]));
  });

  it("ignores a fuzzy search hit that is not an exact name match", async () => {
    // ?search= is a partial match on the server, so "Acme Corp Holdings" can come back too.
    const calls = serve({ accounts: [{ id: 99, company_name: "Acme Corp Holdings" }] });
    renderPicker({ accountName: "Acme Corp" });

    openMenu();

    await waitFor(() => expect(screen.getByText(/No artifacts on this account/)).toBeInTheDocument());
    expect(calls.artifactsFor).toEqual([]);
  });

  it("says so when the account has no artifacts", async () => {
    serve({ artifacts: [] });
    renderPicker();

    openMenu();

    await waitFor(() => expect(screen.getByText("No artifacts on this account")).toBeInTheDocument());
  });

  it("says so when the item has no account at all", async () => {
    renderPicker({ accountName: null });

    openMenu();

    await waitFor(() => expect(screen.getByText("This item has no account")).toBeInTheDocument());
  });

  it("attaches the chosen artifact by name and url", async () => {
    const calls = serve({ artifacts: [artifact(1, "Architecture diagram", "https://example.com/diagram")] });
    const { onAttached } = renderPicker();
    openMenu();
    await waitFor(() => expect(screen.getByText("Architecture diagram")).toBeInTheDocument());

    fireEvent.click(screen.getByText("Architecture diagram"));

    await waitFor(() => expect(calls.attached).toEqual([
      { artifact_type: "link", name: "Architecture diagram", url: "https://example.com/diagram" },
    ]));
    expect(onAttached).toHaveBeenCalledWith(expect.objectContaining({ id: 99 }));
  });

  it("falls back to the artifact's file_url when it has no url", async () => {
    const fileArtifact = { ...artifact(5, "Signed SOW"), url: null, file_url: "https://files/sow.pdf" };
    const calls = serve({ artifacts: [fileArtifact as unknown as ReturnType<typeof artifact>] });
    renderPicker();
    openMenu();
    await waitFor(() => expect(screen.getByText("Signed SOW")).toBeInTheDocument());

    fireEvent.click(screen.getByText("Signed SOW"));

    await waitFor(() => expect(calls.attached).toEqual([
      { artifact_type: "link", name: "Signed SOW", url: "https://files/sow.pdf" },
    ]));
  });

  it("closes the menu after a successful attach", async () => {
    serve();
    renderPicker();
    openMenu();
    await waitFor(() => expect(screen.getByText("Architecture diagram")).toBeInTheDocument());

    fireEvent.click(screen.getByText("Architecture diagram"));

    await waitFor(() => expect(screen.queryByText("Architecture diagram")).not.toBeInTheDocument());
  });

  it("reports a failed attach instead of failing silently", async () => {
    serve();
    server.use(
      http.post("/api/v1/airtable/action-items/:id/attachments/", () =>
        HttpResponse.json({ detail: "You can only modify action items assigned to you." }, { status: 403 })
      )
    );
    const { onAttached, onError } = renderPicker();
    openMenu();
    await waitFor(() => expect(screen.getByText("Architecture diagram")).toBeInTheDocument());

    fireEvent.click(screen.getByText("Architecture diagram"));

    await waitFor(() =>
      expect(onError).toHaveBeenCalledWith("You can only modify action items assigned to you.")
    );
    expect(onAttached).not.toHaveBeenCalled();
  });

  it("reports a failed artifact load", async () => {
    server.use(
      http.get("/api/v1/accounts/accounts/", () => HttpResponse.json({ results: [{ id: ACCOUNT_ID, company_name: "Acme Corp" }], count: 1 })),
      http.get("/api/v1/accounts/accounts/:id/artifacts/", () => new HttpResponse(null, { status: 500 })),
    );
    const { onError } = renderPicker();

    openMenu();

    await waitFor(() => expect(onError).toHaveBeenCalledWith("Could not load this account's artifacts."));
  });

  it("does not refetch on a second open", async () => {
    const calls = serve();
    renderPicker();

    openMenu();
    await waitFor(() => expect(screen.getByText("Architecture diagram")).toBeInTheDocument());
    openMenu(); // close
    openMenu(); // reopen

    await new Promise((r) => setTimeout(r, 20));
    expect(calls.artifactsFor).toHaveLength(1);
  });
});
