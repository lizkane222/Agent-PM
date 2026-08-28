import { z } from "zod";

// ── Primitives ────────────────────────────────────────────────────────────────

export const IsoDateStringSchema = z.string().regex(
  /^\d{4}-\d{2}-\d{2}(T[\d:.Z+-]+)?$/,
  "Expected ISO date string"
);

export const IsoDateOnlySchema = z.string().regex(
  /^\d{4}-\d{2}-\d{2}$/,
  "Expected YYYY-MM-DD"
);

// ── Auth ──────────────────────────────────────────────────────────────────────

export const TokenPairSchema = z.object({
  access: z.string().min(1),
  refresh: z.string().min(1),
});

export const AuthUserSchema = z.object({
  id: z.number().int(),
  username: z.string().min(1),
  email: z.string().email(),
});

// ── Roles ─────────────────────────────────────────────────────────────────────

export const TitleRoleSchema = z.enum(["SA", "PM", "CSM", "MA", "TAM", "AE", "ENG", "other"]);

// ── Attendee / RSVP ───────────────────────────────────────────────────────────

export const AttendeeSchema = z.object({
  email: z.string().email(),
  displayName: z.string().optional(),
  responseStatus: z.enum(["accepted", "declined", "tentative", "needsAction"]),
});

export const RsvpStatusSchema = z.enum([
  "accepted",
  "declined",
  "tentative",
  "needsAction",
  "unknown",
]);

// ── Calendar Event ────────────────────────────────────────────────────────────

export const CalendarEventStatusSchema = z.enum(["confirmed", "tentative", "cancelled"]);

export const CalendarEventSchema = z.object({
  id: z.number().int(),
  owner: z.number().int(),
  owner_username: z.string(),
  account: z.number().int().nullable(),
  account_name: z.string().nullable(),
  google_event_id: z.string(),
  title: z.string(),
  description: z.string(),
  location: z.string(),
  start_datetime: z.string(),
  end_datetime: z.string(),
  all_day: z.boolean(),
  status: CalendarEventStatusSchema,
  attendees: z.array(AttendeeSchema),
  meet_link: z.string(),
  calendar_id: z.string(),
  is_synced: z.boolean(),
  agentpm_airtable_id: z.string(),
  created_at: z.string(),
  updated_at: z.string(),
});

// ── Action Item ───────────────────────────────────────────────────────────────

export const AirtableActionItemStatusSchema = z.enum(["Open", "In Progress", "Done", "Blocked"]);
export const AirtableActionItemPrioritySchema = z.enum(["Low", "Medium", "High", "Critical"]);

export const ActionItemAttachmentSchema = z.object({
  id: z.number().int(),
  action_item: z.number().int(),
  artifact_type: z.enum(["link", "file"]),
  name: z.string(),
  url: z.string().nullable(),
  file_url: z.string().nullable(),
  mime_type: z.string(),
  file_size: z.number().nullable(),
  uploaded_by: z.number().int().nullable(),
  uploaded_by_username: z.string().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
});

export const ActionItemDependencySchema = z.object({
  id: z.number().int(),
  airtable_id: z.string(),
  task: z.string(),
  status: AirtableActionItemStatusSchema,
});

export const AirtableActionItemSchema = z.object({
  id: z.number().int(),
  airtable_id: z.string(),
  account: z.number().int().nullable(),
  account_name: z.string().nullable(),
  task: z.string(),
  task_details: z.string(),
  status: AirtableActionItemStatusSchema,
  priority: AirtableActionItemPrioritySchema,
  due_date: z.string().nullable(),
  estimated_time: z.number(),
  time_spent: z.number(),
  prep_time: z.number(),
  slack_thread_url: z.string(),
  salesforce_task_id: z.string(),
  assignee_airtable_id: z.string(),
  assignee_name: z.string(),
  reminder: z.number().int().nullable(),
  reminder_id: z.number().int().nullable(),
  reminder_due_at: z.string().nullable(),
  reminder_status: z.string().nullable(),
  linked_meeting: z.number().int().nullable(),
  linked_meeting_name: z.string().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
  marked_done_at: z.string().nullable(),
  last_synced: z.string(),
  attachments: z.array(ActionItemAttachmentSchema).optional(),
  waiting_on: z.array(ActionItemDependencySchema).optional(),
});

// ── Reminder ──────────────────────────────────────────────────────────────────

export const ReminderStatusSchema = z.enum(["pending", "sent", "dismissed", "snoozed"]);

