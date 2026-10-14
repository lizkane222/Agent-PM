import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { server } from "../../../test/msw-server";
import { NewActionItemCard } from "../NewActionItemCard";
import { AppErrorProvider } from "../../../context/AppErrorContext";
import type { AirtableActionItem } from "../../../types";

function renderCard(onSave = vi.fn()) {
  render(
    <AppErrorProvider>
      <NewActionItemCard accountName="Archistrator" teamMembers={[]} onSave={onSave} />
    </AppErrorProvider>,
  );
  return onSave;
}

describe("NewActionItemCard", () => {
  it("sends the account name and hands the created item back", async () => {
    let body: Record<string, unknown> | null = null;
    server.use(
      http.post("/api/v1/airtable/action-items/", async ({ request }) => {
        body = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json({ id: 1, airtable_id: "recNEW", task: "Mermaid Integration", account_name: "Archistrator" } as Partial<AirtableActionItem>, { status: 201 });
      }),
    );
    const onSave = renderCard();
    fireEvent.change(screen.getByPlaceholderText("Name or short description"), { target: { value: "Mermaid Integration" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    expect(body!.account_name).toBe("Archistrator");
  });

  it("reports a failed create and keeps what was typed", async () => {
    server.use(
      http.post("/api/v1/airtable/action-items/", () =>
        HttpResponse.json({ error: 'Unknown account "Archistrator" — the action item was not created.' }, { status: 400 }),
      ),
    );
    const onSave = renderCard();
    const input = screen.getByPlaceholderText("Name or short description");
    fireEvent.change(input, { target: { value: "Mermaid Integration" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByText(/Unknown account "Archistrator"/)).toBeInTheDocument();
    expect(onSave).not.toHaveBeenCalled();
    expect(input).toHaveValue("Mermaid Integration");
  });
});
