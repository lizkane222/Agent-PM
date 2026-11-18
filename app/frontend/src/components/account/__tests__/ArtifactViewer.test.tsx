/**
 * The artifact preview overlay: Escape, a preview for every file type (plus the screenshot
 * fallback), and the sidebar's notes / comments / linked records.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { MemoryRouter } from "react-router-dom";
import { server } from "../../../test/msw-server";
import { mockArtifact, mockArtifactNote } from "../../../test/handlers/accounts";
import { mockComment } from "../../../test/handlers/comments";
import { apiClient } from "../../../lib/api";
import type { AccountArtifact, ArtifactNote, Comment } from "../../../types";

let me: { id: number; access_level: string; display_name: string; airtable_collaborator_id: string } | null;
vi.mock("../../../context/CurrentUserContext", () => ({ useCurrentUser: () => me }));
vi.mock("../../shared/RichTextMentionEditor", () => ({
  default: ({ value, onChange, onSubmit, placeholder }: { value: string; onChange: (v: string) => void; onSubmit?: () => void; placeholder?: string }) => (
    <textarea
      aria-label={placeholder} value={value} onChange={(e) => onChange(e.target.value)}
      onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey && onSubmit) { e.preventDefault(); onSubmit(); } }}
    />
  ),
}));

import { ArtifactViewer, escapeAction } from "../ArtifactViewer";

const FILE_URL = "http://localhost/media/data.bin";
function fileArtifact(over: Partial<AccountArtifact> = {}): AccountArtifact {
  return {
    ...mockArtifact, id: 5, artifact_type: "file", name: "data.bin", url: null, file_url: FILE_URL,
    mime_type: "application/octet-stream", uploaded_by: 1, uploaded_by_username: "alice", icon_key: "", ...over,
  };
}
const page = (results: unknown[]) => HttpResponse.json({ count: results.length, next: null, previous: null, results });

function renderViewer(artifact: AccountArtifact, props: Partial<React.ComponentProps<typeof ArtifactViewer>> = {}) {
  const onClose = vi.fn();
  const onUpdated = vi.fn();
  const utils = render(
    <MemoryRouter>
      <ArtifactViewer artifact={artifact} onClose={onClose} onUpdated={onUpdated} {...props} />
    </MemoryRouter>,
  );
  return { onClose, onUpdated, ...utils };
}

function servePreview(body: unknown) {
  server.use(http.get("/api/v1/accounts/artifacts/:id/preview/", () => HttpResponse.json(body as Record<string, unknown>)));
}

beforeEach(() => {
  me = { id: 1, access_level: "basic", display_name: "Alice", airtable_collaborator_id: "usr1" };
  vi.spyOn(console, "error").mockImplementation(() => {});
});

// ── Escape ────────────────────────────────────────────────────────────────────

describe("Escape", () => {
  it("closes the overlay", () => {
    const { onClose } = renderViewer(fileArtifact());
    fireEvent.keyDown(document.body, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("ignores other keys", () => {
    const { onClose } = renderViewer(fileArtifact());
    fireEvent.keyDown(document.body, { key: "Enter" });
    expect(onClose).not.toHaveBeenCalled();
  });

  it("does nothing when something below it already handled the key (preventDefault)", () => {
    const { onClose } = renderViewer(fileArtifact());
    const inner = document.createElement("div");
    inner.addEventListener("keydown", (e) => e.preventDefault());
    screen.getByRole("dialog").appendChild(inner);
    fireEvent.keyDown(inner, { key: "Escape" });
    expect(onClose).not.toHaveBeenCalled();
  });

  it("does nothing when the key comes from an open menu or a nested dialog", () => {
    const { onClose } = renderViewer(fileArtifact());
    const menu = document.createElement("div");
    menu.setAttribute("role", "menu");
    const item = document.createElement("button");
    menu.appendChild(item);
    screen.getByRole("dialog").appendChild(menu);
    fireEvent.keyDown(item, { key: "Escape" });
    const nested = document.createElement("div");
    nested.setAttribute("role", "dialog");
    const inside = document.createElement("button");
    nested.appendChild(inside);
    document.body.appendChild(nested);
    fireEvent.keyDown(inside, { key: "Escape" });
    expect(onClose).not.toHaveBeenCalled();
    nested.remove();
  });

  it("leaves a half-written note alone: the first Escape only leaves the field, the second closes", async () => {
    const { onClose } = renderViewer(fileArtifact());
    const box = await screen.findByLabelText("Add a note about this artifact…");
    fireEvent.change(box, { target: { value: "draft" } });
    box.focus();
    fireEvent.keyDown(box, { key: "Escape" });
    expect(onClose).not.toHaveBeenCalled();
    expect(document.activeElement).not.toBe(box);
    expect((box as HTMLTextAreaElement).value).toBe("draft");
    fireEvent.keyDown(document.body, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("closes from an empty text field", async () => {
    const { onClose } = renderViewer(fileArtifact());
    const box = await screen.findByLabelText("Add a note about this artifact…");
    box.focus();
    fireEvent.keyDown(box, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("stops listening when the overlay unmounts", () => {
    const { onClose, unmount } = renderViewer(fileArtifact());
    unmount();
    fireEvent.keyDown(document.body, { key: "Escape" });
    expect(onClose).not.toHaveBeenCalled();
  });

  it("still closes on a backdrop click, but not on a click inside the overlay's body", () => {
    const { onClose } = renderViewer(fileArtifact());
    fireEvent.click(screen.getByTestId("artifact-sidebar"));
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("dialog"));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("gives focus back to what had it before the overlay opened", () => {
    const trigger = document.createElement("button");
    document.body.appendChild(trigger);
    trigger.focus();
    const { unmount } = renderViewer(fileArtifact());
    expect(document.activeElement).toBe(screen.getByRole("dialog"));
    unmount();
    expect(document.activeElement).toBe(trigger);
    trigger.remove();
  });
});

describe("escapeAction", () => {
  const key = (target: Element, init: KeyboardEventInit = {}) => {
    const e = new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true, ...init });
    Object.defineProperty(e, "target", { value: target });
    return e;
  };
  it("covers every branch", () => {
    const overlay = document.createElement("div");
    overlay.setAttribute("role", "dialog");
    const ta = document.createElement("textarea");
    overlay.appendChild(ta);
    document.body.appendChild(overlay);
    expect(escapeAction(key(ta), overlay)).toBe("close");
    ta.value = "typed";
    expect(escapeAction(key(ta), overlay)).toBe("blur");
    expect(escapeAction(key(ta, { key: "a" }), overlay)).toBe("ignore");
    const prevented = key(ta);
    prevented.preventDefault();
    expect(escapeAction(prevented, overlay)).toBe("ignore");
    const ce = document.createElement("div");
    ce.setAttribute("contenteditable", "true");
    ce.textContent = "words";
    overlay.appendChild(ce);
    expect(escapeAction(key(ce), overlay)).toBe("blur");
    overlay.remove();
  });
});

// ── Previews ──────────────────────────────────────────────────────────────────

describe("native previews", () => {
  it("shows an image from the file URL", () => {
    renderViewer(fileArtifact({ name: "pic.png", mime_type: "image/png" }));
    expect(screen.getByTestId("preview-image")).toHaveAttribute("src", FILE_URL);
  });

  it("shows an SVG through <img>, never inline", () => {
    renderViewer(fileArtifact({ name: "logo.svg", mime_type: "image/svg+xml" }));
    const el = screen.getByTestId("preview-image");
    expect(el.tagName).toBe("IMG");
  });

  it("shows a PDF in a frame", () => {
    renderViewer(fileArtifact({ name: "a.pdf", mime_type: "application/pdf" }));
    expect(screen.getByTestId("preview-pdf")).toHaveAttribute("src", FILE_URL);
  });

  it("plays video and audio with controls", () => {
    const { unmount } = renderViewer(fileArtifact({ name: "a.mp4", mime_type: "video/mp4" }));
    expect(screen.getByTestId("preview-video")).toHaveAttribute("controls");
    unmount();
    renderViewer(fileArtifact({ name: "a.mp3", mime_type: "audio/mpeg" }));
    expect(screen.getByTestId("preview-audio")).toHaveAttribute("controls");
  });

  it("recognises a type by its extension when the mime type is blank", () => {
    renderViewer(fileArtifact({ name: "clip.webm", mime_type: "" }));
    expect(screen.getByTestId("preview-video")).toBeInTheDocument();
  });

  it("falls back when the browser cannot decode the file", async () => {
    renderViewer(fileArtifact({ name: "broken.png", mime_type: "image/png" }));
    fireEvent.error(screen.getByTestId("preview-image"));
    expect(await screen.findByTestId("preview-fallback")).toHaveTextContent("No preview available for this file type");
  });

  it("asks the server for nothing when the browser renders it itself", async () => {
    let hits = 0;
    server.use(http.get("/api/v1/accounts/artifacts/:id/preview/", () => { hits++; return HttpResponse.json({ kind: "native" }); }));
    renderViewer(fileArtifact({ name: "pic.png", mime_type: "image/png" }));
    await screen.findByTestId("artifact-sidebar");
    expect(hits).toBe(0);
  });
});

describe("link previews", () => {
  const link = (url: string) => ({ ...mockArtifact, id: 6, url, icon_key: "" });

  it("is a card with the address and an Open button, loading nothing from the link", () => {
    renderViewer(link("https://example.com/spec"));
    const card = screen.getByTestId("link-card");
    expect(card).toHaveTextContent("https://example.com/spec");
    expect(within(card).getByRole("link", { name: /Open/ })).toHaveAttribute("href", "https://example.com/spec");
    expect(screen.queryByTestId("link-embed")).toBeNull();
    expect(screen.queryByText("Show embedded preview")).toBeNull();
  });

  it("offers a Google doc as an embedded preview only after an explicit click", () => {
    renderViewer(link("https://docs.google.com/document/d/abc123/edit?usp=sharing"));
    expect(screen.queryByTestId("link-embed")).toBeNull();
    fireEvent.click(screen.getByText("Show embedded preview"));
    const frame = screen.getByTestId("link-embed");
    expect(frame).toHaveAttribute("src", "https://docs.google.com/document/d/abc123/preview");
    expect(frame.getAttribute("sandbox")).not.toContain("allow-top-navigation");
  });

  it("never turns a non-web address into a link", () => {
    renderViewer(link("javascript:alert(1)"));
    expect(screen.getByTestId("link-card")).toHaveTextContent("no web address");
    expect(screen.queryByRole("link", { name: /Open ↗/ })).toBeNull();
  });
});

describe("server-described previews", () => {
  it("shows a loading state, then plain text", async () => {
    servePreview({ kind: "text", format: "plain", text: "hello\nworld", truncated: false });
    renderViewer(fileArtifact({ name: "notes.txt", mime_type: "text/plain" }));
    expect(screen.getByTestId("preview-loading")).toBeInTheDocument();
    expect(await screen.findByTestId("preview-text")).toHaveTextContent("hello world");
    expect(screen.queryByTestId("preview-truncated")).toBeNull();
  });

  it("pretty-prints JSON", async () => {
    servePreview({ kind: "text", format: "json", text: '{"a":1}', truncated: false });
    renderViewer(fileArtifact({ name: "c.json", mime_type: "application/json" }));
    expect((await screen.findByTestId("preview-text")).textContent).toBe('{\n  "a": 1\n}');
  });

  it("renders markdown as sanitized HTML", async () => {
    servePreview({ kind: "text", format: "markdown", text: "# Title\n\n<script>alert(1)</script>", truncated: false });
    renderViewer(fileArtifact({ name: "r.md", mime_type: "text/markdown" }));
    const md = await screen.findByTestId("preview-markdown");
    expect(md.querySelector("h1, h2, h3")).toHaveTextContent("Title");
    expect(md.querySelector("script")).toBeNull();
    expect(md).toHaveClass("rich-text");
  });

  it("renders a CSV or spreadsheet as a table with sheet tabs", async () => {
    servePreview({ kind: "table", truncated: false, sheets: [
      { name: "Accounts", rows: [["Name", "Region"], ["Acme", "West"]] },
      { name: "Other", rows: [["x"]] },
    ] });
    renderViewer(fileArtifact({ name: "s.xlsx" }));
    const table = await screen.findByTestId("preview-table");
    expect(table).toHaveTextContent("Acme");
    fireEvent.click(screen.getByRole("tab", { name: "Other" }));
    expect(screen.getByTestId("preview-table")).toHaveTextContent("x");
    expect(screen.getByTestId("preview-table")).not.toHaveTextContent("Acme");
  });

  it("shows HTML only inside a fully sandboxed frame", async () => {
    servePreview({ kind: "html", html: "<p>Hi</p>", truncated: false });
    renderViewer(fileArtifact({ name: "p.html", mime_type: "text/html" }));
    const frame = await screen.findByTestId("preview-html");
    expect(frame).toHaveAttribute("sandbox", "");
    expect(frame).toHaveAttribute("srcdoc", "<p>Hi</p>");
  });

  it("shows the text of a Word document", async () => {
    servePreview({ kind: "document", text: "Quarterly plan\nOwner | Ada", truncated: false });
    renderViewer(fileArtifact({ name: "plan.docx" }));
    expect(await screen.findByTestId("preview-document")).toHaveTextContent("Quarterly plan");
  });

  it("lists the slides of a presentation", async () => {
    servePreview({ kind: "slides", truncated: false, slides: [{ index: 1, lines: ["Kickoff", "Agenda"] }, { index: 2, lines: [] }] });
    renderViewer(fileArtifact({ name: "d.pptx" }));
    const slides = await screen.findByTestId("preview-slides");
    expect(slides).toHaveTextContent("Slide 1");
    expect(slides).toHaveTextContent("Kickoff");
    expect(slides).toHaveTextContent("No text on this slide");
  });

  it("lists the entries of an archive", async () => {
    servePreview({ kind: "archive", truncated: false, entries: [{ name: "dir/a.txt", size: 12 }] });
    renderViewer(fileArtifact({ name: "a.zip", mime_type: "application/zip" }));
    expect(await screen.findByTestId("preview-archive")).toHaveTextContent("dir/a.txt");
  });

  it("says when only the start of a file is shown", async () => {
    servePreview({ kind: "text", format: "plain", text: "abc", truncated: true });
    renderViewer(fileArtifact({ name: "big.log", mime_type: "text/plain" }));
    expect(await screen.findByTestId("preview-truncated")).toBeInTheDocument();
  });

  it.each([
    ["too_large", { kind: "too_large" }, "too large"],
    ["unsupported", { kind: "unsupported", reason: "type" }, "No preview available"],
    ["error", { kind: "error", detail: "x" }, "could not be built"],
    ["unavailable", { kind: "unavailable" }, "no longer available"],
  ])("falls back for %s", async (_name, body, text) => {
    servePreview(body);
    renderViewer(fileArtifact());
    const fb = await screen.findByTestId("preview-fallback");
    expect(fb).toHaveTextContent(text);
  });

  it("falls back when the request itself fails", async () => {
    server.use(http.get("/api/v1/accounts/artifacts/:id/preview/", () => HttpResponse.json({ detail: "no" }, { status: 500 })));
    renderViewer(fileArtifact());
    expect(await screen.findByTestId("preview-fallback")).toHaveTextContent("could not be loaded");
  });
});

// ── Screenshot as the preview ─────────────────────────────────────────────────

function captureUploads() {
  const sent: FormData[] = [];
  const id = apiClient.interceptors.request.use((config) => {
    if (config.data instanceof FormData && String(config.url).includes("preview-image")) sent.push(config.data);
    return config;
  });
  return { sent, stop: () => apiClient.interceptors.request.eject(id) };
}
const png = () => new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], "shot.png", { type: "image/png" });
const SHOT = "http://localhost/media/shot.png";

describe("screenshot preview", () => {
  beforeEach(() => servePreview({ kind: "unsupported", reason: "type" }));

  it("offers the uploader a screenshot when no preview can be rendered", async () => {
    renderViewer(fileArtifact());
    const fb = await screen.findByTestId("preview-fallback");
    expect(fb).toHaveTextContent("Add a screenshot as the preview");
    expect(within(fb).getByTestId("screenshot-picker")).toBeInTheDocument();
  });

  it("does not offer it to someone who cannot edit, and says who can", async () => {
    me = { ...me!, id: 2 };
    renderViewer(fileArtifact());
    const fb = await screen.findByTestId("preview-fallback");
    expect(within(fb).queryByTestId("screenshot-picker")).toBeNull();
    expect(fb).toHaveTextContent("Whoever added this file");
  });

  it("uploads a chosen file as multipart `image`, then shows it as the preview", async () => {
    const art = fileArtifact();
    const { sent, stop } = captureUploads();
    server.use(http.post("/api/v1/accounts/artifacts/:id/preview-image/", () => HttpResponse.json({ ...art, preview_image_url: SHOT })));
    try {
      const { onUpdated } = renderViewer(art);
      await screen.findByTestId("preview-fallback");
      fireEvent.change(screen.getByTestId("screenshot-file-input"), { target: { files: [png()] } });
      const img = await screen.findByTestId("preview-screenshot");
      expect(img).toHaveAttribute("src", SHOT);
      expect(sent).toHaveLength(1);
      expect((sent[0].get("image") as File).name).toBe("shot.png");
      expect(onUpdated).toHaveBeenCalledWith(expect.objectContaining({ preview_image_url: SHOT }));
    } finally {
      stop();
    }
  });

  it("takes a screenshot pasted from the clipboard", async () => {
    const art = fileArtifact();
    const { sent, stop } = captureUploads();
    server.use(http.post("/api/v1/accounts/artifacts/:id/preview-image/", () => HttpResponse.json({ ...art, preview_image_url: SHOT })));
    try {
      renderViewer(art);
      await screen.findByTestId("screenshot-picker");
      const evt = new Event("paste", { bubbles: true, cancelable: true }) as Event & { clipboardData?: unknown };
      evt.clipboardData = { files: [png()], items: [] };
      document.body.dispatchEvent(evt);
      await screen.findByTestId("preview-screenshot");
      expect(sent).toHaveLength(1);
    } finally {
      stop();
    }
  });

  it("ignores a paste into a text field", async () => {
    const { sent, stop } = captureUploads();
    try {
      renderViewer(fileArtifact());
      const box = await screen.findByLabelText("Add a note about this artifact…");
      const evt = new Event("paste", { bubbles: true, cancelable: true }) as Event & { clipboardData?: unknown };
      evt.clipboardData = { files: [png()], items: [] };
      box.dispatchEvent(evt);
      await new Promise((r) => setTimeout(r, 30));
      expect(sent).toHaveLength(0);
    } finally {
      stop();
    }
  });

  it("takes a dropped file", async () => {
    const art = fileArtifact();
    const { sent, stop } = captureUploads();
    server.use(http.post("/api/v1/accounts/artifacts/:id/preview-image/", () => HttpResponse.json({ ...art, preview_image_url: SHOT })));
    try {
      renderViewer(art);
      fireEvent.drop(await screen.findByTestId("screenshot-picker"), { dataTransfer: { files: [png()] } });
      await screen.findByTestId("preview-screenshot");
      expect(sent).toHaveLength(1);
    } finally {
      stop();
    }
  });

  it("refuses a non-image or oversized file without sending it", async () => {
    const { sent, stop } = captureUploads();
    try {
      renderViewer(fileArtifact());
      const input = await screen.findByTestId("screenshot-file-input");
      fireEvent.change(input, { target: { files: [new File(["x"], "a.svg", { type: "image/svg+xml" })] } });
      expect(await screen.findByRole("alert")).toHaveTextContent("PNG, JPEG, GIF or WebP");
      const huge = new File([new Uint8Array(1)], "big.png", { type: "image/png" });
      Object.defineProperty(huge, "size", { value: 11 * 1024 * 1024 });
      fireEvent.change(input, { target: { files: [huge] } });
      await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("too large"));
      expect(sent).toHaveLength(0);
    } finally {
      stop();
    }
  });

  it("shows the server's reason when it refuses the image", async () => {
    server.use(http.post("/api/v1/accounts/artifacts/:id/preview-image/", () => HttpResponse.json({ error: "Image must be a PNG, JPEG, GIF or WebP file." }, { status: 400 })));
    renderViewer(fileArtifact());
    await screen.findByTestId("preview-fallback");
    fireEvent.change(screen.getByTestId("screenshot-file-input"), { target: { files: [png()] } });
    expect(await screen.findByRole("alert")).toHaveTextContent("Image must be a PNG");
    expect(screen.queryByTestId("preview-screenshot")).toBeNull();
  });

  it("an existing screenshot replaces the type-based preview, with no server preview request", async () => {
    let hits = 0;
    server.use(http.get("/api/v1/accounts/artifacts/:id/preview/", () => { hits++; return HttpResponse.json({ kind: "unsupported" }); }));
    renderViewer(fileArtifact({ preview_image_url: SHOT }));
    expect(screen.getByTestId("preview-screenshot")).toHaveAttribute("src", SHOT);
    await screen.findByTestId("artifact-sidebar");
    expect(hits).toBe(0);
  });

  it("the uploader can replace the preview of any artifact with a screenshot", async () => {
    renderViewer(fileArtifact({ name: "pic.png", mime_type: "image/png" }));
    fireEvent.click(await screen.findByText("Replace preview with a screenshot"));
    expect(screen.getByTestId("screenshot-picker")).toBeInTheDocument();
    fireEvent.click(screen.getByText("Cancel"));
    expect(screen.getByTestId("preview-image")).toBeInTheDocument();
  });

  it("removes a screenshot and goes back to the normal preview", async () => {
    const art = fileArtifact({ name: "pic.png", mime_type: "image/png", preview_image_url: SHOT });
    let deleted = 0;
    server.use(http.delete("/api/v1/accounts/artifacts/:id/preview-image/", () => { deleted++; return HttpResponse.json({ ...art, preview_image_url: null }); }));
    renderViewer(art);
    fireEvent.click(await screen.findByText("Remove screenshot"));
    await screen.findByTestId("preview-image");
    expect(deleted).toBe(1);
    expect(screen.queryByTestId("preview-screenshot")).toBeNull();
  });

  it("does not offer screenshot controls to someone who cannot edit", async () => {
    me = { ...me!, id: 2 };
    renderViewer(fileArtifact({ name: "pic.png", mime_type: "image/png", preview_image_url: SHOT }));
    await screen.findByTestId("artifact-sidebar");
    expect(screen.queryByTestId("screenshot-controls")).toBeNull();
  });
});

// ── Sidebar: notes ────────────────────────────────────────────────────────────

const note = (over: Partial<ArtifactNote>): ArtifactNote => ({ ...mockArtifactNote, artifact: 5, ...over });

describe("notes", () => {
  const thread = [
    note({ id: 12, parent: 11, html: "<p>grand</p>", text: "grand", author: 1, author_display: "Alice", created_at: "2026-01-03T00:00:00Z", updated_at: "2026-01-03T00:00:00Z" }),
    note({ id: 11, parent: 10, html: "<p>child</p>", text: "child", author: 2, author_display: "Bob", created_at: "2026-01-02T00:00:00Z", updated_at: "2026-01-02T00:00:00Z" }),
    note({ id: 10, parent: null, html: "<p>root</p>", text: "root", author: 1, author_display: "Alice" }),
    note({ id: 9, parent: null, html: "<p>older</p>", text: "older", author: 2, author_display: "Bob", created_at: "2025-12-01T00:00:00Z", updated_at: "2025-12-01T00:00:00Z" }),
  ];
  const serve = (rows: ArtifactNote[] = thread) => server.use(http.get("/api/v1/accounts/artifact-notes/", () => page(rows)));

  it("lists the history, newest thread first, with replies nested under their parent", async () => {
    serve();
    renderViewer(fileArtifact());
    const root = await screen.findByTestId("artifact-note-10");
    expect(within(root).getByTestId("artifact-note-11")).toBeInTheDocument();
    expect(within(root).getByTestId("artifact-note-12")).toBeInTheDocument();
    const order = Array.from(document.querySelectorAll('[data-testid^="artifact-note-"]')).map((el) => el.getAttribute("data-testid"));
    expect(order.indexOf("artifact-note-10")).toBeLessThan(order.indexOf("artifact-note-9"));
    expect(screen.getByRole("tab", { name: "Notes (4)" })).toBeInTheDocument();
  });

  it("collapses and expands a chain", async () => {
    serve();
    renderViewer(fileArtifact());
    const root = await screen.findByTestId("artifact-note-10");
    fireEvent.click(within(root).getByText("Hide 2 replies"));
    expect(screen.queryByTestId("artifact-note-11")).toBeNull();
    fireEvent.click(within(root).getByText("Show 2 replies"));
    expect(screen.getByTestId("artifact-note-12")).toBeInTheDocument();
  });

  it("says when there are no notes", async () => {
    renderViewer(fileArtifact());
    expect(await screen.findByText("No notes yet.")).toBeInTheDocument();
  });

  it("adds a note with Enter and then shows the refetched list", async () => {
    let bodies: unknown[] = [];
    let rows: ArtifactNote[] = [];
    server.use(
      http.get("/api/v1/accounts/artifact-notes/", () => page(rows)),
      http.post("/api/v1/accounts/artifact-notes/", async ({ request }) => {
        const body = await request.json(); bodies.push(body);
        rows = [note({ id: 50, html: "<p>fresh</p>", text: "fresh" })];
        return HttpResponse.json(rows[0], { status: 201 });
      }),
    );
    renderViewer(fileArtifact());
    const box = await screen.findByLabelText("Add a note about this artifact…");
    fireEvent.change(box, { target: { value: "<p>fresh</p>" } });
    fireEvent.keyDown(box, { key: "Enter" });
    await screen.findByTestId("artifact-note-50");
    expect(bodies).toEqual([{ artifact: 5, html: "<p>fresh</p>", parent: null }]);
    expect((screen.getByLabelText("Add a note about this artifact…") as HTMLTextAreaElement).value).toBe("");
  });

  it("does not send an empty note", async () => {
    let posts = 0;
    server.use(http.post("/api/v1/accounts/artifact-notes/", () => { posts++; return HttpResponse.json(mockArtifactNote, { status: 201 }); }));
    renderViewer(fileArtifact());
    const box = await screen.findByLabelText("Add a note about this artifact…");
    fireEvent.keyDown(box, { key: "Enter" });
    expect(screen.getByRole("button", { name: "Add note" })).toBeDisabled();
    expect(posts).toBe(0);
  });

  it("keeps the text and tells the user when saving fails", async () => {
    server.use(http.post("/api/v1/accounts/artifact-notes/", () => HttpResponse.json({ detail: "x" }, { status: 500 })));
    renderViewer(fileArtifact());
    const box = await screen.findByLabelText("Add a note about this artifact…");
    fireEvent.change(box, { target: { value: "keep me" } });
    fireEvent.keyDown(box, { key: "Enter" });
    await waitFor(() => expect(screen.getByRole("button", { name: "Add note" })).not.toBeDisabled());
    expect((screen.getByLabelText("Add a note about this artifact…") as HTMLTextAreaElement).value).toBe("keep me");
  });

  it("replies to a note with its id as the parent", async () => {
    serve();
    let body: unknown;
    server.use(http.post("/api/v1/accounts/artifact-notes/", async ({ request }) => { body = await request.json(); return HttpResponse.json(mockArtifactNote, { status: 201 }); }));
    renderViewer(fileArtifact());
    const child = await screen.findByTestId("artifact-note-11");
    fireEvent.click(within(child).getAllByText("Reply")[0]);
    const box = within(child).getByLabelText("Write a reply…");
    fireEvent.change(box, { target: { value: "<p>answer</p>" } });
    fireEvent.keyDown(box, { key: "Enter" });
    await waitFor(() => expect(body).toEqual({ artifact: 5, html: "<p>answer</p>", parent: 11 }));
  });

  it("lets only the author edit; saving PATCHes the html", async () => {
    serve();
    let body: unknown;
    server.use(http.patch("/api/v1/accounts/artifact-notes/:id/", async ({ request, params }) => { body = { id: params.id, ...(await request.json() as object) }; return HttpResponse.json(mockArtifactNote); }));
    renderViewer(fileArtifact());
    const mine = await screen.findByTestId("artifact-note-9");
    expect(within(mine).queryByText("Edit")).toBeNull();           // Bob's note
    const own = screen.getByTestId("artifact-note-12");            // Alice's note
    fireEvent.click(within(own).getByText("Edit"));
    const box = within(own).getByLabelText("Edit note…") as HTMLTextAreaElement;
    expect(box.value).toBe("<p>grand</p>");
    fireEvent.change(box, { target: { value: "<p>changed</p>" } });
    fireEvent.keyDown(box, { key: "Enter" });
    await waitFor(() => expect(body).toEqual({ id: "12", html: "<p>changed</p>" }));
  });

  it("deletes after confirming; an Admin can delete anyone's, a member only their own", async () => {
    serve();
    const deleted: string[] = [];
    server.use(http.delete("/api/v1/accounts/artifact-notes/:id/", ({ params }) => { deleted.push(String(params.id)); return new HttpResponse(null, { status: 204 }); }));
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const { unmount } = renderViewer(fileArtifact());
    const bob = await screen.findByTestId("artifact-note-9");
    expect(within(bob).queryByText("Delete")).toBeNull();
    const alice = screen.getByTestId("artifact-note-12");
    fireEvent.click(within(alice).getByText("Delete"));
    await waitFor(() => expect(deleted).toEqual(["12"]));
    unmount();
    me = { ...me!, id: 3, access_level: "admin" };
    renderViewer(fileArtifact());
    const bob2 = await screen.findByTestId("artifact-note-9");
    expect(within(bob2).getByText("Delete")).toBeInTheDocument();
  });

  it("does not delete when the confirmation is declined", async () => {
    serve();
    let deletes = 0;
    server.use(http.delete("/api/v1/accounts/artifact-notes/:id/", () => { deletes++; return new HttpResponse(null, { status: 204 }); }));
    vi.spyOn(window, "confirm").mockReturnValue(false);
    renderViewer(fileArtifact());
    const alice = await screen.findByTestId("artifact-note-12");
    fireEvent.click(within(alice).getByText("Delete"));
    expect(deletes).toBe(0);
  });

  it("renders note HTML sanitized", async () => {
    serve([note({ id: 1, html: "<p>ok</p><img src=x onerror=alert(1)><script>alert(2)</script>", text: "ok" })]);
    renderViewer(fileArtifact());
    const el = await screen.findByTestId("artifact-note-1");
    expect(el.querySelector("script")).toBeNull();
    expect(el.querySelector("[onerror]")).toBeNull();
  });
});

// ── Action buttons on notes and comments ──────────────────────────────────────

describe("action buttons", () => {
  const serveNote = () => server.use(http.get("/api/v1/accounts/artifact-notes/", () => page([note({ id: 1, html: "<p>Send the SOW</p>", text: "Send the SOW", author: 2, author_display: "Bob" })])));

  it("every note has create action item, set reminder, create meeting and copy", async () => {
    serveNote();
    renderViewer(fileArtifact());
    const el = await screen.findByTestId("artifact-note-1");
    for (const title of ["Create action item", "Set reminder", "Create meeting"]) expect(within(el).getByTitle(title)).toBeInTheDocument();
    expect(within(el).getByLabelText("Copy text")).toBeInTheDocument();
  });

  it("an action item made from a note carries the artifact's account and a link back to it", async () => {
    serveNote();
    let created: Record<string, unknown> = {};
    let attached: Record<string, unknown> = {};
    server.use(
      http.post("/api/v1/airtable/action-items/", async ({ request }) => { created = (await request.json()) as Record<string, unknown>; return HttpResponse.json({ id: 77, task: "Send the SOW" }, { status: 201 }); }),
      http.post("/api/v1/airtable/action-items/:id/attachments/", async ({ request }) => { attached = (await request.json()) as Record<string, unknown>; return HttpResponse.json({ id: 1 }, { status: 201 }); }),
    );
    renderViewer(fileArtifact({ account: 3, name: "Pricing deck" }), { accountName: "Acme", airtableAccountId: 9 });
    const el = await screen.findByTestId("artifact-note-1");
    fireEvent.click(within(el).getByTitle("Create action item"));
    fireEvent.click(await screen.findByRole("button", { name: "Create Action Item" }));
    await waitFor(() => expect(attached).toMatchObject({ source_artifact: 5 }));
    expect(created).toMatchObject({ task: "Send the SOW", account: 9, account_name: "Acme" });
    expect(String(created.task_details)).toContain("From artifact: Pricing deck");
    expect(created.references).toEqual([expect.objectContaining({ resource_type: "artifact", resource_id: 5, label: "Pricing deck" })]);
    // …and the sidebar now lists it under "Used in".
    await waitFor(() => expect(screen.getByTestId("artifact-details")).toHaveTextContent("Send the SOW"));
  });

  it("a reminder made from a note links to the artifact and shows up under Used in", async () => {
    serveNote();
    let body: Record<string, unknown> = {};
    server.use(http.post("/api/v1/scheduler/reminders/", async ({ request }) => { body = (await request.json()) as Record<string, unknown>; return HttpResponse.json({ id: 31 }, { status: 201 }); }));
    renderViewer(fileArtifact({ name: "Pricing deck" }));
    const el = await screen.findByTestId("artifact-note-1");
    fireEvent.click(within(el).getByTitle("Set reminder"));
    fireEvent.click(await screen.findByRole("button", { name: "Set Reminder" }));
    await waitFor(() => expect(body.links).toEqual([{ resource_type: "artifact", resource_id: 5, resource_label: "Pricing deck" }]));
    expect(body).not.toHaveProperty("resource_type");
    expect(String(body.body)).toContain("From artifact: Pricing deck");
    await waitFor(() => expect(screen.getByTestId("artifact-details")).toHaveTextContent("Reminders"));
  });

  it("a meeting made from a note is linked to the artifact and its account", async () => {
    serveNote();
    let body: Record<string, unknown> = {};
    server.use(http.post("/api/v1/scheduler/events/", async ({ request }) => { body = (await request.json()) as Record<string, unknown>; return HttpResponse.json({ id: 88 }, { status: 201 }); }));
    renderViewer(fileArtifact({ account: 3 }));
    const el = await screen.findByTestId("artifact-note-1");
    fireEvent.click(within(el).getByTitle("Create meeting"));
    fireEvent.click(await screen.findByRole("button", { name: "Create Meeting" }));
    await waitFor(() => expect(body).toMatchObject({ artifact_ids: [5], account: 3 }));
  });

  it("comments, and replies to them, have the same buttons", async () => {
    const reply: Comment = { ...mockComment, id: 2, parent: 1, content: "Agreed", author_display: "Bob", replies: [] };
    server.use(http.get("/api/v1/comments/comments/", () => HttpResponse.json({ results: [{ ...mockComment, resource_type: "artifact", resource_id: 5, replies: [reply] }], count: 1 })));
    renderViewer(fileArtifact());
    fireEvent.click(await screen.findByRole("tab", { name: /Comments/ }));
    await screen.findByText("This needs more context.");
    expect(screen.getAllByTitle("Create action item")).toHaveLength(2);
    expect(screen.getAllByTitle("Set reminder")).toHaveLength(2);
    expect(screen.getAllByTitle("Create meeting")).toHaveLength(2);
    expect(screen.getAllByLabelText("Copy text")).toHaveLength(2);
  });

  it("an action item made from a comment says it came from the artifact", async () => {
    server.use(http.get("/api/v1/comments/comments/", () => HttpResponse.json({ results: [{ ...mockComment, resource_type: "artifact", resource_id: 5 }], count: 1 })));
    let created: Record<string, unknown> = {};
    server.use(http.post("/api/v1/airtable/action-items/", async ({ request }) => { created = (await request.json()) as Record<string, unknown>; return HttpResponse.json({ id: 78, task: "x" }, { status: 201 }); }));
    renderViewer(fileArtifact({ name: "Pricing deck" }), { accountName: "Acme" });
    fireEvent.click(await screen.findByRole("tab", { name: /Comments/ }));
    await screen.findByText("This needs more context.");
    fireEvent.click(screen.getByTitle("Create action item"));
    fireEvent.click(await screen.findByRole("button", { name: "Create Action Item" }));
    await waitFor(() => expect(created).toMatchObject({ task: "This needs more context.", account_name: "Acme" }));
    expect(String(created.task_details)).toContain("From artifact: Pricing deck");
  });
});

// ── Sidebar: comments and linked records ──────────────────────────────────────

describe("comments", () => {
  it("lists the artifact's comment thread and posts a new one on the artifact", async () => {
    let posted: Record<string, unknown> = {};
    server.use(
      http.get("/api/v1/comments/comments/", ({ request }) => {
        const url = new URL(request.url);
        expect(url.searchParams.get("resource_type")).toBe("artifact");
        expect(url.searchParams.get("resource_id")).toBe("5");
        return HttpResponse.json({ results: [{ ...mockComment, resource_type: "artifact", resource_id: 5 }], count: 1 });
      }),
      http.post("/api/v1/comments/comments/", async ({ request }) => { posted = (await request.json()) as Record<string, unknown>; return HttpResponse.json(mockComment, { status: 201 }); }),
    );
    renderViewer(fileArtifact({ name: "Pricing deck" }));
    fireEvent.click(await screen.findByRole("tab", { name: /Comments/ }));
    await screen.findByText("This needs more context.");
    const box = screen.getByPlaceholderText("Add a comment…");
    fireEvent.change(box, { target: { value: "Looks right" } });
    fireEvent.keyDown(box, { key: "Enter" });
    await waitFor(() => expect(posted).toMatchObject({ resource_type: "artifact", resource_id: 5, content: "Looks right", parent: null, resource_label: "Pricing deck" }));
  });

  it("shows the comment count on the tab", async () => {
    server.use(http.get("/api/v1/comments/comments/summary/", () => HttpResponse.json({ results: { "5": { count: 3, comments: [] } } })));
    renderViewer(fileArtifact());
    expect(await screen.findByRole("tab", { name: "Comments (3)" })).toBeInTheDocument();
  });
});

describe("linked records", () => {
  it("lists every record the artifact is used in, reminders included, each as a link", async () => {
    renderViewer(fileArtifact({
      used_in: [
        { resource_type: "calendar_event", resource_id: 1, label: "Kickoff", url: "/calendar" },
        { resource_type: "reminder", resource_id: 2, label: "Follow up with Acme", url: "/reminders" },
        { resource_type: "action_item", resource_id: 3, label: "Send SOW", url: "/action-items" },
        { resource_type: "project", resource_id: 4, label: "Rollout", url: "/accounts/1" },
      ],
    }));
    const details = screen.getByTestId("artifact-details");
    for (const text of ["Used in", "Meetings", "Kickoff", "Reminders", "Follow up with Acme", "Action items", "Send SOW", "Projects", "Rollout"]) {
      expect(details).toHaveTextContent(text);
    }
    expect(within(details).getByTitle("Open Follow up with Acme")).toBeInTheDocument();
  });
});
