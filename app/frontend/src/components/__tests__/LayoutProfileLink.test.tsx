import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { http, HttpResponse } from "msw";
import { server } from "../../test/msw-server";
import Layout from "../Layout";
import { FeedbackProvider } from "../../context/FeedbackContext";
import { ExportProvider } from "../../context/ExportContext";
import { AppErrorProvider } from "../../context/AppErrorContext";
import { CurrentUserProvider } from "../../context/CurrentUserContext";

// Sidebar icons are SVG imports (`?react`), which the test transform cannot do.
vi.mock("../../assets/icons/Calendar.svg?react", () => ({ default: () => null }));
vi.mock("../../assets/icons/Conversation.svg?react", () => ({ default: () => null }));
vi.mock("../../assets/icons/Team.svg?react", () => ({ default: () => null }));
vi.mock("../../assets/icons/Corporate.svg?react", () => ({ default: () => null }));
vi.mock("../../assets/icons/Checklist.svg?react", () => ({ default: () => null }));
vi.mock("../../assets/icons/Settings.svg?react", () => ({ default: () => null }));
vi.mock("../../assets/icons/Notification.svg?react", () => ({ default: () => null }));
vi.mock("../../assets/icons/Code.svg?react", () => ({ default: () => null }));
vi.mock("../../assets/icons/Schedule.svg?react", () => ({ default: () => null }));
vi.mock("../../assets/icons/Innovation.svg?react", () => ({ default: () => null }));
vi.mock("../../assets/icons/Structure.svg?react", () => ({ default: () => null }));

beforeEach(() => {
  // Layout also asks for lifetime token counts; answer with zero so nothing is unhandled.
  server.use(
    http.get("*/api/v1/agents/sessions/token-stats/", () => HttpResponse.json({ total_tokens: 0 })),
    http.get("*/api/v1/skills/skills/token-stats/", () => HttpResponse.json({ total_tokens: 0 })),
  );
  // Layout's theme hook reads prefers-color-scheme; jsdom has no matchMedia.
  window.matchMedia = (query: string) => ({
    matches: false, media: query, onchange: null,
    addEventListener: () => {}, removeEventListener: () => {}, addListener: () => {}, removeListener: () => {},
    dispatchEvent: () => false,
  }) as unknown as MediaQueryList;
});

function renderLayout() {
  return render(
    <MemoryRouter initialEntries={["/accounts"]}>
      <AppErrorProvider>
        <CurrentUserProvider>
          <FeedbackProvider>
            <ExportProvider>
              <Layout />
            </ExportProvider>
          </FeedbackProvider>
        </CurrentUserProvider>
      </AppErrorProvider>
    </MemoryRouter>,
  );
}

const profileLink = () => document.querySelector('a[href="/profile"]') as HTMLAnchorElement | null;
const me = { id: 1, email: "a@b.c", username: "alice", is_staff: false, display_name: "Alice Example", title: "Solutions Architect" };

describe("sidebar profile link", () => {
  it("shows the user's name once the profile loads", async () => {
    server.use(http.get("*/api/v1/team/profiles/me/", () => HttpResponse.json(me)));
    renderLayout();
    expect(await screen.findByText("Alice Example")).toBeInTheDocument();
    expect(profileLink()).not.toBeNull();
  });

  it("is still on the page when the profile request fails", async () => {
    server.use(http.get("*/api/v1/team/profiles/me/", () => new HttpResponse(null, { status: 500 })));
    renderLayout();
    await waitFor(() => expect(profileLink()).not.toBeNull());
    expect(profileLink()?.textContent).toContain("Profile");
  });

  it("fills in the name after a failed first request is retried", async () => {
    let calls = 0;
    server.use(http.get("*/api/v1/team/profiles/me/", () => {
      calls++;
      return calls === 1 ? new HttpResponse(null, { status: 500 }) : HttpResponse.json(me);
    }));
    renderLayout();
    expect(await screen.findByText("Alice Example", {}, { timeout: 8000 })).toBeInTheDocument();
    expect(profileLink()).not.toBeNull();
  }, 20000);
});
