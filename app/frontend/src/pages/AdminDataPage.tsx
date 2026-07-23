import { useCallback, useEffect, useState } from "react";
import { useCurrentUser } from "../context/CurrentUserContext";
import { salesforceApi, skillsApi, realtimeApi, teamApi } from "../lib/api";
import type { SalesforceAccount, Tag, VoiceSession } from "../types";

type Section = "tags" | "teams" | "memberships" | "invocations" | "voice" | "sf-accounts";

interface TeamRow { id: number; name: string; slug: string; description: string; created_at: string }
interface MembershipRow { id: number; user: number; user_display: string; team: number; team_name: string; role: string; created_at: string }
interface InvocationRow {
  id: number;
  skill: number;
  skill_name: string;
  invoked_by: number | null;
  invoked_by_username: string | null;
  arguments: unknown;
  result: unknown;
  error: string;
  created_at: string;
}

const SECTIONS: { key: Section; label: string; description: string }[] = [
  { key: "tags", label: "Tags", description: "Colour-coded labels on team members and tasks." },
  { key: "teams", label: "Teams", description: "Team records shared across accounts." },
  { key: "memberships", label: "Memberships", description: "User ↔ team join rows." },
  { key: "invocations", label: "Skill Invocations", description: "Log of every Claude skill execution." },
  { key: "voice", label: "Voice Sessions", description: "Recorded voice-agent calls." },
  { key: "sf-accounts", label: "Salesforce Accounts", description: "Accounts pulled from Salesforce sync." },
];

export default function AdminDataPage() {
  const profile = useCurrentUser();
  const [section, setSection] = useState<Section>("tags");

  if (profile === null) {
    return <div className="p-6 text-sm text-[var(--twilio-navy)]">Loading…</div>;
  }
  if (!profile.is_staff) {
    return (
      <div className="p-6 max-w-lg">
        <h1 className="text-lg font-semibold text-[var(--twilio-navy)] mb-2">Admin Data</h1>
        <p className="text-sm text-gray-600">
          This page is only visible to staff users. Ask an admin if you need access.
        </p>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-[500px]">
      <aside className="w-56 border-r border-gray-200 bg-gray-50 p-4 shrink-0">
        <h1 className="text-sm font-semibold text-[var(--twilio-navy)] mb-3">Admin Data</h1>
        <nav className="flex flex-col gap-1">
          {SECTIONS.map((s) => (
            <button
              key={s.key}
              onClick={() => setSection(s.key)}
              className={`text-left rounded-md px-3 py-1.5 text-sm transition-colors ${
                section === s.key
                  ? "bg-[var(--twilio-blue)] text-white"
                  : "text-[var(--twilio-navy)] hover:bg-gray-200"
              }`}
            >
              {s.label}
            </button>
          ))}
        </nav>
      </aside>
      <main className="flex-1 overflow-y-auto p-6">
        <SectionView section={section} />
      </main>
    </div>
  );
}

function SectionView({ section }: { section: Section }) {
  const meta = SECTIONS.find((s) => s.key === section)!;
  return (
    <>
      <header className="mb-4">
        <h2 className="text-lg font-semibold text-[var(--twilio-navy)]">{meta.label}</h2>
        <p className="text-sm text-gray-500 mt-0.5">{meta.description}</p>
      </header>
      {section === "tags" && <TagsTable />}
      {section === "teams" && <TeamsTable />}
      {section === "memberships" && <MembershipsTable />}
      {section === "invocations" && <InvocationsTable />}
      {section === "voice" && <VoiceSessionsTable />}
      {section === "sf-accounts" && <SFAccountsTable />}
    </>
  );
}

function useList<T>(fetcher: () => Promise<{ data: { results: T[] } }>): {
  rows: T[];
  loading: boolean;
  error: string | null;
  refresh: () => void;
} {
  const [rows, setRows] = useState<T[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetcher();
      setRows(res.data.results);
    } catch (err: unknown) {
      const status = (err as { response?: { status?: number } })?.response?.status;
      setError(status === 403 ? "Forbidden (staff-only endpoint)." : "Failed to load.");
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => { void load(); }, [load]);
  return { rows, loading, error, refresh: () => void load() };
}

function TableWrapper({ loading, error, empty, children }: {
  loading: boolean;
  error: string | null;
  empty: boolean;
  children: React.ReactNode;
}) {
  if (loading) return <p className="text-sm text-gray-500">Loading…</p>;
  if (error) return <p className="text-sm text-red-600">{error}</p>;
  if (empty) return <p className="text-sm text-gray-500 italic">No rows.</p>;
  return <div className="overflow-x-auto">{children}</div>;
}

function TagsTable() {
  const { rows, loading, error } = useList<Tag>(() => teamApi.listTags());
  return (
    <TableWrapper loading={loading} error={error} empty={rows.length === 0}>
      <table className="min-w-full text-sm border border-gray-200 rounded-lg overflow-hidden">
        <thead className="bg-gray-50">
          <tr>
            <Th>ID</Th><Th>Name</Th><Th>Color</Th><Th>Description</Th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} className="border-t border-gray-100">
              <Td>{r.id}</Td>
              <Td>{r.name}</Td>
              <Td>
                <span className="inline-flex items-center gap-1.5">
                  <span className="w-3 h-3 rounded-sm border border-gray-200" style={{ background: r.color || "#ccc" }} />
                  <code className="text-xs text-gray-500">{r.color || "—"}</code>
                </span>
              </Td>
              <Td>{r.description || "—"}</Td>
            </tr>
          ))}
        </tbody>
      </table>
    </TableWrapper>
  );
}

