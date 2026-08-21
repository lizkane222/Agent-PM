import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import PageBuilder from "../PageBuilder";
import { ExportProvider } from "../../../context/ExportContext";
import { CANVAS_DRAFT_KEY } from "../useCanvasState";
import type { CanvasNode } from "../types";

// html-to-image touches canvas APIs jsdom doesn't implement; the export *scoping*
// is what these tests are about, not the rasteriser.
vi.mock("html-to-image", () => ({
  toPng: vi.fn(async () => "data:image/png;base64,stub"),
  toJpeg: vi.fn(async () => "data:image/jpeg;base64,stub"),
}));

function node(id: string, type: string, props: Record<string, unknown> = {}, children: CanvasNode[] = []): CanvasNode {
  return { id, type, props, children };
}

const sheet = (id: string, label: string, children: CanvasNode[] = []) =>
  node(id, "Page", { label, locked: false, x: 0, y: 0, width: 816, height: 1056 }, children);

function seed(nodes: CanvasNode[]) {
  localStorage.setItem(CANVAS_DRAFT_KEY, JSON.stringify(nodes));
}

async function openExport(nodes: CanvasNode[]) {
  seed(nodes);
  render(<ExportProvider><PageBuilder /></ExportProvider>);
  fireEvent.click(screen.getByRole("button", { name: /export/i }));
  return await screen.findByText("Export Canvas Content");
}

/**
 * Capture what a Blob download would have written.
 *
 * jsdom's Blob has no `.text()` and no `URL.createObjectURL` at all, so the
 * contents are recorded at construction time by subclassing Blob. That also keeps
 * the whole capture synchronous, matching the sync click handler.
 */
function captureDownloads() {
  const files: { name: string; body: string }[] = [];
  const blobs = new Map<string, string>();
  const origCreate = URL.createObjectURL;
  const origRevoke = URL.revokeObjectURL;
  const OrigBlob = globalThis.Blob;
  let n = 0;

  class TextBlob extends OrigBlob {
    readonly recordedText: string;
    constructor(parts: BlobPart[] = [], opts?: BlobPropertyBag) {
      super(parts, opts);
      this.recordedText = parts.map((p) => String(p)).join("");
    }
  }
  globalThis.Blob = TextBlob as unknown as typeof Blob;

  URL.createObjectURL = ((blob: Blob) => {
    const url = `blob:stub-${n++}`;
    blobs.set(url, (blob as TextBlob).recordedText ?? "");
    return url;
  }) as typeof URL.createObjectURL;
  URL.revokeObjectURL = (() => {}) as typeof URL.revokeObjectURL;

  const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
    files.push({ name: this.download, body: blobs.get(this.href) ?? "" });
  });

  return {
    files,
    restore() {
      URL.createObjectURL = origCreate;
      URL.revokeObjectURL = origRevoke;
      globalThis.Blob = OrigBlob;
      clickSpy.mockRestore();
    },
  };
}

describe("CanvasExportModal scopes", () => {
  beforeEach(() => localStorage.clear());

  it("opens from the toolbar", async () => {
    await openExport([sheet("p1", "Cover")]);
    expect(screen.getByText("Export Canvas Content")).toBeInTheDocument();
  });

  it("lists a row per page", async () => {
    await openExport([sheet("p1", "Cover"), sheet("p2", "Details")]);
    expect(screen.getByText("Cover")).toBeInTheDocument();
    expect(screen.getByText("Details")).toBeInTheDocument();
  });

  it("offers All pages once there is more than one", async () => {
    await openExport([sheet("p1", "Cover"), sheet("p2", "Details")]);
    expect(screen.getByText(/All pages/i)).toBeInTheDocument();
    expect(screen.getByText(/2 pages/i)).toBeInTheDocument();
  });

  it("does not offer All pages for a single page", async () => {
    await openExport([sheet("p1", "Cover")]);
    expect(screen.queryByText(/All pages/i)).not.toBeInTheDocument();
  });

  it("says plainly that the cloud destinations aren't available", async () => {
    // They POST to endpoints that don't exist in the backend; a button that 404s
    // silently is worse than one that explains itself.
    await openExport([sheet("p1", "Cover")]);
    expect(screen.getByText(/isn’t available yet/i)).toBeInTheDocument();
  });
});

describe("text exports", () => {
  let dl: ReturnType<typeof captureDownloads>;

  beforeEach(() => {
    localStorage.clear();
    dl = captureDownloads();
  });
  afterEach(() => dl.restore());

  const withContent = () => [
    sheet("p1", "Q3 Review", [
      node("h", "Heading", { text: "Highlights", level: 2, x: 10, y: 10 }),
      node("t", "Text", { text: "Renewal is on track.", x: 10, y: 60 }),
    ]),
  ];

  it("writes a Markdown file named after the page", async () => {
    await openExport(withContent());
    fireEvent.click(screen.getByRole("button", { name: "Markdown" }));

    expect(dl.files).toHaveLength(1);
    expect(dl.files[0].name).toBe("q3-review.md");
  });

  it("includes the page name and its nested content in the Markdown", async () => {
    await openExport(withContent());
    fireEvent.click(screen.getByRole("button", { name: "Markdown" }));

    const body = dl.files[0].body;
    expect(body).toContain("# Q3 Review");
    expect(body).toContain("Highlights");
    expect(body).toContain("Renewal is on track.");
  });

  it("writes an HTML file too", async () => {
    await openExport(withContent());
    fireEvent.click(screen.getByRole("button", { name: "HTML" }));

    expect(dl.files[0].name).toBe("q3-review.html");
    expect(dl.files[0].body).toContain("Renewal is on track.");
  });

  it("covers every page when the scope is All pages", async () => {
    await openExport([
      sheet("p1", "Cover", [node("a", "Text", { text: "first sheet" })]),
      sheet("p2", "Appendix", [node("b", "Text", { text: "second sheet" })]),
    ]);
    fireEvent.click(screen.getByLabelText?.(/All pages/i) ?? screen.getByText(/All pages/i));
    fireEvent.click(screen.getByRole("button", { name: "Markdown" }));

    const body = dl.files[0].body;
    expect(body).toContain("# Cover");
    expect(body).toContain("first sheet");
    expect(body).toContain("# Appendix");
    expect(body).toContain("second sheet");
  });

  it("includes a dropped record's full detail", async () => {
    await openExport([
      sheet("p1", "Notes", [
        node("r", "RecordCard", {
          recordTitle: "SOC2 evidence request",
          typeLabel: "Action Item",
          accountName: "Acme Corp",
          summary: "Blocking the renewal.",
          x: 10, y: 10,
        }),
      ]),
    ]);
    fireEvent.click(screen.getByRole("button", { name: "Markdown" }));

    const body = dl.files[0].body;
    expect(body).toContain("SOC2 evidence request");
    expect(body).toContain("Acme Corp");
    expect(body).toContain("Blocking the renewal.");
  });
});

describe("image export", () => {
  beforeEach(() => localStorage.clear());

  it("writes one image per page for All pages", async () => {
    const clicked: string[] = [];
    const spy = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
      clicked.push(this.download);
    });

    await openExport([sheet("p1", "Cover"), sheet("p2", "Appendix")]);
    fireEvent.click(screen.getByText(/All pages/i));
    fireEvent.click(screen.getByRole("button", { name: /PNG/i }));

    // Pages live on a zero-size transform layer, so there is no single element
    // containing them all — "all pages" has to be one file each.
    await waitFor(() => expect(clicked).toEqual(["cover.png", "appendix.png"]));
    spy.mockRestore();
  });
});
