// ── Discover / Applets domain types ──────────────────────────────────────────

export type AppletCategory =
  | "Automation"
  | "Dashboard"
  | "Bot"
  | "Integration"
  | "Tool"
  | "Game"
  | "Utility";

export type ItemType = "applet" | "repo";

export type UrlStatus = "idle" | "testing" | "ok" | "unreachable";

export interface DiscoverApplet {
  id: number;
  type: "applet" | "repo";
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
