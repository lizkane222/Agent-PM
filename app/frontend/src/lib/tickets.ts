import type { TicketKind, TicketStatus } from "../types";

export const TICKET_STATUSES: readonly TicketStatus[] = ["open", "in_progress", "waiting", "resolved", "closed"];

export const TICKET_STATUS_LABEL: Record<TicketStatus, string> = {
  open: "Open",
  in_progress: "In Progress",
  waiting: "Waiting",
  resolved: "Resolved",
  closed: "Closed",
};

export const TICKET_STATUS_COLOR: Record<string, string> = {
  open: "bg-blue-100 text-blue-700",
  in_progress: "bg-amber-100 text-amber-700",
  waiting: "bg-purple-100 text-purple-700",
  resolved: "bg-emerald-100 text-emerald-700",
  closed: "bg-gray-200 text-gray-600",
};

export const TICKET_KINDS: readonly TicketKind[] = ["jira", "zendesk", "product_gap"];

/** Heading used for each kind's section on the account page. */
export const TICKET_KIND_TITLE: Record<TicketKind, string> = {
  jira: "JIRAs / Engineering Tickets",
  zendesk: "Zendesk / Support Tickets",
  product_gap: "Product Gaps",
};

/** Short label used in lists and the category select. */
export const TICKET_KIND_LABEL: Record<TicketKind, string> = {
  jira: "JIRAs",
  zendesk: "Zendesk",
  product_gap: "Product Gaps",
};

export const TICKET_EMPTY_TEXT: Record<TicketKind, string> = {
  jira: "No JIRA tickets linked to this account yet.",
  zendesk: "No Zendesk tickets linked to this account yet.",
  product_gap: "No product gaps recorded for this account yet.",
};

/** Local time for display; the caller puts the full ISO string in a tooltip. */
export function formatTicketTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(undefined, { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });
}

export function looksLikeUrl(text: string): boolean {
  return /^https?:\/\/\S+$/i.test(text.trim());
}
