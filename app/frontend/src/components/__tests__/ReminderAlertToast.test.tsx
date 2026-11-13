import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import ReminderAlertToast from "../ReminderAlertToast";
import type { SnoozeRequest } from "../calendar/ReminderSnoozeMenu";
import { mockNotification } from "../../test/handlers/profile";
import type { AppNotification } from "../../types/team";

const n = (id: number, over: Partial<AppNotification> = {}) =>
  mockNotification({ id, title: "⏰ Prep QBR", body: "Slides", reminder: 5, can_snooze: true, ...over });

type Snooze = (n: AppNotification, r: SnoozeRequest) => Promise<string | null>;

function setup(alerts: AppNotification[], onSnooze: ReturnType<typeof vi.fn<Snooze>> = vi.fn<Snooze>(async () => null)) {
  const onAcknowledge = vi.fn();
  render(
    <MemoryRouter initialEntries={["/"]}>
      <Routes>
        <Route path="/" element={<ReminderAlertToast alerts={alerts} onAcknowledge={onAcknowledge} onSnooze={onSnooze} />} />
        <Route path="/reminders" element={<p>Reminders page</p>} />
      </Routes>
    </MemoryRouter>,
  );
  return { onAcknowledge, onSnooze };
}

describe("ReminderAlertToast", () => {
  it("renders nothing when nothing is waiting", () => {
    setup([]);
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("shows the reminder's title and details", () => {
    setup([n(1)]);
    expect(screen.getByRole("alert")).toHaveTextContent("⏰ Prep QBR");
    expect(screen.getByRole("alert")).toHaveTextContent("Slides");
  });

  it("stays on screen: it never times out and has no close button", () => {
    vi.useFakeTimers();
    setup([n(1)]);
    vi.advanceTimersByTime(60 * 60_000);
    expect(screen.getByRole("alert")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /close|dismiss|×/i })).toBeNull();
    vi.useRealTimers();
  });

  it("Acknowledge answers that alert only", () => {
    const { onAcknowledge } = setup([n(1), n(2, { title: "⏰ Other" })]);
    fireEvent.click(screen.getAllByRole("button", { name: "Acknowledge" })[1]);
    expect(onAcknowledge).toHaveBeenCalledWith(2);
  });

  it("View goes to the reminder without answering the alert", () => {
    const { onAcknowledge } = setup([n(1)]);
    fireEvent.click(screen.getByRole("button", { name: "View" }));
    expect(screen.getByText("Reminders page")).toBeInTheDocument();
    expect(onAcknowledge).not.toHaveBeenCalled();
  });

  it("Snooze opens the same menu as the sidebar, Custom first", () => {
    setup([n(1)]);
    fireEvent.click(screen.getByRole("button", { name: "Snooze" }));
    const menu = screen.getByRole("menu", { name: "Snooze until" });
    expect(within(menu).getAllByRole("menuitem").map((b) => b.querySelector("span")?.textContent ?? b.textContent)[0]).toBe("Custom…");
    expect(within(menu).getByRole("menuitem", { name: /15 minutes later/ })).toBeInTheDocument();
  });

  it("choosing a time snoozes that reminder and closes the menu", async () => {
    const { onSnooze } = setup([n(1)]);
    fireEvent.click(screen.getByRole("button", { name: "Snooze" }));
    fireEvent.click(within(screen.getByRole("menu")).getByRole("menuitem", { name: /15 minutes later/ }));
    await waitFor(() => expect(onSnooze).toHaveBeenCalledTimes(1));
    expect(onSnooze.mock.calls[0][0].id).toBe(1);
    expect(onSnooze.mock.calls[0][1]).toHaveProperty("until");
    await waitFor(() => expect(screen.queryByRole("menu")).toBeNull());
  });

  it("a refused snooze shows why and keeps the menu open", async () => {
    setup([n(1)], vi.fn<Snooze>(async () => "There is no upcoming meeting on this account to snooze it before."));
    fireEvent.click(screen.getByRole("button", { name: "Snooze" }));
    fireEvent.click(within(screen.getByRole("menu")).getByRole("menuitem", { name: /Before next account meeting/ }));
    expect(await screen.findByText(/no upcoming meeting/)).toBeInTheDocument();
    expect(screen.getByRole("menu")).toBeInTheDocument();
  });

  it("someone notified through a teammate's reminder can acknowledge but not snooze", () => {
    setup([n(1, { can_snooze: false })]);
    expect(screen.getByRole("button", { name: "Acknowledge" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Snooze" })).toBeNull();
  });

  it("caps what is drawn but counts the rest", () => {
    setup(Array.from({ length: 7 }, (_, i) => n(i + 1)));
    expect(screen.getAllByRole("alert").filter((el) => el.textContent?.includes("Prep QBR"))).toHaveLength(5);
    expect(screen.getByText("+ 2 more waiting")).toBeInTheDocument();
  });
});
