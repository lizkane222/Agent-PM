import { describe, it, expect } from "vitest";
import { http, HttpResponse } from "msw";
import { server } from "../../test/msw-server";
import { layoutsApi, userPageNoteApi, workingSessionApi } from "../api";
import {
  layoutsPage,
  mockPageLayout,
  mockUserPageNote,
  mockWorkingSession,
} from "../../test/handlers/layouts";

/**
 * The `/layouts/` family serves two response shapes at once: `pinned/` is a custom
 * @action returning a bare array, while `working-sessions/` and `page-notes/` are
 * plain ModelViewSets that inherit the global PageNumberPagination and answer with
 * `{count, next, previous, results}`.
 *
 * These fetchers were typed as bare arrays, so the envelope reached RolePage and
 * ProfilePage as a plain object. Nothing failed at the network layer — the crash
 * only appeared when a render called `.map` on it, which threw during render and
 * unmounted the whole route, so both pages went blank.
 */
describe("layouts list fetchers unwrap whichever shape the server sends", () => {
  describe("workingSessionApi.list", () => {
    it("unwraps the paginated envelope the live server actually returns", async () => {
      server.use(http.get("*/api/v1/layouts/working-sessions/", () =>
        layoutsPage([mockWorkingSession({ id: 7, name: "Envelope session" })])));

      const { data } = await workingSessionApi.list();

      expect(Array.isArray(data)).toBe(true);
      expect(data).toHaveLength(1);
      expect(data[0].name).toBe("Envelope session");
    });

    it("still passes through a bare array, so it survives pagination being removed", async () => {
      server.use(http.get("*/api/v1/layouts/working-sessions/", () =>
        HttpResponse.json([mockWorkingSession({ id: 8, name: "Bare session" })])));

      const { data } = await workingSessionApi.list();

      expect(Array.isArray(data)).toBe(true);
      expect(data[0].name).toBe("Bare session");
    });

    it("resolves an array, never undefined, when the body has no results key", async () => {
      server.use(http.get("*/api/v1/layouts/working-sessions/", () =>
        HttpResponse.json({})));

      const { data } = await workingSessionApi.list();

      expect(data).toEqual([]);
    });
  });

  describe("userPageNoteApi.list", () => {
    it("unwraps the envelope so the notepad finds an existing note", async () => {
      server.use(http.get("*/api/v1/layouts/page-notes/", () =>
        layoutsPage([mockUserPageNote({ id: 3, content: "saved note" })])));

      const { data } = await userPageNoteApi.list();

      // Before the fix `data[0]` was undefined on the envelope object, so the
      // notepad always looked empty and a save POSTed a duplicate note instead
      // of PATCHing the existing one.
      expect(data[0]?.content).toBe("saved note");
    });

    it("passes a bare array through unchanged", async () => {
      server.use(http.get("*/api/v1/layouts/page-notes/", () =>
        HttpResponse.json([mockUserPageNote({ id: 4, content: "bare note" })])));

      const { data } = await userPageNoteApi.list();

      expect(data[0]?.content).toBe("bare note");
    });
  });

  describe("layoutsApi.listPinned", () => {
    it("keeps working on the bare array this route really sends", async () => {
      server.use(http.get("*/api/v1/layouts/pinned/", () =>
        HttpResponse.json([mockPageLayout({ id: 5, name: "Pinned bare" })])));

      const { data } = await layoutsApi.listPinned();

      expect(Array.isArray(data)).toBe(true);
      expect(data[0].name).toBe("Pinned bare");
    });

    it("would also survive this route gaining pagination later", async () => {
      server.use(http.get("*/api/v1/layouts/pinned/", () =>
        layoutsPage([mockPageLayout({ id: 6, name: "Pinned enveloped" })])));

      const { data } = await layoutsApi.listPinned();

      expect(data[0].name).toBe("Pinned enveloped");
    });
  });
});
