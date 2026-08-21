import "@testing-library/jest-dom";
import { afterEach, beforeAll, afterAll } from "vitest";
import { cleanup } from "@testing-library/react";
import { server } from "./msw-server";
import { resetRequestCache } from "../lib/requestCache";
import { resetCommentSummaries } from "../lib/commentSummaryStore";
import { reloadActionItemZones } from "../hooks/useActionItemZoneSets";
import { reloadStatusArrivalOrder } from "../hooks/useStatusArrivalOrder";
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
  ...skillsHandlers,
];

// TipTap's Placeholder extension calls document.elementFromPoint, which jsdom
// does not implement — mounting a real RichTextMentionEditor throws without it.
// Lives here rather than per-file because it's an environment gap: any page that
// renders a note field needs it, and a missing local copy fails as an opaque
// "elementFromPoint is not a function" from deep inside prosemirror-view.
if (!document.elementFromPoint) {
  document.elementFromPoint = () => document.body;
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
});
afterAll(() => server.close());
