import { profileHandlers } from "./handlers/profile";
import "@testing-library/jest-dom";
import { afterEach, beforeAll, afterAll } from "vitest";
import { cleanup } from "@testing-library/react";
import { server } from "./msw-server";
import { resetRequestCache } from "../lib/requestCache";
import { resetCommentSummaries } from "../lib/commentSummaryStore";
import { reloadActionItemZones } from "../hooks/useActionItemZoneSets";
import { reloadStatusArrivalOrder, reloadColumnSort } from "../hooks/useStatusArrivalOrder";
import { reloadQuickLinks } from "../hooks/useQuickLinks";
import { reloadAccountSectionCollapse } from "../hooks/useAccountSectionCollapse";
import { resetLiveTimers } from "../lib/liveTimers";
import { resetEmailThreads } from "../lib/emailThreadStore";
import { resetCreatedEventIds } from "./handlers/scheduler";
import { accountHandlers } from "./handlers/accounts";
import { actionItemHandlers } from "./handlers/action_items";
import { commentsHandlers } from "./handlers/comments";
import { stepsHandlers } from "./handlers/steps";
import { integrationsHandlers } from "./handlers/integrations";
import { realtimeHandlers } from "./handlers/realtime";
import { syncReviewHandlers } from "./handlers/sync_review";
import { accountFeedHandlers } from "./handlers/account_feed";
import { searchHandlers } from "./handlers/search";
import { layoutsHandlers } from "./handlers/layouts";
import { skillsHandlers } from "./handlers/skills";
import { salesforceHandlers } from "./handlers/salesforce";

// These handlers must always be registered. They're added here (not only in
// msw-server.ts) so the test suite is resilient to editor buffer reverts.
const extraHandlers = [
  ...accountHandlers,
  ...actionItemHandlers,
  ...commentsHandlers,
  ...stepsHandlers,
  ...integrationsHandlers,
  ...realtimeHandlers,
  ...syncReviewHandlers,
  ...accountFeedHandlers,
  ...searchHandlers,
  ...layoutsHandlers,
  ...profileHandlers,
  ...skillsHandlers,
  ...salesforceHandlers,
];

// TipTap's Placeholder extension calls document.elementFromPoint, which jsdom
// does not implement — mounting a real RichTextMentionEditor throws without it.
// Lives here rather than per-file because it's an environment gap: any page that
// renders a note field needs it, and a missing local copy fails as an opaque
// "elementFromPoint is not a function" from deep inside prosemirror-view.
if (!document.elementFromPoint) {
  document.elementFromPoint = () => document.body;
}

// ProseMirror scrolls the caret into view after every state change (toggling a list, typing) by
// measuring a DOM Range. jsdom has no layout and no Range.getClientRects, so the call throws from a
// timer and surfaces as an "Unhandled error" that makes `vitest run` exit non-zero even though every
// test passed. Zero-size rectangles are what a layout-less environment would truthfully report.
const emptyRect = () => ({ x: 0, y: 0, top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0, toJSON: () => ({}) });
if (typeof Range !== "undefined") {
  if (!Range.prototype.getClientRects) {
    Range.prototype.getClientRects = () => ({ length: 0, item: () => null, [Symbol.iterator]: function* () {} }) as unknown as DOMRectList;
  }
  if (!Range.prototype.getBoundingClientRect) {
    Range.prototype.getBoundingClientRect = () => emptyRect() as DOMRect;
  }
}

beforeAll(() => {
  server.listen({ onUnhandledRequest: "error" });
  server.use(...extraHandlers);
});
afterEach(() => {
  cleanup();
  server.resetHandlers();
  server.use(...extraHandlers);
  // apiClient coalesces and briefly caches GETs (lib/requestCache.ts). That cache is
  // module-level, so it must be cleared alongside the MSW handlers — otherwise a test
  // that overrides a handler is served the previous test's response body.
  resetRequestCache();
  // Same reasoning: the comment-rollup cache in lib/commentSummaryStore.ts is
  // module-level and shared by every card, so a summary fetched in one test would
  // otherwise still be cached (and never re-requested) in the next.
  resetCommentSummaries();
  // The actionItemZones store (hooks/useActionItemZoneSets.ts) is module-level too, and
  // `localStorage.clear()` fires no storage event — so without this a zone set by one test
  // still groups the next test's cards. Same trap reloadFocusPins() exists for.
  reloadActionItemZones();
  // Same trap again for the kanban status arrival order (hooks/useStatusArrivalOrder.ts):
  // a status move recorded by one test would otherwise still order the next test's columns.
  reloadStatusArrivalOrder();
  reloadColumnSort();
  // Module-level store: localStorage.clear() fires no event, so a link added by one test would
  // otherwise still be listed in the next.
  reloadQuickLinks();
  // Account Detail section folding (hooks/useAccountSectionCollapse.ts) is module-level too.
  reloadAccountSectionCollapse();
  // Live Tracking timers (lib/liveTimers.ts) are a module-level cache of the server's
  // running sessions; a timer started in one test must not still be "running" in the next.
  resetLiveTimers();
  // Loaded Gmail threads (lib/emailThreadStore.ts) are module-level; one test's load must not persist.
  resetEmailThreads();
  // The create-event MSW handler hands out ascending ids from a module-level counter, so
  // without this an id assertion depends on how many events earlier tests created.
  resetCreatedEventIds();
});
afterAll(() => server.close());
