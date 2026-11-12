import { describe, it, expect } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import { http } from "msw";
import { server } from "../../../test/msw-server";
import { mockAgentSkill, mockPagePin, pagePinsFor } from "../../../test/handlers/skills";
import PageBuilder from "../PageBuilder";
import { ExportProvider } from "../../../context/ExportContext";

const renderBuilder = () => render(<ExportProvider><PageBuilder /></ExportProvider>);

describe("Layouts page — Claude Skills section", () => {
  it("is always there, even with an empty canvas (no Layers yet)", async () => {
    renderBuilder();
    expect(screen.queryByText("Layers")).not.toBeInTheDocument();            // empty canvas: no Layers block…
    expect(await screen.findByTestId("layouts-skills-section")).toBeInTheDocument();   // …but the skills section remains
  });

  it("sits in the right sidebar", async () => {
    renderBuilder();
    const section = await screen.findByTestId("layouts-skills-section");
    expect(section.parentElement).toHaveClass("border-l");
    expect(section.parentElement).toHaveClass("w-64");
  });

  it("is closed by default and opens on demand to list the pinned skills", async () => {
    server.use(pagePinsFor("layouts", [mockPagePin({ page: "layouts", skill: mockAgentSkill({ id: 1, name: "weekly-update" }) })]));
    renderBuilder();
    const section = await screen.findByTestId("layouts-skills-section");
    const toggle = await within(section).findByRole("button", { name: /Claude Skills \(1\)/ });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(within(section).queryByRole("button", { name: /^Weekly Update/ })).not.toBeInTheDocument();
    fireEvent.click(toggle);
    expect(within(section).getByRole("button", { name: /^Weekly Update/ })).toBeInTheDocument();
  });

  it("is placed below the Layers block when there are layers", async () => {
    renderBuilder();
    const section = await screen.findByTestId("layouts-skills-section");
    const sidebar = section.parentElement as HTMLElement;
    expect(sidebar.lastElementChild).toBe(section);                            // the last thing in the sidebar
  });

  it("does not request pins for any other page", async () => {
    const pages: string[] = [];
    server.use(http.get("/api/v1/skills/page-pins/", ({ request }) => {
      pages.push(new URL(request.url).searchParams.get("page") ?? "");
      return Response.json({ results: [] });
    }));
    renderBuilder();
    await screen.findByTestId("layouts-skills-section");
    await new Promise((r) => setTimeout(r, 50));
    expect(new Set(pages)).toEqual(new Set(["layouts"]));
  });

  it("is pinned outside the sidebar's scrolling area, so it never needs a scroll to reach", async () => {
    renderBuilder();
    const section = await screen.findByTestId("layouts-skills-section");
    const sidebar = section.parentElement as HTMLElement;
    expect(sidebar).toHaveClass("overflow-hidden");
    expect(section).toHaveClass("shrink-0");
    expect(section.previousElementSibling).toHaveClass("overflow-y-auto");     // the inspector scrolls; this doesn't
  });

  it("fills the space the shell gives it, instead of a fixed viewport height the footer overlaps", async () => {
    const { container, rerender } = renderBuilder();
    await screen.findByTestId("layouts-skills-section");
    const root = () => container.querySelector('[style*="height"]') as HTMLElement;
    expect(root().style.height).toContain("100vh");                           // embedded use keeps its old height
    rerender(<ExportProvider><PageBuilder fillParent /></ExportProvider>);
    expect(root().style.height).toBe("100%");
  });
});
