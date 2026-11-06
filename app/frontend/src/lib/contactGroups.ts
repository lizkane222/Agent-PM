import type { CustomerContact } from "../types";

export const NO_TEAM_LABEL = "No team";

export interface ContactGroup {
  /** Trimmed team name, "" for contacts with no team. */
  team: string;
  label: string;
  contacts: CustomerContact[];
}

/** Group contacts by customer team: groups A-Z with "No team" last; starred contacts first, then by name. */
export function groupContactsByTeam(contacts: CustomerContact[]): ContactGroup[] {
  const map = new Map<string, CustomerContact[]>();
  for (const c of contacts) {
    const key = (c.team ?? "").trim();
    const list = map.get(key) ?? [];
    list.push(c);
    map.set(key, list);
  }
  const groups: ContactGroup[] = [...map.entries()].map(([team, list]) => ({
    team,
    label: team || NO_TEAM_LABEL,
    contacts: [...list].sort(
      (a, b) =>
        Number(!!b.is_main_poc) - Number(!!a.is_main_poc) ||
        a.name.localeCompare(b.name, undefined, { sensitivity: "base" })
    ),
  }));
  return groups.sort((a, b) => {
    if (!a.team) return 1;
    if (!b.team) return -1;
    return a.team.localeCompare(b.team, undefined, { sensitivity: "base" });
  });
}

/** Distinct existing team names (case-insensitive), alphabetical, for a datalist. */
export function teamSuggestions(contacts: CustomerContact[]): string[] {
  const seen = new Map<string, string>();
  for (const c of contacts) {
    const t = (c.team ?? "").trim();
    if (t && !seen.has(t.toLowerCase())) seen.set(t.toLowerCase(), t);
  }
  return [...seen.values()].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
}
