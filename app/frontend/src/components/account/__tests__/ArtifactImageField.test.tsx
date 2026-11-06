import { describe, it, expect, vi, beforeAll } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ArtifactImageField } from "../ArtifactImageField";

beforeAll(() => {
  URL.createObjectURL = vi.fn(() => "blob:preview");
  URL.revokeObjectURL = vi.fn();
});

function setup(props: Partial<Parameters<typeof ArtifactImageField>[0]> = {}) {
  const onPick = vi.fn();
  const onRemove = vi.fn();
  render(<ArtifactImageField file={null} removed={false} onPick={onPick} onRemove={onRemove} fallback={<span>fallback</span>} {...props} />);
  return { onPick, onRemove };
}
const input = () => screen.getByTestId("artifact-image-input");

describe("ArtifactImageField", () => {
  it("shows the fallback icon and an Upload button when there is no image", () => {
    setup();
    expect(screen.getByText("fallback")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Upload image" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Remove" })).not.toBeInTheDocument();
  });

  it("shows the saved image and offers replace/remove", () => {
    setup({ existingUrl: "http://x/saved.png" });
    expect(screen.getByTestId("artifact-image-preview")).toHaveAttribute("src", "http://x/saved.png");
    expect(screen.getByRole("button", { name: "Replace image" })).toBeInTheDocument();
  });

  it("a saved image marked removed falls back to the icon", () => {
    setup({ existingUrl: "http://x/saved.png", removed: true });
    expect(screen.queryByTestId("artifact-image-preview")).not.toBeInTheDocument();
    expect(screen.getByText("fallback")).toBeInTheDocument();
  });

  it("previews and reports a newly picked image", () => {
    const f = new File(["x"], "a.png", { type: "image/png" });
    const { onPick } = setup();
    fireEvent.change(input(), { target: { files: [f] } });
    expect(onPick).toHaveBeenCalledWith(f);
  });

  it("rejects an SVG or other non-raster type without calling onPick", () => {
    const { onPick } = setup();
    fireEvent.change(input(), { target: { files: [new File(["<svg/>"], "a.svg", { type: "image/svg+xml" })] } });
    expect(onPick).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent(/PNG, JPEG, GIF or WebP/);
  });

  it("rejects an image over 5 MB", () => {
    const { onPick } = setup();
    const big = new File([new Uint8Array(5 * 1024 * 1024 + 1)], "big.png", { type: "image/png" });
    fireEvent.change(input(), { target: { files: [big] } });
    expect(onPick).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent(/5 MB/);
  });

  it("Remove calls onRemove", () => {
    const { onRemove } = setup({ existingUrl: "http://x/saved.png" });
    fireEvent.click(screen.getByRole("button", { name: "Remove" }));
    expect(onRemove).toHaveBeenCalled();
  });
});
