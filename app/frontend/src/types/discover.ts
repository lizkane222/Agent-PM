// ── Discover / Applets domain types ──────────────────────────────────────────

export type AppletCategory =
  | "Automation"
  | "Dashboard"
  | "Bot"
  | "Integration"
  | "Tool"
  | "Game"
  | "Utility"
  | "Documentation"
  | "Reference"
  | "Reporting"
  | "Communication"
  | "Data"
  | "AI"
  | "Security"
  | "Productivity";

export type ItemType = "applet" | "repo" | "tool" | "site" | "doc";

export interface DiscoverTag {
  name: string;
  count: number;
}

/** One pin of an applet: account null = the user's own profile. */
export interface AppletPin {
  id: number;
  applet: Pick<DiscoverApplet, "id" | "type" | "name" | "description" | "url" | "category">;
  account: number | null;
  account_name: string | null;
  pinned_by_username: string;
  can_remove: boolean;
  created_at: string;
}

export type UrlStatus = "idle" | "testing" | "ok" | "unreachable";

export interface DiscoverApplet {
  id: number;
  type: ItemType;
  name: string;
  description: string;
  url: string;
  category: string;
  author: string;
  tags: string[];
  airtable_id: string;
  submitted_by_username: string | null;
  created_at: string;
  updated_at: string;
}