export const ReminderResourceTypeSchema = z.enum([
  "account",
  "calendar_event",
  "action_item",
  "task",
  "general",
]);

export const ReminderSchema = z.object({
  id: z.number().int(),
  created_by: z.number().int(),
  created_by_username: z.string(),
  title: z.string(),
  body: z.string(),
  resource_type: ReminderResourceTypeSchema,
  resource_id: z.number().int().nullable(),
  resource_label: z.string(),
  due_at: z.string(),
  notify_in_app: z.boolean(),
  notify_slack: z.boolean(),
  notify_push: z.boolean(),
  notify_sms: z.boolean(),
  status: ReminderStatusSchema,
  created_at: z.string(),
  updated_at: z.string(),
});

export const NotificationDefaultsSchema = z.object({
  notify_default_in_app: z.boolean(),
  notify_default_slack: z.boolean(),
  notify_default_push: z.boolean(),
  notify_default_sms: z.boolean(),
});

// ── Account ───────────────────────────────────────────────────────────────────

export const AccountStatusSchema = z.enum(["prospect", "active", "inactive", "churned"]);

export const AccountSchema = z.object({
  id: z.number().int(),
  company_name: z.string(),
  airtable_id: z.string(),
  website: z.string(),
  industry: z.string(),
  status: AccountStatusSchema,
  arr: z.string().nullable(),
  owner: z.number().int().nullable(),
  owner_username: z.string().nullable(),
  primary_contact: z.number().int().nullable(),
  primary_contact_name: z.string().nullable(),
  team_members: z.array(
    z.object({
      id: z.number().int(),
      full_name: z.string(),
      title: z.string(),
      email: z.string(),
      avatar_url: z.string(),
      slack_handle: z.string(),
    })
  ),
  notes_count: z.number().int(),
  created_by: z.number().int().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
});

// ── Skills ────────────────────────────────────────────────────────────────────

export const ClaudeSkillStatusSchema = z.enum([
  "pending_review",
  "reviewing",
  "approved",
  "rejected",
  "disabled",
]);

export const AgentSkillStatusSchema = z.enum([
  "draft",
  "pending_review",
  "approved",
  "rejected",
]);

export const AgentSkillVisibilitySchema = z.enum(["private", "team", "public"]);

// ── Canvas / Page Builder ─────────────────────────────────────────────────────

export const CanvasNodeSchema: z.ZodType<{
  id: string;
  type: string;
  props: Record<string, unknown>;
  children: unknown[];
}> = z.lazy(() =>
  z.object({
    id: z.string(),
    type: z.string(),
    // props is untyped — values are node-type-specific and consumer-defined.
    // SECURITY: for RichText nodes, props.html is untrusted user content.
    // Consumers MUST sanitize props.html before rendering (e.g. DOMPurify.sanitize).
    // The core package stores it as-is; sanitization belongs in the rendering surface.
    props: z.record(z.unknown()),
    children: z.array(CanvasNodeSchema),
  })
);

// ── Export / Chat ─────────────────────────────────────────────────────────────

export const ExportItemTypeSchema = z.enum([
  "account",
  "action_item",
  "reminder",
  "calendar_event",
  "team_member",
  "note",
]);

export const ExportItemSchema = z.object({
  id: z.string(),
  type: ExportItemTypeSchema,
  label: z.string(),
  summary: z.string(),
  content: z.string(),
  accountId: z.number().int().optional(),
  accountName: z.string().optional(),
});

// ── Activity Log ──────────────────────────────────────────────────────────────

export const LogCategorySchema = z.enum(["account", "team", "action_item", "calendar"]);

export const LogResourceSchema = z.object({
  type: z.enum(["account", "action_item", "calendar_event", "reminder"]),
  id: z.union([z.number().int(), z.string()]),
});

export const LogEntrySchema = z.object({
  id: z.string(),
  ts: z.number().int(),
  category: LogCategorySchema,
  message: z.string(),
  links: z
    .array(z.object({ label: z.string(), url: z.string() }))
    .optional(),
  resource: LogResourceSchema.optional(),
  restoreData: z.record(z.unknown()).optional(),
});

// ── Pagination ────────────────────────────────────────────────────────────────

export function PaginatedResponseSchema<T extends z.ZodTypeAny>(itemSchema: T) {
  return z.object({
    count: z.number().int(),
    next: z.string().nullable(),
    previous: z.string().nullable(),
    results: z.array(itemSchema),
  });
}
