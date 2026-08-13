import { http, HttpResponse } from "msw";
import type { AccountFeedConfig, AccountRole } from "../../types";

export const mockAccountFeedConfig: AccountFeedConfig = {
  id: 1,
  account: 1,
  drive_folders: [],
  name_aliases: ["Acme", "ACME Ltd"],
  email_domains: ["acme.com"],
  confluence_spaces: ["~acme"],
  jira_projects: ["ACME"],
  zendesk_groups: [],
  custom_fields: [],
  airtable_field_type_choices: [
    { value: "singleLineText", label: "Single line text" },
    { value: "multilineText", label: "Long text" },
    { value: "url", label: "URL" },
    { value: "number", label: "Number" },
    { value: "checkbox", label: "Checkbox" },
    { value: "date", label: "Date" },
    { value: "singleSelect", label: "Single select" },
    { value: "multipleSelects", label: "Multiple select" },
    { value: "multipleAttachments", label: "Attachment" },
  ],
  updated_at: "2026-08-01T00:00:00Z",
  updated_by: null,
};

export const mockAccountRole: AccountRole = {
  id: 1,
  user: 2,
  user_email: "reviewer@example.com",
  user_display: "Reviewer User",
  account: 1,
  role: "sync_reviewer",
  assigned_by: 1,
  assigned_by_email: "staff@example.com",
  created_at: "2026-08-01T00:00:00Z",
};

export const accountFeedHandlers = [
  http.get("/api/v1/account-feed/:accountId/feed/", () =>
    HttpResponse.json(mockAccountFeedConfig)
  ),
  http.put("/api/v1/account-feed/:accountId/feed/", async ({ request }) => {
    const body = await request.json() as Partial<AccountFeedConfig>;
    return HttpResponse.json({ ...mockAccountFeedConfig, ...body });
  }),
  http.post("/api/v1/account-feed/:accountId/feed/custom-fields/", async ({ request }) => {
    const body = await request.json() as Record<string, unknown>;
    return HttpResponse.json(
      {
        id: 99,
        name: body["name"] ?? "Field",
        value: body["value"] ?? "",
        airtable_field_type: body["airtable_field_type"] ?? "",
        airtable_field_id: "",
        created_by: 1,
        created_at: "2026-08-01T00:00:00Z",
      },
      { status: 201 }
    );
  }),
  http.patch("/api/v1/account-feed/:accountId/feed/custom-fields/:fieldId/", async ({ request }) => {
    const body = await request.json() as Record<string, unknown>;
    return HttpResponse.json({ id: 99, name: "Field", value: "", airtable_field_type: "", airtable_field_id: "", created_by: 1, created_at: "2026-08-01T00:00:00Z", ...body });
  }),
  http.delete("/api/v1/account-feed/:accountId/feed/custom-fields/:fieldId/", () =>
    new HttpResponse(null, { status: 204 })
  ),
  // Account roles
  http.get("/api/v1/accounts/roles/", () =>
    HttpResponse.json({ count: 1, next: null, previous: null, results: [mockAccountRole] })
  ),
  http.post("/api/v1/accounts/roles/", async ({ request }) => {
    const body = await request.json() as Partial<AccountRole>;
    return HttpResponse.json({ ...mockAccountRole, id: 99, ...body }, { status: 201 });
  }),
  http.delete("/api/v1/accounts/roles/:id/", () =>
    new HttpResponse(null, { status: 204 })
  ),
];