function TeamsTable() {
  const { rows, loading, error } = useList<TeamRow>(() => teamApi.listTeams());
  return (
    <TableWrapper loading={loading} error={error} empty={rows.length === 0}>
      <table className="min-w-full text-sm border border-gray-200 rounded-lg overflow-hidden">
        <thead className="bg-gray-50">
          <tr>
            <Th>ID</Th><Th>Name</Th><Th>Slug</Th><Th>Description</Th><Th>Created</Th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} className="border-t border-gray-100">
              <Td>{r.id}</Td>
              <Td>{r.name}</Td>
              <Td><code className="text-xs text-gray-500">{r.slug}</code></Td>
              <Td>{r.description || "—"}</Td>
              <Td>{fmtDate(r.created_at)}</Td>
            </tr>
          ))}
        </tbody>
      </table>
    </TableWrapper>
  );
}

function MembershipsTable() {
  const { rows, loading, error } = useList<MembershipRow>(() => teamApi.listMemberships());
  return (
    <TableWrapper loading={loading} error={error} empty={rows.length === 0}>
      <table className="min-w-full text-sm border border-gray-200 rounded-lg overflow-hidden">
        <thead className="bg-gray-50">
          <tr>
            <Th>ID</Th><Th>User</Th><Th>Team</Th><Th>Role</Th><Th>Created</Th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} className="border-t border-gray-100">
              <Td>{r.id}</Td>
              <Td>{r.user_display} <span className="text-xs text-gray-400">#{r.user}</span></Td>
              <Td>{r.team_name} <span className="text-xs text-gray-400">#{r.team}</span></Td>
              <Td><code className="text-xs">{r.role}</code></Td>
              <Td>{fmtDate(r.created_at)}</Td>
            </tr>
          ))}
        </tbody>
      </table>
    </TableWrapper>
  );
}

function InvocationsTable() {
  const { rows, loading, error } = useList<InvocationRow>(() => skillsApi.listInvocations());
  return (
    <TableWrapper loading={loading} error={error} empty={rows.length === 0}>
      <table className="min-w-full text-sm border border-gray-200 rounded-lg overflow-hidden">
        <thead className="bg-gray-50">
          <tr>
            <Th>ID</Th><Th>Skill</Th><Th>Invoked by</Th><Th>Error</Th><Th>Created</Th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} className="border-t border-gray-100">
              <Td>{r.id}</Td>
              <Td>{r.skill_name || `#${r.skill}`}</Td>
              <Td>{r.invoked_by_username || (r.invoked_by ? `#${r.invoked_by}` : "—")}</Td>
              <Td>{r.error ? <span className="text-red-600 text-xs">{r.error}</span> : <span className="text-gray-400">—</span>}</Td>
              <Td>{fmtDate(r.created_at)}</Td>
            </tr>
          ))}
        </tbody>
      </table>
    </TableWrapper>
  );
}

function VoiceSessionsTable() {
  const { rows, loading, error } = useList<VoiceSession>(() => realtimeApi.listVoiceSessions());
  return (
    <TableWrapper loading={loading} error={error} empty={rows.length === 0}>
      <table className="min-w-full text-sm border border-gray-200 rounded-lg overflow-hidden">
        <thead className="bg-gray-50">
          <tr>
            <Th>ID</Th><Th>Call SID</Th><Th>From</Th><Th>To</Th><Th>Status</Th><Th>Duration</Th><Th>Started</Th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} className="border-t border-gray-100">
              <Td>{r.id}</Td>
              <Td><code className="text-xs text-gray-500">{r.call_sid}</code></Td>
              <Td>{r.from_number || "—"}</Td>
              <Td>{r.to_number || "—"}</Td>
              <Td>{r.status}</Td>
              <Td>{r.duration_seconds ? `${r.duration_seconds}s` : "—"}</Td>
              <Td>{fmtDate(r.started_at)}</Td>
            </tr>
          ))}
        </tbody>
      </table>
    </TableWrapper>
  );
}

function SFAccountsTable() {
  const { rows, loading, error } = useList<SalesforceAccount>(() => salesforceApi.listAccounts());
  return (
    <TableWrapper loading={loading} error={error} empty={rows.length === 0}>
      <table className="min-w-full text-sm border border-gray-200 rounded-lg overflow-hidden">
        <thead className="bg-gray-50">
          <tr>
            <Th>ID</Th><Th>SF ID</Th><Th>Name</Th><Th>Type</Th><Th>Industry</Th><Th>Owner</Th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} className="border-t border-gray-100">
              <Td>{r.id}</Td>
              <Td><code className="text-xs text-gray-500">{r.sf_id}</code></Td>
              <Td>{r.name}</Td>
              <Td>{r.account_type || "—"}</Td>
              <Td>{r.industry || "—"}</Td>
              <Td>{r.owner_name || "—"}</Td>
            </tr>
          ))}
        </tbody>
      </table>
    </TableWrapper>
  );
}

function Th({ children }: { children: React.ReactNode }) {
  return <th className="px-3 py-2 text-left text-xs font-semibold text-gray-600 uppercase tracking-wide">{children}</th>;
}
function Td({ children }: { children: React.ReactNode }) {
  return <td className="px-3 py-2 text-[var(--twilio-navy)] align-top">{children}</td>;
}
function fmtDate(v: string | null | undefined): string {
  if (!v) return "—";
  try { return new Date(v).toLocaleString(); } catch { return v; }
}
