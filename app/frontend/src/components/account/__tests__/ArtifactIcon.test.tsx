import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { ArtifactIcon, fileIconKeyFor } from "../ArtifactIcon";

describe("fileIconKeyFor", () => {
  it.each([
    ["application/pdf", "plan.pdf", "file_pdf"],
    ["", "Plan.PDF", "file_pdf"],
    ["image/png", "a.png", "file_image"],
    ["video/mp4", "clip.mp4", "file_video"],
    ["audio/mpeg", "song.mp3", "file_audio"],
    ["", "data.csv", "file_sheet"],
    ["", "deck.pptx", "file_slides"],
    ["", "bundle.zip", "file_archive"],
    ["", "main.py", "file_code"],
    ["text/plain", "notes.txt", "file_text"],
    ["", "memo.docx", "file_doc"],
    ["application/octet-stream", "blob.bin", "file_upload"],
  ])("%s / %s -> %s", (mime, name, expected) => {
    expect(fileIconKeyFor(mime, name)).toBe(expected);
  });
});

describe("ArtifactIcon precedence", () => {
  it("uses the uploaded image over everything else", () => {
    const { container } = render(
      <ArtifactIcon artifactType="link" mime="" name="Brand" url="https://slack.com/x" iconKey="slack" imageUrl="http://x/img.png" />,
    );
    expect(container.querySelector("img")!.getAttribute("src")).toBe("http://x/img.png");
  });

  it("falls back to the site's favicon for an unrecognised link", () => {
    const { container } = render(
      <ArtifactIcon artifactType="link" mime="" name="Wiki" url="https://wiki.acme-corp.io/page" iconKey="link" />,
    );
    expect(container.querySelector("img")!.getAttribute("src")).toContain("favicons?sz=32&domain=wiki.acme-corp.io");
  });

  it("also uses the favicon when no icon key is stored", () => {
    const { container } = render(<ArtifactIcon artifactType="link" mime="" name="Wiki" url="https://example.org" iconKey="" />);
    expect(container.querySelector("img")!.getAttribute("src")).toContain("domain=example.org");
  });

  it("keeps a recognised service icon rather than a generic favicon", () => {
    const { container } = render(<ArtifactIcon artifactType="link" mime="" name="S" url="https://acme.slack.com/x" iconKey="slack" />);
    expect(container.querySelector("img")!.getAttribute("src")).toContain("domain=slack.com");
  });

  it("shows the link emoji when there is no usable url", () => {
    const { container } = render(<ArtifactIcon artifactType="link" mime="" name="x" url="not a url" iconKey="link" />);
    expect(container.querySelector("img")).toBeNull();
    expect(container.textContent).toBe("🔗");
  });

  it("does not request a favicon for non-http schemes", () => {
    const { container } = render(<ArtifactIcon artifactType="link" mime="" name="x" url="javascript:alert(1)" iconKey="link" />);
    expect(container.querySelector("img")).toBeNull();
  });

  it("honours the file-type icon the user chose for a file", () => {
    const { container } = render(<ArtifactIcon artifactType="file" mime="application/pdf" name="a.pdf" iconKey="file_code" />);
    expect(container.textContent).toBe("</>");
  });

  it("guesses a file icon from the type when none was chosen", () => {
    const { container } = render(<ArtifactIcon artifactType="file" mime="application/pdf" name="a.pdf" iconKey="" />);
    expect(container.textContent).toBe("📕");
  });
});
