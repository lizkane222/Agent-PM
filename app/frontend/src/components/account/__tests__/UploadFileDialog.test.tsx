import { describe, it, expect, vi, beforeAll } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import { UploadFileDialog } from "../UploadFileDialog";

// jsdom has no object URLs; the image field previews a picked file with one.
beforeAll(() => {
  URL.createObjectURL = vi.fn(() => "blob:preview");
  URL.revokeObjectURL = vi.fn();
});

const pdf = new File(["x"], "plan.pdf", { type: "application/pdf" });
const sheet = new File(["x"], "data.csv", { type: "text/csv" });

describe("UploadFileDialog", () => {
  it("preselects an icon per file from its type", () => {
    render(<UploadFileDialog files={[pdf, sheet]} onCancel={vi.fn()} onConfirm={vi.fn()} />);
    expect(screen.getByTestId("upload-icon-0-file_pdf")).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByTestId("upload-icon-1-file_sheet")).toHaveAttribute("aria-pressed", "true");
  });

  it("lets the user pick a different icon and confirms with the choices", () => {
    const onConfirm = vi.fn();
    render(<UploadFileDialog files={[pdf, sheet]} onCancel={vi.fn()} onConfirm={onConfirm} />);
    fireEvent.click(screen.getByTestId("upload-icon-0-file_slides"));
    expect(screen.getByTestId("upload-icon-0-file_slides")).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByTestId("upload-icon-0-file_pdf")).toHaveAttribute("aria-pressed", "false");

    fireEvent.click(screen.getByRole("button", { name: "Upload" }));
    const uploads = onConfirm.mock.calls[0][0];
    expect(uploads.map((u: { iconKey: string }) => u.iconKey)).toEqual(["file_slides", "file_sheet"]);
    expect(uploads[0].file).toBe(pdf);
    expect(uploads[0].image).toBeNull();
  });

  it("attaches an optional image to a single file", () => {
    const onConfirm = vi.fn();
    render(<UploadFileDialog files={[pdf]} onCancel={vi.fn()} onConfirm={onConfirm} />);
    const img = new File(["png"], "cover.png", { type: "image/png" });
    fireEvent.change(within(screen.getByTestId("upload-row-0")).getByTestId("artifact-image-input"), { target: { files: [img] } });
    fireEvent.click(screen.getByRole("button", { name: "Upload" }));
    expect(onConfirm.mock.calls[0][0][0].image).toBe(img);
  });

  it("cancel confirms nothing", () => {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    render(<UploadFileDialog files={[pdf]} onCancel={onCancel} onConfirm={onConfirm} />);
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onCancel).toHaveBeenCalled();
    expect(onConfirm).not.toHaveBeenCalled();
  });
});
