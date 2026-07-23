import { setupServer } from "msw/node";
import { schedulerHandlers } from "./handlers/scheduler";
import { teamHandlers } from "./handlers/team";
import { discoverHandlers } from "./handlers/discover";
import { agentsHandlers } from "./handlers/agents";
import { feedbackHandlers } from "./handlers/feedback";

export const server = setupServer(
  ...schedulerHandlers,
  ...teamHandlers,
  ...discoverHandlers,
  ...agentsHandlers,
  ...feedbackHandlers,
);
