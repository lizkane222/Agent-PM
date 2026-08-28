// Fixture matrix index — one export per decision function.
// Build gate: every decision function must have a corresponding entry here.

export { GET_TITLE_ROLE_FIXTURES } from "./getTitleRole.fixtures.js";
export type { TitleRoleFixture } from "./getTitleRole.fixtures.js";

export { DUE_DATE_GROUP_FIXTURES } from "./dueDateGroup.fixtures.js";
export type { DueDateGroupFixture } from "./dueDateGroup.fixtures.js";

export { CALENDAR_EVENT_DISPLAY_FIXTURES } from "./calendarEventDisplay.fixtures.js";
export type { CalendarEventDisplayFixture } from "./calendarEventDisplay.fixtures.js";

export { GET_RSVP_FIXTURES } from "./getRsvp.fixtures.js";
export type { GetRsvpFixture } from "./getRsvp.fixtures.js";

export {
  FILE_ICON_FIXTURES,
  ATTACH_LINK_ICON_FIXTURES,
  FMT_BYTES_FIXTURES,
  FMT_TIME_FIXTURES,
  FORMAT_ARR_FIXTURES,
} from "./fileIcon.fixtures.js";
export type {
  FileIconFixture,
  AttachLinkIconFixture,
  FmtBytesFixture,
  FmtTimeFixture,
  FormatArrFixture,
} from "./fileIcon.fixtures.js";

export { TO_LOCAL_ISO_FIXTURES, ADD_MS_TO_LOCAL_ISO_FIXTURES } from "./dateUtils.fixtures.js";
export type { LocalIsoFixture, AddMsFixture } from "./dateUtils.fixtures.js";

export {
  FIND_NODE_FIXTURES,
  REMOVE_NODE_FIXTURES,
  DEEP_CLONE_FIXTURES,
  RICH_TEXT_PROPS_FIXTURES,
} from "./canvasTree.fixtures.js";
export type {
  FindNodeFixture,
  RemoveNodeFixture,
  DeepCloneFixture,
  RichTextPropsFixture,
} from "./canvasTree.fixtures.js";

export { CANVAS_REDUCER_FIXTURES } from "./canvasReducer.fixtures.js";
export type { ReducerFixture, ReducerAction } from "./canvasReducer.fixtures.js";

export {
  CLAUDE_SKILL_TRANSITION_FIXTURES,
  AGENT_SKILL_TRANSITION_FIXTURES,
} from "./skillStateMachine.fixtures.js";
export type {
  ClaudeSkillTransitionFixture,
  AgentSkillTransitionFixture,
} from "./skillStateMachine.fixtures.js";

export { EXPORT_ITEM_TOGGLE_FIXTURES } from "./exportItemToggle.fixtures.js";
export type { ExportToggleFixture } from "./exportItemToggle.fixtures.js";

export { RESOURCE_LABEL_FIXTURES } from "./resourceLabelMatcher.fixtures.js";
export type { ResourceLabelFixture } from "./resourceLabelMatcher.fixtures.js";

export {
  DECODE_JWT_FIXTURES,
  IS_TOKEN_EXPIRED_FIXTURES,
  VALID_TOKEN,
  EXPIRED_TOKEN,
  MALFORMED_TOKEN,
} from "./jwtUtils.fixtures.js";
export type { DecodeJwtFixture, IsTokenExpiredFixture } from "./jwtUtils.fixtures.js";
