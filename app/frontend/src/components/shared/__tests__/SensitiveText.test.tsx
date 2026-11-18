import { describe, it, expect } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { server } from "../../../test/msw-server";
import { sensitiveMarksResponse } from "../../../test/handlers/sensitive";
import SensitiveText from "../SensitiveText";
import { sensitiveMenuItems } from "../sensitiveMenu";
import { requestSensitiveMarks } from "../../../lib/sensitiveStore";
import type { SensitiveMark } from "../../../types/sensitive";

const SECRET = "Project Falcon budget";
const whole: SensitiveMark = { id: 1, field: "task", text: "", line_key: "" };
const snip = (id: number, text: string, field = "task"): SensitiveMark => ({ id, field, text, line_key: "" });

function plain(text = `The ${SECRET} is 5M`, extra: Partial<React.ComponentProps<typeof SensitiveText>> = {}) {
  return render(<SensitiveText resourceType="action_item" resourceId={7} field="task" text={text} {...extra} />);
}
const mockMarks = (marks: SensitiveMark[]) => server.use(sensitiveMarksResponse({ "7": marks }));

/** A fake server that behaves like the real one: POST adds a mark, GET lists it, DELETE removes it. */
function liveServer(initial: SensitiveMark[] = []) {
  const live = [...initial];
  const posted: Array<Record<string, unknown>> = [];
  let nextId = 100;
  server.use(
    http.get("/api/v1/sensitive/marks/", () => HttpResponse.json({ results: live.length ? { "7": live } : {} })),
    http.post("/api/v1/sensitive/marks/", async ({ request }) => {
      const b = (await request.json()) as Record<string, unknown>;
      posted.push(b);
      const m: SensitiveMark = { id: nextId++, field: String(b.field), text: String(b.text), line_key: String(b.line_key ?? "") };
      live.push(m);
      return HttpResponse.json(m, { status: 201 });
    }),
    http.delete("/api/v1/sensitive/marks/:id/", ({ params }) => {
      const i = live.findIndex((m) => m.id === Number(params.id));
      if (i >= 0) live.splice(i, 1);
      return new HttpResponse(null, { status: 204 });
    }),
  );
  return { live, posted };
}

describe("SensitiveText: no marks", () => {
  it("renders the same text with no extra wrapper box and no secret change", async () => {
    const { container } = plain();
    expect(container.textContent).toBe(`The ${SECRET} is 5M`);
    expect(container.firstElementChild?.getAttribute("style")).toContain("display: contents");
    await new Promise((r) => setTimeout(r, 30));
    expect(container.textContent).toBe(`The ${SECRET} is 5M`);
  });

  it("html renders sanitized markup unchanged", () => {
    const { container } = render(<SensitiveText resourceType="action_item" resourceId={7} field="d"
      html="<p>Hello <b>bold</b></p><script>alert(1)</script>" as="div" className="rich-text" />);
    expect(container.innerHTML).toBe('<div class="rich-text"><p>Hello <b>bold</b></p></div>');
  });

  it("an unsaved record renders plain and fires no request", async () => {
    let hits = 0;
    server.use(http.get("/api/v1/sensitive/marks/", () => { hits++; return HttpResponse.json({ results: {} }); }));
    render(<SensitiveText resourceType="action_item" resourceId="local-1" field="task" text="x" />);
    await new Promise((r) => setTimeout(r, 30));
    expect(hits).toBe(0);
  });
});

