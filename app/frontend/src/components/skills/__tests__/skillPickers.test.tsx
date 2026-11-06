import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { useState } from "react";
import { http, HttpResponse } from "msw";
import { server } from "../../../test/msw-server";
import SkillMultiPicker from "../SkillMultiPicker";
import CapabilityPicker from "../CapabilityPicker";
import AccountMultiSelect from "../AccountMultiSelect";
import SlackSourcesField from "../SlackSourcesField";
import AttachmentDropzone, { type PendingAttachment } from "../AttachmentDropzone";
import ContextRecordsField from "../ContextRecordsField";
import type { AgentTool, SlackSource, SkillContextRecord } from "../../../types/agents";

const OPTIONS = [
  { id: "twilio-call-recordings", label: "Call Recordings", detail: "Record voice calls", group: "Twilio" },
  { id: "twilio-conference-calls", label: "Conference Calls", detail: "Multi-party calls", group: "Twilio" },
  { id: "sendgrid-email", label: "SendGrid Email", detail: "Send email", group: "SendGrid" },
];

function Picker({ initial = [] as string[], onChange = vi.fn() }) {
  const [sel, setSel] = useState<string[]>(initial);
  return <SkillMultiPicker label="TWILIO SKILLS" options={OPTIONS} selected={sel}
    onChange={(ids) => { setSel(ids); onChange(ids); }} />;
}

