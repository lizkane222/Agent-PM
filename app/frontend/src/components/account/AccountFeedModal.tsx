/**
 * AccountFeedModal — configure drive folders, aliases, domains, and custom fields
 * for an account's sync feed.
 */

import { useCallback, useEffect, useState } from "react";
import { accountFeedApi } from "../../lib/api";
import type { AccountFeedConfig, AccountFeedCustomField, AirtableFieldType, AirtableFieldTypeChoice } from "../../types";

interface Props {
  accountId: number;
  onClose: () => void;
}

// ── Tag-input helper ──────────────────────────────────────────────────────────

interface TagInputProps {
  label: string;
  values: string[];
  placeholder?: string;
  onChange: (values: string[]) => void;
}

function TagInput({ label, values, placeholder, onChange }: TagInputProps) {
  const [draft, setDraft] = useState("");

  function addDraft() {
    const v = draft.trim();
    if (v && !values.includes(v)) onChange([...values, v]);
    setDraft("");
  }

  return (
    <div>
      <label className="block text-xs font-medium text-gray-600 mb-1">{label}</label>
      <div className="flex flex-wrap gap-1 mb-1.5">
        {values.map((v) => (
          <span key={v} className="inline-flex items-center gap-1 text-xs bg-blue-50 text-blue-700 ring-1 ring-blue-200 rounded-full px-2 py-0.5">
            {v}
            <button onClick={() => onChange(values.filter((x) => x !== v))} className="text-blue-400 hover:text-blue-600 leading-none">×</button>
          </span>
        ))}
      </div>
      <div className="flex gap-1.5">
        <input
          type="text"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" || e.key === ",") { e.preventDefault(); addDraft(); } }}
          placeholder={placeholder ?? "Add and press Enter"}
          className="flex-1 border border-gray-300 rounded-md px-2.5 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
        <button
          onClick={addDraft}
          className="px-2.5 py-1.5 text-xs rounded-md border border-gray-300 hover:bg-gray-50"
        >
          Add
        </button>
      </div>
    </div>
  );
}

// ── Custom fields section ─────────────────────────────────────────────────────

interface CustomFieldRowProps {
  field: AccountFeedCustomField;
  accountId: number;
  onDeleted: () => void;
  onUpdated: (f: AccountFeedCustomField) => void;
}

function CustomFieldRow({ field, accountId, onDeleted, onUpdated }: CustomFieldRowProps) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(field.value);
  const [saving, setSaving] = useState(false);

  async function save() {
    setSaving(true);
    try {
      const { data } = await accountFeedApi.updateCustomField(accountId, field.id, { value });
      onUpdated(data);
      setEditing(false);
    } finally {
      setSaving(false);
    }
  }

  async function del() {
    if (!confirm(`Delete field "${field.name}"?`)) return;
    await accountFeedApi.deleteCustomField(accountId, field.id);
    onDeleted();
  }

  return (
    <div className="flex items-center gap-2 py-1.5 border-b border-gray-100 last:border-0">
      <div className="flex-1 min-w-0">
        <p className="text-xs font-medium text-gray-800 truncate">{field.name}</p>
        {field.airtable_field_type && (
          <p className="text-[10px] text-gray-400">{field.airtable_field_type}</p>
        )}
      </div>
      {editing ? (
        <div className="flex items-center gap-1">
          <input
            autoFocus
            type="text"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            className="border border-gray-300 rounded px-2 py-1 text-xs w-32 focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <button onClick={save} disabled={saving} className="text-xs text-blue-600 hover:text-blue-800 disabled:opacity-50">Save</button>
          <button onClick={() => { setEditing(false); setValue(field.value); }} className="text-xs text-gray-400 hover:text-gray-600">✕</button>
        </div>
      ) : (
        <div className="flex items-center gap-2">
          <span className="text-xs text-gray-600 truncate max-w-[100px]">{field.value || <span className="italic text-gray-400">—</span>}</span>
          <button onClick={() => setEditing(true)} className="text-xs text-blue-500 hover:text-blue-700">Edit</button>
          <button onClick={del} className="text-xs text-red-400 hover:text-red-600">Delete</button>
        </div>
      )}
    </div>
  );
}

// ── Add Custom Field form ─────────────────────────────────────────────────────

interface AddFieldFormProps {
  accountId: number;
  choices: AirtableFieldTypeChoice[];
  onAdded: (f: AccountFeedCustomField) => void;
}

