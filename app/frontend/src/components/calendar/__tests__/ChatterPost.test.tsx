import { describe, it, expect } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { server } from "../../../test/msw-server";
import ChatterPost from "../ChatterPost";

const CHATTER_PATH = "/api/v1/salesforce/chatter/";

function openComposer() {
  render(<ChatterPost recordId="001ABC" recordName="Acme Corp" />);
  fireEvent.click(screen.getByRole("button", { name: /Post Chatter/i }));
  return screen.getByPlaceholderText(/Write an update/i);
}

describe("ChatterPost — Enter posts the update", () => {
  it("posts on a bare Enter, with no click on Post", async () => {
    let body: unknown = "not called";
    server.use(
      http.post(CHATTER_PATH, async ({ request }) => {
        body = await request.json();
        return HttpResponse.json({ id: "0D5" });
      })
    );

    const textarea = openComposer();
    fireEvent.change(textarea, { target: { value: "Renewal call went well" } });
    fireEvent.keyDown(textarea, { key: "Enter" });

    await waitFor(() => expect(body).not.toBe("not called"));
    expect(body).toEqual({ record_id: "001ABC", body: "Renewal call went well" });
    expect(await screen.findByText(/Posted successfully/i)).toBeInTheDocument();
  });

  it("does not post on Shift+Enter — that inserts a newline", async () => {
    let calls = 0;
    server.use(http.post(CHATTER_PATH, () => { calls += 1; return HttpResponse.json({ id: "0D5" }); }));

    const textarea = openComposer();
    fireEvent.change(textarea, { target: { value: "Line one" } });
    fireEvent.keyDown(textarea, { key: "Enter", shiftKey: true });

    await new Promise((r) => setTimeout(r, 20));
    expect(calls).toBe(0);
  });

  it("does not post an empty update on Enter", async () => {
    let calls = 0;
    server.use(http.post(CHATTER_PATH, () => { calls += 1; return HttpResponse.json({ id: "0D5" }); }));

    const textarea = openComposer();
    fireEvent.keyDown(textarea, { key: "Enter" });

    await new Promise((r) => setTimeout(r, 20));
    expect(calls).toBe(0);
  });

  it("still posts when the Post button is clicked", async () => {
    let calls = 0;
    server.use(http.post(CHATTER_PATH, () => { calls += 1; return HttpResponse.json({ id: "0D5" }); }));

    const textarea = openComposer();
    fireEvent.change(textarea, { target: { value: "Clicked instead" } });
    fireEvent.click(screen.getByRole("button", { name: "Post" }));

    await waitFor(() => expect(calls).toBe(1));
  });

  it("surfaces a failure and keeps the draft", async () => {
    server.use(http.post(CHATTER_PATH, () => new HttpResponse(null, { status: 500 })));

    const textarea = openComposer();
    fireEvent.change(textarea, { target: { value: "Will fail" } });
    fireEvent.keyDown(textarea, { key: "Enter" });

    expect(await screen.findByText(/Failed to post/i)).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/Write an update/i)).toHaveValue("Will fail");
  });
});
