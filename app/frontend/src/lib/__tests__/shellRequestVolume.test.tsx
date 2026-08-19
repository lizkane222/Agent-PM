/**
 * Measures the real request volume of an app-shell mount, counted at the network layer.
 *
 * This is the regression guard for the second class of 429s: duplicate volume. The shell
 * has three independent `/team/profiles/me/` callers (CurrentUserContext,
 * NotificationDefaultsContext, Layout) and `StrictMode` double-invokes every mount
 * effect in dev, so the same endpoint was requested six times in one second. The
 * throttle counts requests per minute, so spreading them out doesn't help — the
 * duplicates have to stop being sent.
 */
import React from "react";
import { describe, it, expect, beforeEach } from "vitest";
import { render, waitFor } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { server } from "../../test/msw-server";
import { teamApi } from "../api";
import { resetRequestCache } from "../requestCache";

const PROFILE_PATH = "/api/v1/team/profiles/me/";

/** Stands in for one shell component that needs the current user's profile. */
function ProfileConsumer({ label }: { label: string }) {
  const [name, setName] = React.useState("");
  React.useEffect(() => {
    teamApi.getMyProfile().then(({ data }) => setName(data.username)).catch(() => {});
  }, []);
  return <div data-testid={label}>{name}</div>;
}

describe("app-shell request volume", () => {
  let hits = 0;

  beforeEach(() => {
    hits = 0;
    resetRequestCache();
    server.use(
      http.get(PROFILE_PATH, () => {
        hits += 1;
        return HttpResponse.json({ id: 1, username: "alice" });
      })
    );
  });

  it("collapses three concurrent shell consumers into one request", async () => {
    render(
      <>
        <ProfileConsumer label="a" />
        <ProfileConsumer label="b" />
        <ProfileConsumer label="c" />
      </>
    );

    await waitFor(() => expect(hits).toBeGreaterThan(0));
    await new Promise((r) => setTimeout(r, 50));

    expect(hits).toBe(1);
  });

  it("collapses the StrictMode double-invoke as well", async () => {
    // StrictMode is enabled in main.tsx, so this is the real dev shape: three
    // components x two effect invocations = six identical requests.
    render(
      <React.StrictMode>
        <ProfileConsumer label="a" />
        <ProfileConsumer label="b" />
        <ProfileConsumer label="c" />
      </React.StrictMode>
    );

    await waitFor(() => expect(hits).toBeGreaterThan(0));
    await new Promise((r) => setTimeout(r, 50));

    expect(hits).toBe(1);
  });

  it("every consumer still receives the data", async () => {
    const { getByTestId } = render(
      <React.StrictMode>
        <ProfileConsumer label="a" />
        <ProfileConsumer label="b" />
        <ProfileConsumer label="c" />
      </React.StrictMode>
    );

    await waitFor(() => {
      expect(getByTestId("a")).toHaveTextContent("alice");
      expect(getByTestId("b")).toHaveTextContent("alice");
      expect(getByTestId("c")).toHaveTextContent("alice");
    });
    expect(hits).toBe(1);
  });

  it("a later remount within the TTL costs no request at all", async () => {
    const first = render(<ProfileConsumer label="a" />);
    await waitFor(() => expect(hits).toBe(1));
    first.unmount();

    // Navigating away and back re-mounts the shell consumers.
    render(<ProfileConsumer label="b" />);
    await new Promise((r) => setTimeout(r, 50));

    expect(hits).toBe(1);
  });
});
