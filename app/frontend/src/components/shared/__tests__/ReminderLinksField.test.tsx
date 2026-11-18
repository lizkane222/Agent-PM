import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { server } from "../../../test/msw-server";
import ReminderLinksField from "../ReminderLinksField";

describe("ReminderLinksField", () => {
  it("offers artifacts as a link type and attaches the chosen one", async () => {
    const asked: string[] = [];
    server.use(http.get("/api/v1/scheduler/reminders/link-options/", ({ request }) => {
      asked.push(new URL(request.url).searchParams.get("type") ?? "");
      return HttpResponse.json({ results: [{ id: 5, label: "Pricing deck", detail: "" }] });
    }));
    const onChange = vi.fn();
    render(<ReminderLinksField value={[]} onChange={onChange} />);
    fireEvent.click(screen.getByText("+ Link to a record"));
    fireEvent.change(screen.getByLabelText("Record type"), { target: { value: "artifact" } });
    fireEvent.mouseDown(await screen.findByText("Pricing deck"));
    await waitFor(() => expect(onChange).toHaveBeenCalledWith([{ resource_type: "artifact", resource_id: 5, resource_label: "Pricing deck" }]));
    expect(asked).toContain("artifact");
  });
});