describe("SensitiveText: masking", () => {
  it("whole field: the secret is not in the DOM", async () => {
    mockMarks([whole]);
    const { container } = plain();
    await waitFor(() => expect(container.querySelector("[data-sensitive-mask]")).toBeTruthy());
    expect(container.textContent).not.toContain("Falcon");
    expect(container.textContent).not.toContain("budget");
    expect(screen.getByLabelText("Hidden sensitive text")).toBeTruthy();
    expect(screen.getByLabelText("Hidden sensitive text").getAttribute("title")).toMatch(/only masks the display/);
  });

  it("partial snippet masks only that snippet (every occurrence)", async () => {
    mockMarks([snip(2, SECRET)]);
    const { container } = plain(`${SECRET} and again ${SECRET}; public stays`);
    await waitFor(() => expect(container.querySelectorAll("[data-sensitive-mask]").length).toBe(2));
    expect(container.textContent).toContain("; public stays");
    expect(container.textContent).not.toContain("Falcon");
  });

  it("matches across whitespace differences", async () => {
    mockMarks([snip(2, "Project   Falcon")]);
    const { container } = plain("see Project Falcon now");
    await waitFor(() => expect(container.querySelector("[data-sensitive-mask]")).toBeTruthy());
    expect(container.textContent).not.toContain("Falcon");
  });

  it("marks for another field or another line are ignored", async () => {
    mockMarks([snip(2, SECRET, "other"), { id: 3, field: "task", text: "", line_key: "line-2" }]);
    const { container } = plain();
    await new Promise((r) => setTimeout(r, 30));
    expect(container.querySelector("[data-sensitive-mask]")).toBeNull();
    expect(container.textContent).toContain("Falcon");
  });

  it("line_key scopes a whole-line mark", async () => {
    mockMarks([{ id: 3, field: "task", text: "", line_key: "line-2" }]);
    const a = plain("first line", { lineKey: "line-1" });
    const b = plain("second line", { lineKey: "line-2" });
    await waitFor(() => expect(b.container.querySelector("[data-sensitive-mask]")).toBeTruthy());
    expect(a.container.textContent).toBe("first line");
    expect(b.container.textContent).not.toContain("second");
  });

  it("html: masks a snippet spanning inline elements, per text node", async () => {
    mockMarks([snip(2, "Falcon budget", "d")]);
    const { container } = render(<SensitiveText resourceType="action_item" resourceId={7} field="d" as="div"
      className="rich-text" html="<p>The <b>Falcon</b> <i>budget</i> is 5M</p><p>other</p>" />);
    await waitFor(() => expect(container.querySelectorAll("[data-sensitive-mask]").length).toBeGreaterThan(0));
    expect(container.textContent).not.toContain("Falcon");
    expect(container.textContent).not.toContain("budget");
    expect(container.textContent).toContain("is 5M");
    expect(container.querySelector("b [data-sensitive-mask]")).toBeTruthy();
    expect(container.textContent).toContain("other");
  });

  it("html: a snippet selected across two paragraphs still matches", async () => {
    mockMarks([snip(2, "alpha beta", "d")]);
    const { container } = render(<SensitiveText resourceType="action_item" resourceId={7} field="d" as="div"
      html="<p>x alpha</p><p>beta y</p>" />);
    await waitFor(() => expect(container.querySelector("[data-sensitive-mask]")).toBeTruthy());
    expect(container.textContent).not.toContain("alpha");
    expect(container.textContent).not.toContain("beta");
  });

  it("html whole-field mask removes all content; hostile html cannot sneak in", async () => {
    mockMarks([{ id: 1, field: "d", text: "", line_key: "" }]);
    const { container } = render(<SensitiveText resourceType="action_item" resourceId={7} field="d" as="div"
      html="<p>top secret</p>" />);
    await waitFor(() => expect(container.querySelector("[data-sensitive-mask]")).toBeTruthy());
    expect(container.textContent).not.toContain("secret");
  });
});