describe("SkillMultiPicker", () => {
  it("filters by search, multiselects, and shows selections as removable chips", () => {
    const onChange = vi.fn();
    render(<Picker onChange={onChange} />);
    const box = screen.getByLabelText("TWILIO SKILLS");
    fireEvent.focus(box);
    fireEvent.change(box, { target: { value: "call" } });
    expect(screen.queryByRole("option", { name: /SendGrid Email/ })).not.toBeInTheDocument();
    fireEvent.mouseDown(screen.getByRole("option", { name: /Call Recordings/ }));
    fireEvent.mouseDown(screen.getByRole("option", { name: /Conference Calls/ }));
    expect(onChange).toHaveBeenLastCalledWith(["twilio-call-recordings", "twilio-conference-calls"]);
    expect(screen.getByRole("button", { name: "Remove Call Recordings" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Remove Call Recordings" }));
    expect(onChange).toHaveBeenLastCalledWith(["twilio-conference-calls"]);
  });

  it("groups options under headings", () => {
    render(<Picker />);
    fireEvent.focus(screen.getByLabelText("TWILIO SKILLS"));
    expect(screen.getByText("SENDGRID")).toBeInTheDocument();
  });

  it("when disabled it explains why and offers no search", () => {
    render(<SkillMultiPicker label="SLACK" options={[]} selected={[]} onChange={() => {}} disabledReason="Not connected yet" />);
    expect(screen.getByText("Not connected yet")).toBeInTheDocument();
    expect(screen.queryByLabelText("SLACK")).not.toBeInTheDocument();
  });
});

const TOOLS: AgentTool[] = [
  { name: "create_reminder", group: "create", description: "Create a reminder", skill_safe: true, requires_confirmation: false },
  { name: "list_reminders", group: "read", description: "List reminders", skill_safe: true, requires_confirmation: false },
  { name: "search_records", group: "read", description: "Search everything", skill_safe: true, requires_confirmation: false },
  { name: "send_sms", group: "communicate", description: "Text someone", skill_safe: false, requires_confirmation: true },
];

function Caps({ onChange = vi.fn() }) {
  const [sel, setSel] = useState<string[]>([]);
  return <CapabilityPicker tools={TOOLS} selected={sel} onChange={(n) => { setSel(n); onChange(n); }} />;
}

describe("CapabilityPicker", () => {
  it("counts only skill-safe tools and hides the list until opened", () => {
    render(<Caps />);
    expect(screen.getByText(/0 of 3 selected/)).toBeInTheDocument();
    expect(screen.queryByRole("checkbox", { name: "search_records" })).not.toBeInTheDocument();
  });

  it("View full list shows groups with descriptions, never unsafe tools", () => {
    render(<Caps />);
    fireEvent.click(screen.getByRole("button", { name: "View full list" }));
    fireEvent.click(screen.getByRole("button", { name: /Read \(0\/2\)/ }));
    expect(screen.getByRole("checkbox", { name: "search_records" })).toBeInTheDocument();
    expect(screen.getByText("Search everything")).toBeInTheDocument();
    expect(screen.queryByRole("checkbox", { name: "send_sms" })).not.toBeInTheDocument();
  });

  it("searching opens matching groups and Select all selects the group", () => {
    const onChange = vi.fn();
    render(<Caps onChange={onChange} />);
    fireEvent.change(screen.getByLabelText("Search capabilities"), { target: { value: "reminder" } });
    expect(screen.getByRole("checkbox", { name: "create_reminder" })).toBeInTheDocument();
    expect(screen.queryByRole("checkbox", { name: "search_records" })).not.toBeInTheDocument();
    fireEvent.click(screen.getAllByRole("button", { name: "Select all" })[0]);
    expect(onChange).toHaveBeenLastCalledWith(expect.arrayContaining(["list_reminders"]));
  });
});

describe("AccountMultiSelect", () => {
  const accounts = [
    { id: 1, company_name: "Acme Corp" }, { id: 2, company_name: "Globex" }, { id: 3, company_name: "Initech" },
  ];
  function Wrap({ onChange = vi.fn() }) {
    const [sel, setSel] = useState<number[]>([]);
    return <AccountMultiSelect selected={sel} onChange={(ids) => { setSel(ids); onChange(ids); }} />;
  }
  const serve = () => server.use(http.get("/api/v1/accounts/accounts/", () =>
    HttpResponse.json({ count: 3, next: null, previous: null, results: accounts })));

  it("Select all picks every account and the button becomes Clear all", async () => {
    serve();
    const onChange = vi.fn();
    render(<Wrap onChange={onChange} />);
    await screen.findByRole("checkbox", { name: "Acme Corp" });
    fireEvent.click(screen.getByRole("button", { name: "Select all" }));
    expect(onChange).toHaveBeenLastCalledWith([1, 2, 3]);
    expect(screen.getByText(/3 of 3/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Clear all" }));
    expect(onChange).toHaveBeenLastCalledWith([]);
  });

  it("filters the list and toggles individual accounts", async () => {
    serve();
    const onChange = vi.fn();
    render(<Wrap onChange={onChange} />);
    await screen.findByRole("checkbox", { name: "Acme Corp" });
    fireEvent.change(screen.getByLabelText("Filter accounts"), { target: { value: "glob" } });
    expect(screen.queryByRole("checkbox", { name: "Acme Corp" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("checkbox", { name: "Globex" }));
    expect(onChange).toHaveBeenLastCalledWith([2]);
  });

  it("says so when the user has no accounts", async () => {
    server.use(http.get("/api/v1/accounts/accounts/", () => HttpResponse.json({ count: 0, next: null, previous: null, results: [] })));
    render(<Wrap />);
    expect(await screen.findByText(/aren't on any accounts/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Select all" })).toBeDisabled();
  });
});

describe("SlackSourcesField", () => {
  it("is a disabled 'not connected yet' state until a token exists", async () => {
    render(<SlackSourcesField value={[]} onChange={() => {}} />);
    expect(await screen.findByText(/Slack isn't connected yet/i)).toBeInTheDocument();
    expect(screen.getByText(/channels and DMs will appear here/i)).toBeInTheDocument();
  });

  it("lists channels and DMs under headings once Slack is connected, and selects them", async () => {
    server.use(http.get("/api/v1/integrations/slack/conversations/", () => HttpResponse.json({
      enabled: true, dms_available: true, conversations: [
        { id: "C1", kind: "channel", label: "#acme-team" }, { id: "D1", kind: "dm", label: "Melissa Ramirez" },
      ],
    })));
    const onChange = vi.fn();
    render(<SlackSourcesField value={[]} onChange={onChange} />);
    const box = await screen.findByLabelText(/SLACK CHANNELS/);
    fireEvent.focus(box);
    expect(screen.getByText("DIRECT MESSAGES")).toBeInTheDocument();
    fireEvent.mouseDown(screen.getByRole("option", { name: /acme-team/ }));
    expect(onChange).toHaveBeenCalledWith([{ id: "C1", kind: "channel", label: "#acme-team" }]);
  });

  it("says DMs need the user's own Slack when only the bot token is available", async () => {
    server.use(http.get("/api/v1/integrations/slack/conversations/", () => HttpResponse.json({
      enabled: true, dms_available: false, conversations: [{ id: "C1", kind: "channel", label: "#general" }],
    })));
    render(<SlackSourcesField value={[]} onChange={() => {}} />);
    expect(await screen.findByText(/channels only/i)).toBeInTheDocument();
  });

  it("keeps already-chosen sources visible even if the live list no longer has them", async () => {
    const chosen: SlackSource[] = [{ id: "C9", kind: "channel", label: "#archived" }];
    render(<SlackSourcesField value={chosen} onChange={() => {}} />);
    await screen.findByText(/Slack isn't connected yet/i);
    expect(screen.getByText("#archived")).toBeInTheDocument();
  });
});

describe("AttachmentDropzone", () => {
  function Wrap({ initial = [] as PendingAttachment[], onChange = vi.fn() }) {
    const [p, setP] = useState<PendingAttachment[]>(initial);
    return <AttachmentDropzone pending={p} onPendingChange={(n) => { setP(n); onChange(n); }} />;
  }
  const file = (name: string) => new File(["# hi"], name, { type: "text/markdown" });

  it("adds files from the picker and from a drop, and removes them", () => {
    const onChange = vi.fn();
    render(<Wrap onChange={onChange} />);
    fireEvent.change(screen.getByTestId("attachment-input"), { target: { files: [file("a.md")] } });
    expect(screen.getByText(/a\.md/)).toBeInTheDocument();
    expect(screen.getByText(/uploads when you save/i)).toBeInTheDocument();
    fireEvent.drop(screen.getByTestId("attachment-dropzone").firstElementChild!.nextElementSibling!, {
      dataTransfer: { files: [file("b.docx")] },
    });
    expect(screen.getByText(/b\.docx/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Remove a.md" }));
    expect(screen.queryByText(/a\.md/)).not.toBeInTheDocument();
  });

  it("accepts only http(s) links", () => {
    render(<Wrap />);
    const input = screen.getByLabelText("Attachment link");
    const add = screen.getByRole("button", { name: "Add link" });
    fireEvent.change(input, { target: { value: "javascript:alert(1)" } });
    expect(add).toBeDisabled();
    fireEvent.change(input, { target: { value: "https://docs.example.com/plan" } });
    expect(add).toBeEnabled();
    fireEvent.click(add);
    expect(screen.getByText(/docs\.example\.com\/plan/)).toBeInTheDocument();
  });

  it("shows saved attachments with View/Remove and the artifact note", () => {
    const onView = vi.fn(); const onRemove = vi.fn();
    render(<AttachmentDropzone pending={[]} onPendingChange={() => {}}
      saved={[{ id: 7, name: "Template.md", has_text: true, artifact: 3 }]} onView={onView} onRemoveSaved={onRemove} />);
    expect(screen.getByText(/filed as artifact/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "View" }));
    expect(onView).toHaveBeenCalledWith(7);
    fireEvent.click(screen.getByRole("button", { name: "Remove Template.md" }));
    expect(onRemove).toHaveBeenCalledWith(7);
  });
});

describe("ContextRecordsField", () => {
  it("searches any record type and pins/unpins results", async () => {
    server.use(http.get("/api/v1/search/", () => HttpResponse.json({ results: [
      { type: "airtable_account", type_label: "Account", id: 5, title: "Acme Corp", detail: "", account: "", meta: "", url: "/accounts/5", accent: "#00f" },
      { type: "meeting", type_label: "Meeting", id: 9, title: "Acme QBR", detail: "", account: "", meta: "", url: "/m/9", accent: "#0f0" },
    ] })));
    const onChange = vi.fn();
    function Wrap() {
      const [r, setR] = useState<SkillContextRecord[]>([]);
      return <ContextRecordsField records={r} onChange={(n) => { setR(n); onChange(n); }} />;
    }
    render(<Wrap />);
    const box = screen.getByLabelText("Search records");
    fireEvent.focus(box);
    fireEvent.change(box, { target: { value: "acme" } });
    const row = await screen.findByRole("option", { name: /Acme QBR/ });
    fireEvent.mouseDown(row);
    expect(onChange).toHaveBeenLastCalledWith([{ resource_type: "meeting", resource_id: 9, label: "Acme QBR", url: "/m/9" }]);
    fireEvent.click(screen.getByRole("button", { name: "Remove Acme QBR" }));
    expect(onChange).toHaveBeenLastCalledWith([]);
  });

  it("does not search below the minimum length", () => {
    render(<ContextRecordsField records={[]} onChange={() => {}} />);
    const box = screen.getByLabelText("Search records");
    fireEvent.focus(box);
    fireEvent.change(box, { target: { value: "a" } });
    expect(screen.queryByText(/Searching|No results/)).not.toBeInTheDocument();
  });
});
