import { describe, it, expect } from "vitest";
import { classifyArtifact, extensionOf } from "../artifactPreview/classify";
import { googleEmbedUrl } from "../artifactPreview/LinkPreview";
import { buildNoteTree } from "../ArtifactNotesPanel";
import { mockArtifact, mockArtifactNote } from "../../../test/handlers/accounts";
import type { AccountArtifact } from "../../../types";

const file = (name: string, mime = "", over: Partial<AccountArtifact> = {}): AccountArtifact => ({
  ...mockArtifact, artifact_type: "file", name, mime_type: mime, url: null, file_url: `http://x/${name}`, ...over,
});

describe("classifyArtifact", () => {
  it.each([
    ["a.png", "image/png", "image"],
    ["logo.svg", "", "image"],
    ["scan.PDF", "", "pdf"],
    ["a.pdf", "application/pdf", "pdf"],
    ["a.mp4", "video/mp4", "video"],
    ["a.mov", "", "video"],
    ["a.mp3", "audio/mpeg", "audio"],
    ["a.flac", "", "audio"],
    ["notes.txt", "text/plain", "remote"],
    ["plan.docx", "", "remote"],
    ["sheet.xlsx", "", "remote"],
    ["deck.pptx", "", "remote"],
    ["a.zip", "application/zip", "remote"],
    ["mystery", "application/octet-stream", "remote"],
  ])("%s (%s) -> %s", (name, mime, mode) => {
    expect(classifyArtifact(file(name, mime))).toBe(mode);
  });

  it("treats a URL artifact as a link and a file with no URL as a link", () => {
    expect(classifyArtifact(mockArtifact)).toBe("link");
    expect(classifyArtifact(file("a.png", "image/png", { file_url: null }))).toBe("link");
  });

  it("a user's screenshot beats every other type", () => {
    expect(classifyArtifact(file("a.pdf", "application/pdf", { preview_image_url: "http://x/s.png" }))).toBe("screenshot");
    expect(classifyArtifact({ ...mockArtifact, preview_image_url: "http://x/s.png" })).toBe("screenshot");
  });

  it("extensionOf", () => {
    expect(extensionOf("a.b.TXT")).toBe("txt");
    expect(extensionOf("noext")).toBe("");
  });
});

describe("googleEmbedUrl", () => {
  it.each([
    ["https://docs.google.com/document/d/abc/edit?usp=sharing", "https://docs.google.com/document/d/abc/preview"],
    ["https://docs.google.com/spreadsheets/d/abc/edit#gid=0", "https://docs.google.com/spreadsheets/d/abc/preview"],
    ["https://docs.google.com/presentation/d/abc/edit", "https://docs.google.com/presentation/d/abc/preview"],
    ["https://drive.google.com/file/d/abc/view", "https://drive.google.com/file/d/abc/preview"],
  ])("%s", (input, out) => expect(googleEmbedUrl(input)).toBe(out));

  it("refuses anything else, including look-alike hosts and plain http", () => {
    for (const u of ["https://evil.example.com/document/d/abc", "https://docs.google.com.evil.com/document/d/abc", "http://docs.google.com/document/d/abc", "https://docs.google.com/forms/d/abc", "not a url"]) {
      expect(googleEmbedUrl(u)).toBeNull();
    }
  });
});

describe("buildNoteTree", () => {
  const n = (id: number, parent: number | null, created: string) => ({ ...mockArtifactNote, id, parent, created_at: created });
  it("keeps the server's root order and puts replies oldest first, to any depth", () => {
    const tree = buildNoteTree([n(4, 1, "2026-01-04"), n(3, null, "2026-01-03"), n(2, 1, "2026-01-02"), n(1, null, "2026-01-01"), n(5, 2, "2026-01-05")]);
    expect(tree.map((t) => t.note.id)).toEqual([3, 1]);
    expect(tree[1].replies.map((t) => t.note.id)).toEqual([2, 4]);
    expect(tree[1].replies[0].replies.map((t) => t.note.id)).toEqual([5]);
  });
  it("shows a reply whose parent is gone as a root instead of losing it", () => {
    expect(buildNoteTree([n(7, 99, "2026-01-01")]).map((t) => t.note.id)).toEqual([7]);
  });
});
