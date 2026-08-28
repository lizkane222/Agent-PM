import { z } from "zod";
export declare const IsoDateStringSchema: z.ZodString;
export declare const IsoDateOnlySchema: z.ZodString;
export declare const TokenPairSchema: z.ZodObject<{
    access: z.ZodString;
    refresh: z.ZodString;
}, "strip", z.ZodTypeAny, {
    access: string;
    refresh: string;
}, {
    access: string;
    refresh: string;
}>;
export declare const AuthUserSchema: z.ZodObject<{
    id: z.ZodNumber;
    username: z.ZodString;
    email: z.ZodString;
}, "strip", z.ZodTypeAny, {
    id: number;
    username: string;
    email: string;
}, {
    id: number;
    username: string;
    email: string;
}>;
export declare const TitleRoleSchema: z.ZodEnum<["SA", "PM", "CSM", "MA", "TAM", "AE", "ENG", "other"]>;
export declare const AttendeeSchema: z.ZodObject<{
    email: z.ZodString;
    displayName: z.ZodOptional<z.ZodString>;
    responseStatus: z.ZodEnum<["accepted", "declined", "tentative", "needsAction"]>;
}, "strip", z.ZodTypeAny, {
    email: string;
    responseStatus: "accepted" | "declined" | "tentative" | "needsAction";
    displayName?: string | undefined;
}, {
    email: string;
    responseStatus: "accepted" | "declined" | "tentative" | "needsAction";
    displayName?: string | undefined;
}>;
export declare const RsvpStatusSchema: z.ZodEnum<["accepted", "declined", "tentative", "needsAction", "unknown"]>;
export declare const CalendarEventStatusSchema: z.ZodEnum<["confirmed", "tentative", "cancelled"]>;
export declare const CalendarEventSchema: z.ZodObject<{
    id: z.ZodNumber;
    owner: z.ZodNumber;
    owner_username: z.ZodString;
    account: z.ZodNullable<z.ZodNumber>;
    account_name: z.ZodNullable<z.ZodString>;
    google_event_id: z.ZodString;
    title: z.ZodString;
    description: z.ZodString;
    location: z.ZodString;
    start_datetime: z.ZodString;
    end_datetime: z.ZodString;
    all_day: z.ZodBoolean;
    status: z.ZodEnum<["confirmed", "tentative", "cancelled"]>;
    attendees: z.ZodArray<z.ZodObject<{
        email: z.ZodString;
        displayName: z.ZodOptional<z.ZodString>;
        responseStatus: z.ZodEnum<["accepted", "declined", "tentative", "needsAction"]>;
    }, "strip", z.ZodTypeAny, {
        email: string;
        responseStatus: "accepted" | "declined" | "tentative" | "needsAction";
        displayName?: string | undefined;
    }, {
        email: string;
        responseStatus: "accepted" | "declined" | "tentative" | "needsAction";
        displayName?: string | undefined;
    }>, "many">;
    meet_link: z.ZodString;
    calendar_id: z.ZodString;
    is_synced: z.ZodBoolean;
    agentpm_airtable_id: z.ZodString;
    created_at: z.ZodString;
    updated_at: z.ZodString;
}, "strip", z.ZodTypeAny, {
    account: number | null;
    status: "tentative" | "confirmed" | "cancelled";
    id: number;
    owner: number;
    owner_username: string;
    account_name: string | null;
    google_event_id: string;
    title: string;
    description: string;
    location: string;
    start_datetime: string;
    end_datetime: string;
    all_day: boolean;
    attendees: {
        email: string;
        responseStatus: "accepted" | "declined" | "tentative" | "needsAction";
        displayName?: string | undefined;
    }[];
    meet_link: string;
    calendar_id: string;
    is_synced: boolean;
    agentpm_airtable_id: string;
    created_at: string;
    updated_at: string;
}, {
    account: number | null;
    status: "tentative" | "confirmed" | "cancelled";
    id: number;
    owner: number;
    owner_username: string;
    account_name: string | null;
    google_event_id: string;
    title: string;
    description: string;
    location: string;
    start_datetime: string;
    end_datetime: string;
    all_day: boolean;
    attendees: {
        email: string;
        responseStatus: "accepted" | "declined" | "tentative" | "needsAction";
        displayName?: string | undefined;
    }[];
    meet_link: string;
    calendar_id: string;
    is_synced: boolean;
    agentpm_airtable_id: string;
    created_at: string;
    updated_at: string;
}>;
export declare const AirtableActionItemStatusSchema: z.ZodEnum<["Open", "In Progress", "Done", "Blocked"]>;
export declare const AirtableActionItemPrioritySchema: z.ZodEnum<["Low", "Medium", "High", "Critical"]>;
export declare const ActionItemAttachmentSchema: z.ZodObject<{
    id: z.ZodNumber;
    action_item: z.ZodNumber;
    artifact_type: z.ZodEnum<["link", "file"]>;
    name: z.ZodString;
    url: z.ZodNullable<z.ZodString>;
    file_url: z.ZodNullable<z.ZodString>;
    mime_type: z.ZodString;
    file_size: z.ZodNullable<z.ZodNumber>;
    uploaded_by: z.ZodNullable<z.ZodNumber>;
    uploaded_by_username: z.ZodNullable<z.ZodString>;
    created_at: z.ZodString;
    updated_at: z.ZodString;
}, "strip", z.ZodTypeAny, {
    action_item: number;
    id: number;
    created_at: string;
    updated_at: string;
    artifact_type: "link" | "file";
    name: string;
    url: string | null;
    file_url: string | null;
    mime_type: string;
    file_size: number | null;
    uploaded_by: number | null;
    uploaded_by_username: string | null;
}, {
    action_item: number;
    id: number;
    created_at: string;
    updated_at: string;
    artifact_type: "link" | "file";
    name: string;
    url: string | null;
    file_url: string | null;
    mime_type: string;
    file_size: number | null;
    uploaded_by: number | null;
    uploaded_by_username: string | null;
}>;
export declare const ActionItemDependencySchema: z.ZodObject<{
    id: z.ZodNumber;
    airtable_id: z.ZodString;
    task: z.ZodString;
    status: z.ZodEnum<["Open", "In Progress", "Done", "Blocked"]>;
}, "strip", z.ZodTypeAny, {
    task: string;
    status: "Open" | "In Progress" | "Done" | "Blocked";
    id: number;
    airtable_id: string;
}, {
    task: string;
    status: "Open" | "In Progress" | "Done" | "Blocked";
    id: number;
    airtable_id: string;
}>;
export declare const AirtableActionItemSchema: z.ZodObject<{
    id: z.ZodNumber;
    airtable_id: z.ZodString;
    account: z.ZodNullable<z.ZodNumber>;
    account_name: z.ZodNullable<z.ZodString>;
    task: z.ZodString;
    task_details: z.ZodString;
    status: z.ZodEnum<["Open", "In Progress", "Done", "Blocked"]>;
    priority: z.ZodEnum<["Low", "Medium", "High", "Critical"]>;
    due_date: z.ZodNullable<z.ZodString>;
    estimated_time: z.ZodNumber;
    time_spent: z.ZodNumber;
    prep_time: z.ZodNumber;
    slack_thread_url: z.ZodString;
    salesforce_task_id: z.ZodString;
    assignee_airtable_id: z.ZodString;
    assignee_name: z.ZodString;
    reminder: z.ZodNullable<z.ZodNumber>;
    reminder_id: z.ZodNullable<z.ZodNumber>;
    reminder_due_at: z.ZodNullable<z.ZodString>;
    reminder_status: z.ZodNullable<z.ZodString>;
    linked_meeting: z.ZodNullable<z.ZodNumber>;
    linked_meeting_name: z.ZodNullable<z.ZodString>;
    created_at: z.ZodString;
    updated_at: z.ZodString;
    marked_done_at: z.ZodNullable<z.ZodString>;
    last_synced: z.ZodString;
    attachments: z.ZodOptional<z.ZodArray<z.ZodObject<{
        id: z.ZodNumber;
        action_item: z.ZodNumber;
        artifact_type: z.ZodEnum<["link", "file"]>;
        name: z.ZodString;
        url: z.ZodNullable<z.ZodString>;
        file_url: z.ZodNullable<z.ZodString>;
        mime_type: z.ZodString;
        file_size: z.ZodNullable<z.ZodNumber>;
        uploaded_by: z.ZodNullable<z.ZodNumber>;
        uploaded_by_username: z.ZodNullable<z.ZodString>;
        created_at: z.ZodString;
        updated_at: z.ZodString;
    }, "strip", z.ZodTypeAny, {
        action_item: number;
        id: number;
        created_at: string;
        updated_at: string;
        artifact_type: "link" | "file";
        name: string;
        url: string | null;
        file_url: string | null;
        mime_type: string;
        file_size: number | null;
        uploaded_by: number | null;
        uploaded_by_username: string | null;
    }, {
        action_item: number;
        id: number;
        created_at: string;
        updated_at: string;
        artifact_type: "link" | "file";
        name: string;
        url: string | null;
        file_url: string | null;
        mime_type: string;
        file_size: number | null;
        uploaded_by: number | null;
        uploaded_by_username: string | null;
    }>, "many">>;
    waiting_on: z.ZodOptional<z.ZodArray<z.ZodObject<{
        id: z.ZodNumber;
        airtable_id: z.ZodString;
        task: z.ZodString;
        status: z.ZodEnum<["Open", "In Progress", "Done", "Blocked"]>;
    }, "strip", z.ZodTypeAny, {
        task: string;
        status: "Open" | "In Progress" | "Done" | "Blocked";
        id: number;
        airtable_id: string;
    }, {
        task: string;
        status: "Open" | "In Progress" | "Done" | "Blocked";
        id: number;
        airtable_id: string;
    }>, "many">>;
}, "strip", z.ZodTypeAny, {
    account: number | null;
    task: string;
    reminder: number | null;
    status: "Open" | "In Progress" | "Done" | "Blocked";
    id: number;
    account_name: string | null;
    created_at: string;
    updated_at: string;
    airtable_id: string;
    task_details: string;
    priority: "Low" | "Medium" | "High" | "Critical";
    due_date: string | null;
    estimated_time: number;
    time_spent: number;
    prep_time: number;
    slack_thread_url: string;
    salesforce_task_id: string;
    assignee_airtable_id: string;
    assignee_name: string;
    reminder_id: number | null;
    reminder_due_at: string | null;
    reminder_status: string | null;
    linked_meeting: number | null;
    linked_meeting_name: string | null;
    marked_done_at: string | null;
    last_synced: string;
    attachments?: {
        action_item: number;
        id: number;
        created_at: string;
        updated_at: string;
        artifact_type: "link" | "file";
        name: string;
        url: string | null;
        file_url: string | null;
        mime_type: string;
        file_size: number | null;
        uploaded_by: number | null;
        uploaded_by_username: string | null;
    }[] | undefined;
    waiting_on?: {
        task: string;
        status: "Open" | "In Progress" | "Done" | "Blocked";
        id: number;
        airtable_id: string;
    }[] | undefined;
}, {
    account: number | null;
    task: string;
    reminder: number | null;
    status: "Open" | "In Progress" | "Done" | "Blocked";
    id: number;
    account_name: string | null;
    created_at: string;
    updated_at: string;
    airtable_id: string;
    task_details: string;
    priority: "Low" | "Medium" | "High" | "Critical";
    due_date: string | null;
    estimated_time: number;
    time_spent: number;
    prep_time: number;
    slack_thread_url: string;
    salesforce_task_id: string;
    assignee_airtable_id: string;
    assignee_name: string;
    reminder_id: number | null;
    reminder_due_at: string | null;
    reminder_status: string | null;
    linked_meeting: number | null;
    linked_meeting_name: string | null;
    marked_done_at: string | null;
    last_synced: string;
    attachments?: {
        action_item: number;
        id: number;
        created_at: string;
        updated_at: string;
        artifact_type: "link" | "file";
        name: string;
        url: string | null;
        file_url: string | null;
        mime_type: string;
        file_size: number | null;
        uploaded_by: number | null;
        uploaded_by_username: string | null;
    }[] | undefined;
    waiting_on?: {
        task: string;
        status: "Open" | "In Progress" | "Done" | "Blocked";
        id: number;
        airtable_id: string;
    }[] | undefined;
}>;
export declare const ReminderStatusSchema: z.ZodEnum<["pending", "sent", "dismissed", "snoozed"]>;
export declare const ReminderResourceTypeSchema: z.ZodEnum<["account", "calendar_event", "action_item", "task", "general"]>;
export declare const ReminderSchema: z.ZodObject<{
    id: z.ZodNumber;
    created_by: z.ZodNumber;
    created_by_username: z.ZodString;
    title: z.ZodString;
    body: z.ZodString;
    resource_type: z.ZodEnum<["account", "calendar_event", "action_item", "task", "general"]>;
    resource_id: z.ZodNullable<z.ZodNumber>;
    resource_label: z.ZodString;
    due_at: z.ZodString;
    notify_in_app: z.ZodBoolean;
    notify_slack: z.ZodBoolean;
    notify_push: z.ZodBoolean;
    notify_sms: z.ZodBoolean;
    status: z.ZodEnum<["pending", "sent", "dismissed", "snoozed"]>;
    created_at: z.ZodString;
    updated_at: z.ZodString;
}, "strip", z.ZodTypeAny, {
    status: "pending" | "dismissed" | "sent" | "snoozed";
    id: number;
    title: string;
    created_at: string;
    updated_at: string;
    created_by: number;
    created_by_username: string;
    body: string;
    resource_type: "account" | "calendar_event" | "action_item" | "task" | "general";
    resource_id: number | null;
    resource_label: string;
    due_at: string;
    notify_in_app: boolean;
    notify_slack: boolean;
    notify_push: boolean;
    notify_sms: boolean;
}, {
    status: "pending" | "dismissed" | "sent" | "snoozed";
    id: number;
    title: string;
    created_at: string;
    updated_at: string;
    created_by: number;
    created_by_username: string;
    body: string;
    resource_type: "account" | "calendar_event" | "action_item" | "task" | "general";
    resource_id: number | null;
    resource_label: string;
    due_at: string;
    notify_in_app: boolean;
    notify_slack: boolean;
    notify_push: boolean;
    notify_sms: boolean;
}>;
export declare const NotificationDefaultsSchema: z.ZodObject<{
    notify_default_in_app: z.ZodBoolean;
    notify_default_slack: z.ZodBoolean;
    notify_default_push: z.ZodBoolean;
    notify_default_sms: z.ZodBoolean;
}, "strip", z.ZodTypeAny, {
    notify_default_in_app: boolean;
    notify_default_slack: boolean;
    notify_default_push: boolean;
    notify_default_sms: boolean;
}, {
    notify_default_in_app: boolean;
    notify_default_slack: boolean;
    notify_default_push: boolean;
    notify_default_sms: boolean;
}>;
export declare const AccountStatusSchema: z.ZodEnum<["prospect", "active", "inactive", "churned"]>;
export declare const AccountSchema: z.ZodObject<{
    id: z.ZodNumber;
    company_name: z.ZodString;
    airtable_id: z.ZodString;
    website: z.ZodString;
    industry: z.ZodString;
    status: z.ZodEnum<["prospect", "active", "inactive", "churned"]>;
    arr: z.ZodNullable<z.ZodString>;
    owner: z.ZodNullable<z.ZodNumber>;
    owner_username: z.ZodNullable<z.ZodString>;
    primary_contact: z.ZodNullable<z.ZodNumber>;
    primary_contact_name: z.ZodNullable<z.ZodString>;
    team_members: z.ZodArray<z.ZodObject<{
        id: z.ZodNumber;
        full_name: z.ZodString;
        title: z.ZodString;
        email: z.ZodString;
        avatar_url: z.ZodString;
        slack_handle: z.ZodString;
    }, "strip", z.ZodTypeAny, {
        id: number;
        email: string;
        title: string;
        full_name: string;
        avatar_url: string;
        slack_handle: string;
    }, {
        id: number;
        email: string;
        title: string;
        full_name: string;
        avatar_url: string;
        slack_handle: string;
    }>, "many">;
    notes_count: z.ZodNumber;
    created_by: z.ZodNullable<z.ZodNumber>;
    created_at: z.ZodString;
    updated_at: z.ZodString;
}, "strip", z.ZodTypeAny, {
    status: "active" | "prospect" | "inactive" | "churned";
    id: number;
    owner: number | null;
    owner_username: string | null;
    created_at: string;
    updated_at: string;
    airtable_id: string;
    created_by: number | null;
    company_name: string;
    website: string;
    industry: string;
    arr: string | null;
    primary_contact: number | null;
    primary_contact_name: string | null;
    team_members: {
        id: number;
        email: string;
        title: string;
        full_name: string;
        avatar_url: string;
        slack_handle: string;
    }[];
    notes_count: number;
}, {
    status: "active" | "prospect" | "inactive" | "churned";
    id: number;
    owner: number | null;
    owner_username: string | null;
    created_at: string;
    updated_at: string;
    airtable_id: string;
    created_by: number | null;
    company_name: string;
    website: string;
    industry: string;
    arr: string | null;
    primary_contact: number | null;
    primary_contact_name: string | null;
    team_members: {
        id: number;
        email: string;
        title: string;
        full_name: string;
        avatar_url: string;
        slack_handle: string;
    }[];
    notes_count: number;
}>;
export declare const ClaudeSkillStatusSchema: z.ZodEnum<["pending_review", "reviewing", "approved", "rejected", "disabled"]>;
export declare const AgentSkillStatusSchema: z.ZodEnum<["draft", "pending_review", "approved", "rejected"]>;
export declare const AgentSkillVisibilitySchema: z.ZodEnum<["private", "team", "public"]>;
export declare const CanvasNodeSchema: z.ZodType<{
    id: string;
    type: string;
    props: Record<string, unknown>;
    children: unknown[];
}>;
export declare const ExportItemTypeSchema: z.ZodEnum<["account", "action_item", "reminder", "calendar_event", "team_member", "note"]>;
export declare const ExportItemSchema: z.ZodObject<{
    id: z.ZodString;
    type: z.ZodEnum<["account", "action_item", "reminder", "calendar_event", "team_member", "note"]>;
    label: z.ZodString;
    summary: z.ZodString;
    content: z.ZodString;
    accountId: z.ZodOptional<z.ZodNumber>;
    accountName: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    type: "account" | "calendar_event" | "action_item" | "reminder" | "team_member" | "note";
    id: string;
    label: string;
    summary: string;
    content: string;
    accountId?: number | undefined;
    accountName?: string | undefined;
}, {
    type: "account" | "calendar_event" | "action_item" | "reminder" | "team_member" | "note";
    id: string;
    label: string;
    summary: string;
    content: string;
    accountId?: number | undefined;
    accountName?: string | undefined;
}>;
export declare const LogCategorySchema: z.ZodEnum<["account", "team", "action_item", "calendar"]>;
export declare const LogResourceSchema: z.ZodObject<{
    type: z.ZodEnum<["account", "action_item", "calendar_event", "reminder"]>;
    id: z.ZodUnion<[z.ZodNumber, z.ZodString]>;
}, "strip", z.ZodTypeAny, {
    type: "account" | "calendar_event" | "action_item" | "reminder";
    id: string | number;
}, {
    type: "account" | "calendar_event" | "action_item" | "reminder";
    id: string | number;
}>;
export declare const LogEntrySchema: z.ZodObject<{
    id: z.ZodString;
    ts: z.ZodNumber;
    category: z.ZodEnum<["account", "team", "action_item", "calendar"]>;
    message: z.ZodString;
    links: z.ZodOptional<z.ZodArray<z.ZodObject<{
        label: z.ZodString;
        url: z.ZodString;
    }, "strip", z.ZodTypeAny, {
        url: string;
        label: string;
    }, {
        url: string;
        label: string;
    }>, "many">>;
    resource: z.ZodOptional<z.ZodObject<{
        type: z.ZodEnum<["account", "action_item", "calendar_event", "reminder"]>;
        id: z.ZodUnion<[z.ZodNumber, z.ZodString]>;
    }, "strip", z.ZodTypeAny, {
        type: "account" | "calendar_event" | "action_item" | "reminder";
        id: string | number;
    }, {
        type: "account" | "calendar_event" | "action_item" | "reminder";
        id: string | number;
    }>>;
    restoreData: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
}, "strip", z.ZodTypeAny, {
    message: string;
    id: string;
    ts: number;
    category: "account" | "action_item" | "team" | "calendar";
    links?: {
        url: string;
        label: string;
    }[] | undefined;
    resource?: {
        type: "account" | "calendar_event" | "action_item" | "reminder";
        id: string | number;
    } | undefined;
    restoreData?: Record<string, unknown> | undefined;
}, {
    message: string;
    id: string;
    ts: number;
    category: "account" | "action_item" | "team" | "calendar";
    links?: {
        url: string;
        label: string;
    }[] | undefined;
    resource?: {
        type: "account" | "calendar_event" | "action_item" | "reminder";
        id: string | number;
    } | undefined;
    restoreData?: Record<string, unknown> | undefined;
}>;
export declare function PaginatedResponseSchema<T extends z.ZodTypeAny>(itemSchema: T): z.ZodObject<{
    count: z.ZodNumber;
    next: z.ZodNullable<z.ZodString>;
    previous: z.ZodNullable<z.ZodString>;
    results: z.ZodArray<T, "many">;
}, "strip", z.ZodTypeAny, {
    count: number;
    next: string | null;
    previous: string | null;
    results: T["_output"][];
}, {
    count: number;
    next: string | null;
    previous: string | null;
    results: T["_input"][];
}>;
//# sourceMappingURL=schemas.d.ts.map