function AddFieldForm({ accountId, choices, onAdded }: AddFieldFormProps) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [value, setFieldValue] = useState("");
  const [type, setType] = useState<AirtableFieldType | "">("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function submit() {
    if (!name.trim()) { setError("Name is required"); return; }
    setSaving(true);
    setError("");
    try {
      const payload: { name: string; value: string; airtable_field_type?: string } = { name: name.trim(), value };
      if (type) payload.airtable_field_type = type;
      const { data } = await accountFeedApi.createCustomField(accountId, payload);
      onAdded(data);
      setName(""); setFieldValue(""); setType(""); setOpen(false);
    } catch {
      setError("Failed to create field");
    } finally {
      setSaving(false);
    }
  }

  if (!open) {
    return (
      <button onClick={() => setOpen(true)} className="mt-2 text-xs text-blue-600 hover:text-blue-800">
        + Add custom field
      </button>
    );
  }

  return (
    <div className="mt-3 border border-blue-200 rounded-lg p-3 bg-blue-50/40">
      <p className="text-xs font-medium text-gray-700 mb-2">New Custom Field</p>
      <div className="space-y-2">
        <input
          autoFocus
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Field name"
          className="w-full border border-gray-300 rounded-md px-2.5 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
        <input
          type="text"
          value={value}
          onChange={(e) => setFieldValue(e.target.value)}
          placeholder="Value (optional)"
          className="w-full border border-gray-300 rounded-md px-2.5 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
        <select
          value={type}
          onChange={(e) => setType(e.target.value as AirtableFieldType | "")}
          className="w-full border border-gray-300 rounded-md px-2.5 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-blue-500"
        >
          <option value="">Let Claude choose Airtable field type</option>
          {choices.map((c) => (
            <option key={c.value} value={c.value}>{c.label}</option>
          ))}
        </select>
        {error && <p className="text-xs text-red-600">{error}</p>}
        <div className="flex gap-2 justify-end">
          <button onClick={() => setOpen(false)} className="px-2.5 py-1.5 text-xs border border-gray-300 rounded-md hover:bg-gray-50">Cancel</button>
          <button onClick={submit} disabled={saving} className="px-2.5 py-1.5 text-xs bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50">
            {saving ? "Saving…" : "Add field"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Section header ────────────────────────────────────────────────────────────

function SectionHeader({ title }: { title: string }) {
  return <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2 mt-4">{title}</p>;
}

// ── Modal ─────────────────────────────────────────────────────────────────────

export function AccountFeedModal({ accountId, onClose }: Props) {
  const [config, setConfig] = useState<AccountFeedConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const [nameAliases, setNameAliases] = useState<string[]>([]);
  const [emailDomains, setEmailDomains] = useState<string[]>([]);
  const [confluenceSpaces, setConfluenceSpaces] = useState<string[]>([]);
  const [jiraProjects, setJiraProjects] = useState<string[]>([]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await accountFeedApi.getFeedConfig(accountId);
      setConfig(data);
      setNameAliases(data.name_aliases);
      setEmailDomains(data.email_domains);
      setConfluenceSpaces(data.confluence_spaces);
      setJiraProjects(data.jira_projects);
    } finally {
      setLoading(false);
    }
  }, [accountId]);

  useEffect(() => { void load(); }, [load]);

  async function save() {
    if (!config) return;
    setSaving(true);
    setError("");
    try {
      const { data } = await accountFeedApi.updateFeedConfig(accountId, {
        name_aliases: nameAliases,
        email_domains: emailDomains,
        confluence_spaces: confluenceSpaces,
        jira_projects: jiraProjects,
        drive_folders: config.drive_folders,
        zendesk_groups: config.zendesk_groups,
      });
      setConfig(data);
    } catch {
      setError("Failed to save changes");
    } finally {
      setSaving(false);
    }
  }

  function addCustomField(f: AccountFeedCustomField) {
    setConfig((prev) => prev ? { ...prev, custom_fields: [...prev.custom_fields, f] } : prev);
  }

  function removeCustomField(id: number) {
    setConfig((prev) => prev ? { ...prev, custom_fields: prev.custom_fields.filter((f) => f.id !== id) } : prev);
  }

  function updateCustomField(updated: AccountFeedCustomField) {
    setConfig((prev) => prev ? { ...prev, custom_fields: prev.custom_fields.map((f) => f.id === updated.id ? updated : f) } : prev);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-lg max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200">
          <h2 className="text-base font-semibold text-gray-900">Account Feed Config</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-lg leading-none">×</button>
        </div>

        {loading ? (
          <div className="flex-1 flex items-center justify-center text-sm text-gray-400 p-8">Loading…</div>
        ) : config ? (
          <div className="flex-1 overflow-y-auto px-5 py-4 space-y-1">
            <SectionHeader title="Matching" />
            <TagInput label="Name aliases" values={nameAliases} placeholder="e.g. Acme Corp" onChange={setNameAliases} />
            <div className="mt-3" />
            <TagInput label="Email domains" values={emailDomains} placeholder="e.g. acme.com" onChange={setEmailDomains} />

            <SectionHeader title="Integrations" />
            <TagInput label="Confluence spaces" values={confluenceSpaces} placeholder="e.g. ~spacekey" onChange={setConfluenceSpaces} />
            <div className="mt-3" />
            <TagInput label="JIRA projects" values={jiraProjects} placeholder="e.g. PROJ" onChange={setJiraProjects} />

            <SectionHeader title="Custom Fields" />
            {config.custom_fields.length === 0 ? (
              <p className="text-xs text-gray-400 italic">No custom fields yet.</p>
            ) : (
              <div className="border border-gray-200 rounded-lg divide-y divide-gray-100 px-3 py-1">
                {config.custom_fields.map((f) => (
                  <CustomFieldRow
                    key={f.id}
                    field={f}
                    accountId={accountId}
                    onDeleted={() => removeCustomField(f.id)}
                    onUpdated={updateCustomField}
                  />
                ))}
              </div>
            )}
            <AddFieldForm
              accountId={accountId}
              choices={config.airtable_field_type_choices}
              onAdded={addCustomField}
            />

            {error && <p className="text-xs text-red-600 mt-2">{error}</p>}
          </div>
        ) : (
          <div className="flex-1 flex items-center justify-center text-sm text-red-500 p-8">Failed to load config.</div>
        )}

        <div className="flex justify-end gap-2 px-5 py-3 border-t border-gray-200">
          <button onClick={onClose} className="px-4 py-2 text-sm border border-gray-300 rounded-md hover:bg-gray-50">Close</button>
          {config && (
            <button
              onClick={save}
              disabled={saving}
              className="px-4 py-2 text-sm bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50"
            >
              {saving ? "Saving…" : "Save changes"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
