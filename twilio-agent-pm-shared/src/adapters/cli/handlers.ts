// Maps each CommandName to its brain function. Returns the result value to be
// serialised to disk. Throws on validation failure or unknown command.

import { z } from "zod";
import {
  getTitleRole,
  dueDateGroup,
  getRsvp,
  fileIcon,
  attachLinkIcon,
  fmtBytes,
  fmtTime,
  formatArr,
  calendarEventDisplayProps,
  matchResourceLabel,
  isTokenExpired,
  toggleExportItem,
  findNode,
  removeNode,
  canvasReducer,
  INITIAL_HISTORY,
  claudeSkillTransition,
  agentSkillTransition,
} from "../../brain/index.js";
import {
  AirtableActionItemSchema,
  CalendarEventSchema,
  ExportItemSchema,
  CanvasNodeSchema,
} from "../../schemas.js";
import type { CommandEnvelope, CommandName } from "./protocol.js";
import type { HistoryState } from "../../brain/canvasReducer.js";

// ── Per-command payload schemas ───────────────────────────────────────────────

const GetTitleRolePayload = z.object({ title: z.string().nullable().optional() });
const DueDateGroupPayload = z.object({
  due_date: z.string().nullable(),
  nowIso: z.string().optional(),
});
const GetRsvpPayload = z.object({
  attendees: CalendarEventSchema.shape.attendees,
  userEmail: z.string().nullable(),
});
const FileIconPayload = z.object({ mime: z.string(), name: z.string() });
const AttachLinkIconPayload = z.object({ url: z.string() });
const FmtBytesPayload = z.object({ bytes: z.number().nullable() });
const FmtTimePayload = z.object({ seconds: z.number() });
const FormatArrPayload = z.object({ arr: z.string().nullable() });
const CalendarEventDisplayPayload = z.object({
  calendar_id: z.string(),
  google_event_id: z.string(),
  is_synced: z.boolean(),
  agentpm_airtable_id: z.string(),
  status: CalendarEventSchema.shape.status,
  title: z.string(),
});
const MatchResourceLabelPayload = z.object({ url: z.string() });
const IsTokenExpiredPayload = z.object({ token: z.string(), nowSecs: z.number().optional() });
const ToggleExportItemPayload = z.object({
  items: z.array(ExportItemSchema),
  item: ExportItemSchema,
});
const CanvasFindPayload = z.object({ root: z.array(CanvasNodeSchema), id: z.string() });
const CanvasRemovePayload = z.object({ root: z.array(CanvasNodeSchema), id: z.string() });

const CanvasActionSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("COMMIT"), nodes: z.array(CanvasNodeSchema) }),
  z.object({ type: z.literal("LIVE"),   nodes: z.array(CanvasNodeSchema) }),
  z.object({ type: z.literal("UNDO") }),
  z.object({ type: z.literal("REDO") }),
]);
const HistoryStateSchema = z.object({
  past:    z.array(z.array(CanvasNodeSchema)),
  present: z.array(CanvasNodeSchema),
  future:  z.array(z.array(CanvasNodeSchema)),
}).optional();
const CanvasReducerPayload = z.object({
  state: HistoryStateSchema,
  action: CanvasActionSchema,
});

const ClaudeSkillTransitionPayload = z.object({
  from: z.enum(["pending_review", "reviewing", "approved", "rejected", "disabled"]),
  action: z.enum(["submit", "start_review", "approve", "reject", "enable", "disable"]),
});
const AgentSkillTransitionPayload = z.object({
  from: z.enum(["draft", "pending_review", "approved", "rejected"]),
  action: z.enum(["submit", "approve", "reject", "resubmit"]),
});

// ── Dispatch ──────────────────────────────────────────────────────────────────

let _idCounter = 0;
function makeId() { return `node-${++_idCounter}`; }

export function dispatch(envelope: CommandEnvelope): unknown {
  const { command, payload } = envelope;

  switch (command as CommandName) {
    case "getTitleRole": {
      const { title } = GetTitleRolePayload.parse(payload);
      return { role: getTitleRole(title) };
    }
    case "dueDateGroup": {
      const { due_date, nowIso } = DueDateGroupPayload.parse(payload);
      const item = AirtableActionItemSchema.pick({ due_date: true }).parse({ due_date });
      const now = nowIso ? new Date(nowIso) : undefined;
      return { group: dueDateGroup(item, now) };
    }
    case "getRsvp": {
      const { attendees, userEmail } = GetRsvpPayload.parse(payload);
      // Cast through unknown to satisfy exactOptionalPropertyTypes — Zod infers
      // displayName as `string | undefined` but the Attendee type requires it
      // as `string` when present (optional field, not optionally-undefined).
      return { rsvp: getRsvp({ attendees: attendees as unknown as import("../../types.js").Attendee[] }, userEmail) };
    }
    case "fileIcon": {
      const { mime, name } = FileIconPayload.parse(payload);
      return { icon: fileIcon(mime, name) };
    }
    case "attachLinkIcon": {
      const { url } = AttachLinkIconPayload.parse(payload);
      return { icon: attachLinkIcon(url) };
    }
    case "fmtBytes": {
      const { bytes } = FmtBytesPayload.parse(payload);
      return { formatted: fmtBytes(bytes) };
    }
    case "fmtTime": {
      const { seconds } = FmtTimePayload.parse(payload);
      return { formatted: fmtTime(seconds) };
    }
    case "formatArr": {
      const { arr } = FormatArrPayload.parse(payload);
      return { formatted: formatArr(arr) };
    }
    case "calendarEventDisplay": {
      const p = CalendarEventDisplayPayload.parse(payload);
      return calendarEventDisplayProps(p);
    }
    case "matchResourceLabel": {
      const { url } = MatchResourceLabelPayload.parse(payload);
      return { label: matchResourceLabel(url) };
    }
    case "isTokenExpired": {
      const { token, nowSecs } = IsTokenExpiredPayload.parse(payload);
      return { expired: isTokenExpired(token, nowSecs) };
    }
    case "toggleExportItem": {
      const { items, item } = ToggleExportItemPayload.parse(payload);
      return { items: toggleExportItem(
        items as unknown as import("../../types.js").ExportItem[],
        item as unknown as import("../../types.js").ExportItem,
      ) };
    }
    case "canvasFind": {
      const { root, id } = CanvasFindPayload.parse(payload);
      return { node: findNode(root as Parameters<typeof findNode>[0], id) };
    }
    case "canvasRemove": {
      const { root, id } = CanvasRemovePayload.parse(payload);
      return { root: removeNode(root as Parameters<typeof removeNode>[0], id) };
    }
    case "canvasReducer": {
      const { state, action } = CanvasReducerPayload.parse(payload);
      const s = (state ?? INITIAL_HISTORY) as unknown as HistoryState;
      return canvasReducer(s, action as Parameters<typeof canvasReducer>[1]);
    }
    case "claudeSkillTransition": {
      const { from, action } = ClaudeSkillTransitionPayload.parse(payload);
      return { to: claudeSkillTransition(from, action) };
    }
    case "agentSkillTransition": {
      const { from, action } = AgentSkillTransitionPayload.parse(payload);
      return { to: agentSkillTransition(from, action) };
    }
    default:
      throw new Error(`Unknown command: ${String(command)}`);
  }
}
