import { describe, it, expect, vi } from "vitest";
import type React from "react";
import { isExportItemDrag, readExportItem, acceptExportItemDragOver } from "../exportDrop";
import { EXPORT_ITEM_DRAG_KEY } from "../../components/ExportBar";

const item = { id: "account:1", type: "account", label: "Acme", summary: "s", content: "c" };

/**
 * A DragEvent stand-in. jsdom has no DataTransfer, and crucially the real one
 * returns "" from getData() during dragover (protected mode) — modelled here by
 * `protectedMode`, because relying on getData() in dragover is the trap this
 * helper exists to avoid.
 */
function dragEvent({
  types = [EXPORT_ITEM_DRAG_KEY],
  data = JSON.stringify(item),
  protectedMode = false,
}: { types?: string[]; data?: string; protectedMode?: boolean } = {}) {
  const preventDefault = vi.fn();
  return {
    preventDefault,
    dataTransfer: {
      types,
      dropEffect: "none",
      getData: (key: string) => (protectedMode ? "" : key === EXPORT_ITEM_DRAG_KEY ? data : ""),
    },
  } as unknown as React.DragEvent & { preventDefault: ReturnType<typeof vi.fn> };
}

describe("isExportItemDrag", () => {
  it("recognises a tray drag from types alone, with no payload access", () => {
    expect(isExportItemDrag(dragEvent({ protectedMode: true }))).toBe(true);
  });

  it("rejects other drags", () => {
    expect(isExportItemDrag(dragEvent({ types: ["text/plain"] }))).toBe(false);
    expect(isExportItemDrag(dragEvent({ types: [] }))).toBe(false);
  });
});

describe("readExportItem", () => {
  it("parses the pill", () => {
    expect(readExportItem(dragEvent())?.label).toBe("Acme");
  });

  it("returns null for another feature's drag rather than throwing", () => {
    expect(readExportItem(dragEvent({ types: ["text/plain"], data: "" }))).toBeNull();
  });

  it("returns null on a malformed payload", () => {
    expect(readExportItem(dragEvent({ data: "{not json" }))).toBeNull();
  });

  it("returns null when the payload isn't an item", () => {
    expect(readExportItem(dragEvent({ data: JSON.stringify({ nope: 1 }) }))).toBeNull();
  });
});

describe("acceptExportItemDragOver", () => {
  it("preventDefaults for a tray drag — without which `drop` never fires", () => {
    const e = dragEvent({ protectedMode: true });
    expect(acceptExportItemDragOver(e)).toBe(true);
    expect(e.preventDefault).toHaveBeenCalled();
    expect(e.dataTransfer.dropEffect).toBe("copy");
  });

  it("leaves other drags alone so it can't hijack them", () => {
    const e = dragEvent({ types: ["application/x-other"] });
    expect(acceptExportItemDragOver(e)).toBe(false);
    expect(e.preventDefault).not.toHaveBeenCalled();
  });
});