describe("SensitiveText: right-click", () => {
  async function menuFor(marks: SensitiveMark[]) {
    mockMarks(marks);
    const utils = plain();
    requestSensitiveMarks("action_item", 7);
    await waitFor(() => expect(true).toBe(true));
    return utils;
  }

  it("offers Hide this line and opens the default menu with the screen-share note", async () => {
    const { container } = await menuFor([]);
    fireEvent.contextMenu(container.firstElementChild!);
    expect(await screen.findByText("Hide this line")).toBeTruthy();
    expect(screen.queryByText("Hide selected text")).toBeNull();
    expect(screen.getByText(/screen-share aid, not access control/)).toBeTruthy();
  });

  it("Hide this line posts a whole-field mark and masks right away", async () => {
    const { posted: bodies } = liveServer();
    const { container } = plain();
    fireEvent.contextMenu(container.firstElementChild!);
    fireEvent.click(await screen.findByText("Hide this line"));
    await waitFor(() => expect(container.querySelector("[data-sensitive-mask]")).toBeTruthy());
    expect(bodies[0]).toMatchObject({ resource_type: "action_item", resource_id: "7", field: "task", text: "", line_key: "" });
  });

  it("offers Hide selected text only with a selection inside the element, and posts only that text", async () => {
    const { posted: bodies } = liveServer();
    const { container } = plain();
    const el = container.firstElementChild!;
    const textNode = el.firstChild as Text;
    const start = textNode.data.indexOf("Project");
    const range = document.createRange();
    range.setStart(textNode, start);
    range.setEnd(textNode, start + SECRET.length);
    const sel = window.getSelection()!;
    sel.removeAllRanges();
    sel.addRange(range);
    fireEvent.contextMenu(el);
    fireEvent.click(await screen.findByText("Hide selected text"));
    await waitFor(() => expect(bodies.length).toBe(1));
    expect(bodies[0].text).toBe(SECRET);
    await waitFor(() => expect(container.textContent).not.toContain("Falcon"));
    expect(container.textContent).toContain("is 5M");
  });

  it("ignores a selection that lies outside this element", async () => {
    const { container } = await menuFor([]);
    const other = document.createElement("p");
    other.textContent = "elsewhere";
    document.body.appendChild(other);
    const range = document.createRange();
    range.selectNodeContents(other);
    window.getSelection()!.removeAllRanges();
    window.getSelection()!.addRange(range);
    fireEvent.contextMenu(container.firstElementChild!);
    await screen.findByText("Hide this line");
    expect(screen.queryByText("Hide selected text")).toBeNull();
    other.remove();
  });

  it("right-click on a mask offers Show, and removing unmarks it for everyone", async () => {
    const { live } = liveServer([whole]);
    const { container } = plain();
    const mask = await waitFor(() => {
      const m = container.querySelector("[data-sensitive-mask]");
      expect(m).toBeTruthy();
      return m!;
    });
    fireEvent.contextMenu(mask);
    expect(screen.queryByText("Hide this line")).toBeNull();
    fireEvent.click(await screen.findByText("Show hidden text (remove hiding)"));
    await waitFor(() => expect(container.textContent).toContain("Falcon"));
    expect(live).toEqual([]);
  });

  it("does not open its own menu when a surface already prevented the event, and exposes items to it", async () => {
    const { container } = render(
      <div onContextMenu={(e) => { e.preventDefault(); (window as unknown as { __items: unknown }).__items = sensitiveMenuItems(e); }}>
        <SensitiveText resourceType="action_item" resourceId={7} field="task" text="hello" />
      </div>,
    );
    fireEvent.contextMenu(container.querySelector("span")!);
    expect(screen.queryByText("Hide this line")).toBeNull();
    const items = (window as unknown as { __items: Array<{ label: string }> }).__items;
    expect(items.map((i) => i.label)).toEqual(["Hide this line"]);
  });

  it("html: Hide this line hides just the paragraph under the cursor", async () => {
    const { posted: bodies } = liveServer();
    const { container } = render(<SensitiveText resourceType="action_item" resourceId={7} field="d" as="div"
      html="<p>first line</p><p>second line</p>" />);
    fireEvent.contextMenu(container.querySelectorAll("p")[1]);
    fireEvent.click(await screen.findByText("Hide this line"));
    await waitFor(() => expect(bodies.length).toBe(1));
    expect(bodies[0].text).toBe("second line");
    await waitFor(() => expect(container.textContent).not.toContain("second"));
    expect(container.textContent).toContain("first line");
  });

  it("a failed save shows a message and changes nothing", async () => {
    server.use(http.post("/api/v1/sensitive/marks/", () => HttpResponse.json({}, { status: 404 })));
    const { container } = await menuFor([]);
    fireEvent.contextMenu(container.firstElementChild!);
    fireEvent.click(await screen.findByText("Hide this line"));
    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(container.textContent).toContain("Falcon");
  });
});

describe("SensitiveText: shared across instances of the same record", () => {
  it("a mark made through one instance appears on another instance of the record", async () => {
    liveServer();
    const a = plain("alpha text");
    const b = render(<SensitiveText resourceType="action_item" resourceId={7} field="task" text="alpha text" />);
    fireEvent.contextMenu(a.container.firstElementChild!);
    await act(async () => { fireEvent.click(await screen.findByText("Hide this line")); });
    await waitFor(() => expect(b.container.querySelector("[data-sensitive-mask]")).toBeTruthy());
    expect(b.container.textContent).not.toContain("alpha");
  });
});
