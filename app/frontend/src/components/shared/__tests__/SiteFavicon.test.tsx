import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import SiteFavicon, { httpOrigin, safeHttpUrl } from "../SiteFavicon";

describe("SiteFavicon", () => {
  it("uses the bundled icon for a recognised service, never a third-party favicon service", () => {
    render(<SiteFavicon url="https://docs.google.com/document/d/abc" name="Doc" />);
    const img = screen.getByTestId("site-favicon") as HTMLImageElement;
    expect(img.dataset.source).toBe("service");
    expect(img.src).toContain("gstatic.com");
    expect(img.src).not.toContain("google.com/s2");
  });

  it("uses the site's own /favicon.ico otherwise (even for an internal host)", () => {
    render(<SiteFavicon url="https://wiki.corp.internal/page/1" name="Wiki" />);
    const img = screen.getByTestId("site-favicon") as HTMLImageElement;
    expect(img.dataset.source).toBe("site");
    expect(img.src).toBe("https://wiki.corp.internal/favicon.ico");
  });

  it("falls back from the bundled icon to the site's favicon, then to a letter tile", () => {
    render(<SiteFavicon url="https://docs.google.com/spreadsheets/d/x" name="Budget" />);
    fireEvent.error(screen.getByTestId("site-favicon"));
    expect((screen.getByTestId("site-favicon") as HTMLImageElement).src).toBe("https://docs.google.com/favicon.ico");
    fireEvent.error(screen.getByTestId("site-favicon"));
    expect(screen.queryByTestId("site-favicon")).toBeNull();
    expect(screen.getByTestId("site-favicon-fallback").textContent).toBe("B");
  });

  it("shows the provided fallback when the image fails", () => {
    render(<SiteFavicon url="https://example.com" name="X" fallback={<span>TYPE-ICON</span>} />);
    fireEvent.error(screen.getByTestId("site-favicon"));
    expect(screen.getByText("TYPE-ICON")).toBeInTheDocument();
  });

  it("never requests anything for a non-http(s) url", () => {
    for (const url of ["javascript:alert(1)", "data:text/html,hi", "ftp://x.example.com", "not a url", "", null, undefined]) {
      const { container, unmount } = render(<SiteFavicon url={url} name="Thing" />);
      expect(container.querySelector("img")).toBeNull();
      expect(screen.getByTestId("site-favicon-fallback").textContent).toBe("T");
      unmount();
    }
  });

  it("helpers accept only http(s)", () => {
    expect(httpOrigin("https://a.example.com/x?y=1")).toBe("https://a.example.com");
    expect(httpOrigin("javascript:alert(1)")).toBeNull();
    expect(safeHttpUrl("http://a.example.com")).toBe("http://a.example.com");
    expect(safeHttpUrl("javascript:alert(1)")).toBeNull();
  });
});
