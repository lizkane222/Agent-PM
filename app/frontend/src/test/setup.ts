import "@testing-library/jest-dom";
import { afterEach, beforeAll, afterAll } from "vitest";
import { cleanup } from "@testing-library/react";
import { server } from "./msw-server";
import { accountHandlers } from "./handlers/accounts";
import { actionItemHandlers } from "./handlers/action_items";
import { commentsHandlers } from "./handlers/comments";
import { stepsHandlers } from "./handlers/steps";
import { integrationsHandlers } from "./handlers/integrations";
import { realtimeHandlers } from "./handlers/realtime";
import { syncReviewHandlers } from "./handlers/sync_review";
import { accountFeedHandlers } from "./handlers/account_feed";
import { searchHandlers } from "./handlers/search";

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
];

beforeAll(() => {
  server.listen({ onUnhandledRequest: "error" });
  server.use(...extraHandlers);
});
afterEach(() => {
  cleanup();
  server.resetHandlers();
  server.use(...extraHandlers);
});
afterAll(() => server.close());
