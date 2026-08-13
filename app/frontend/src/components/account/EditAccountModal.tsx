import { useState } from "react";
import { accountsApi } from "../../lib/api";
import type { Account, TeamMember } from "../../types";

export function EditAccountModal({
  account,
  members,
  onClose,
  onSave,
}: {
  account: Account;
  members: TeamMember[];
  onClose: () => void;
  onSave: (updated: Account) => void;
}) {
  const [form, setForm] = useState({
    company_name: account.company_name,
    website: account.website ?? "",
    industry: account.industry ?? "",
    status: account.status,
    arr: account.arr ?? "",
    team_member_ids: (account.team_members ?? []).map((m) => m.id),
  });
  const [saving, setSaving] = useState(false);

  const set = (key: string, value: unknown) => setForm((f) => ({ ...f, [key]: value }));

  async function handleSave() {
    setSaving(true);
    try {
      const { data } = await accountsApi.updateAccount(account.id, {
        ...form,
        arr: form.arr === "" ? null : form.arr,
      } as Partial<Account>);
      onSave(data);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={onClose}>
      <div
        className="rounded-xl shadow-xl w-full max-w-lg mx-4 p-6"
        style={{ background: "var(--surface, #fff)", fontFamily: "var(--font-base)" }}
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-xl font-semibold mb-5" style={{ color: "var(--text-primary, #111)" }}>Edit Account</h2>

        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-[var(--twilio-navy)] mb-1">Company name *</label>
            <input
              autoFocus
              value={form.company_name}
              onChange={(e) => set("company_name", e.target.value)}
              className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-red-400 focus:outline-none focus:ring-1 focus:ring-red-200"
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-[var(--twilio-navy)] mb-1">Status</label>
              <select
                value={form.status}
                onChange={(e) => set("status", e.target.value)}
                className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-red-400 focus:outline-none focus:ring-1 focus:ring-red-200"
              >
                <option value="prospect">Prospect</option>
                <option value="active">Active</option>
                <option value="inactive">Inactive</option>
                <option value="churned">Churned</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-[var(--twilio-navy)] mb-1">Industry</label>
              <input
                value={form.industry}
                onChange={(e) => set("industry", e.target.value)}
                className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-red-400 focus:outline-none focus:ring-1 focus:ring-red-200"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-[var(--twilio-navy)] mb-1">Website</label>
              <input
                value={form.website}
                onChange={(e) => set("website", e.target.value)}
                placeholder="https://…"
                className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-red-400 focus:outline-none focus:ring-1 focus:ring-red-200"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-[var(--twilio-navy)] mb-1">ARR ($)</label>
              <input
                type="number"
                value={form.arr}
                onChange={(e) => set("arr", e.target.value)}
                placeholder="0"
                className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-red-400 focus:outline-none focus:ring-1 focus:ring-red-200"
              />
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-[var(--twilio-navy)] mb-2">Team members</label>
            <div className="flex flex-wrap gap-2">
              {members.map((m) => {
                const selected = form.team_member_ids.includes(m.id);
                return (
                  <button
                    key={m.id}
                    type="button"
                    onClick={() =>
                      set(
                        "team_member_ids",
                        selected
                          ? form.team_member_ids.filter((id) => id !== m.id)
                          : [...form.team_member_ids, m.id]
                      )
                    }
                    className="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-sm font-medium transition-all"
                    style={
                      selected
                        ? { background: "var(--twilio-red, #e22)", border: "1px solid var(--twilio-red, #e22)", color: "#fff" }
                        : { background: "var(--surface, #fff)", border: "1px solid var(--border, rgba(0,0,0,0.08))", color: "var(--text-primary, #111)" }
                    }
                  >
                    {m.full_name}
                  </button>
                );
              })}
              {members.length === 0 && <p className="text-sm text-[var(--twilio-gray-60)]">No team members found.</p>}
            </div>
          </div>
        </div>

        <div className="flex justify-end gap-2 mt-6">
          <button
            onClick={onClose}
            className="rounded-md px-4 py-2 text-sm font-medium hover:opacity-80 transition-opacity"
            style={{ border: "1px solid var(--border, rgba(0,0,0,0.08))", color: "var(--text-primary, #111)", background: "var(--surface, #fff)" }}
          >
            Cancel
          </button>
          <button
            onClick={() => void handleSave()}
            disabled={saving || !form.company_name}
            className="rounded-md px-4 py-2 text-sm font-medium disabled:opacity-50 hover:opacity-90 transition-opacity"
            style={{ background: "var(--twilio-red, #e22)", color: "#fff", border: "none" }}
          >
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}
