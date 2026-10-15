import { useEffect, useState } from "react";
import { teamApi, type AccessLevel, type DirectoryUser } from "../../lib/api";

export const ACCESS_LABELS: Record<AccessLevel, string> = { basic: "Basic", pm: "PM", admin: "Admin" };

const ACCESS_HELP: Record<AccessLevel, string> = {
  basic: "Edits their own data and the accounts they're on; assigns action items to teammates on those accounts; can only add or remove themselves on an account.",
  pm: "Everything Basic can, plus assigning anyone to accounts and accounts to anyone.",
  admin: "Full access, including user access levels and the staff data view.",
};

/** Admin-only: search users and change their access level. */
export default function UserAccessPanel() {
  const [query, setQuery] = useState("");
  const [users, setUsers] = useState<DirectoryUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    const t = setTimeout(() => {
      teamApi.listUserDirectory(query.trim())
        .then(({ data }) => { if (!cancelled) setUsers(data.results); })
        .catch(() => { if (!cancelled) setError("Couldn't load users."); })
        .finally(() => { if (!cancelled) setLoading(false); });
    }, 250);
    return () => { cancelled = true; clearTimeout(t); };
  }, [query]);

  async function change(user: DirectoryUser, level: AccessLevel) {
    if (level === user.access_level) return;
    setSavingId(user.profile_id);
    setError(null);
    try {
      const { data } = await teamApi.setAccessLevel(user.profile_id, level);
      setUsers((prev) => prev.map((u) => (u.profile_id === user.profile_id ? { ...u, access_level: data.access_level } : u)));
    } catch (err: unknown) {
      const detail = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      setError(detail ?? "Couldn't change that user's access.");
    } finally {
      setSavingId(null);
    }
  }

  return (
    <div className="space-y-3">
      <div>
        <p className="text-sm font-semibold text-[var(--twilio-navy)]">User access</p>
        <p className="text-xs text-[var(--twilio-gray-60)] mt-0.5">Search for a user and set their access level.</p>
      </div>
      <input
        type="search"
        aria-label="Search users"
        placeholder="Search by name, username or email…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
      />
      {error && <p role="alert" className="text-xs text-red-600">{error}</p>}
      <div className="divide-y divide-gray-100 rounded-md border border-gray-100 max-h-80 overflow-y-auto">
        {loading && users.length === 0 ? (
          <p className="px-3 py-2 text-xs text-gray-500">Loading…</p>
        ) : users.length === 0 ? (
          <p className="px-3 py-2 text-xs text-gray-500">No users match.</p>
        ) : (
          users.map((u) => (
            <div key={u.profile_id} data-testid="access-row" className="flex items-center justify-between gap-3 px-3 py-2">
              <div className="min-w-0">
                <p className="text-sm font-medium text-[var(--twilio-navy)] truncate">
                  {u.display_name}{u.is_self && <span className="text-xs text-gray-400"> (you)</span>}
                </p>
                <p className="text-xs text-gray-500 truncate">{u.email || u.username}</p>
              </div>
              <select
                aria-label={`Access level for ${u.display_name}`}
                value={u.access_level}
                disabled={savingId === u.profile_id}
                title={ACCESS_HELP[u.access_level]}
                onChange={(e) => void change(u, e.target.value as AccessLevel)}
                className="shrink-0 rounded-md border border-gray-300 px-2 py-1 text-sm focus:border-indigo-500 focus:outline-none"
              >
                {(Object.keys(ACCESS_LABELS) as AccessLevel[]).map((lvl) => (
                  <option key={lvl} value={lvl}>{ACCESS_LABELS[lvl]}</option>
                ))}
              </select>
            </div>
          ))
        )}
      </div>
      <ul className="space-y-1 text-xs text-[var(--twilio-gray-60)]">
        {(Object.keys(ACCESS_LABELS) as AccessLevel[]).map((lvl) => (
          <li key={lvl}><span className="font-semibold text-[var(--twilio-navy)]">{ACCESS_LABELS[lvl]}:</span> {ACCESS_HELP[lvl]}</li>
        ))}
      </ul>
    </div>
  );
}
