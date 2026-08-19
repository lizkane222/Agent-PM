import { setupServer } from "msw/node";
import { schedulerHandlers } from "./handlers/scheduler";
import { teamHandlers } from "./handlers/team";
import { discoverHandlers } from "./handlers/discover";
import { agentsHandlers } from "./handlers/agents";
import { feedbackHandlers } from "./handlers/feedback";
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

export const server = setupServer(
  ...schedulerHandlers,
  ...teamHandlers,
  ...discoverHandlers,
  ...agentsHandlers,
  ...feedbackHandlers,
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
);
