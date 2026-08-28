// Ordered URL-pattern → resource-label classifier.
// First match wins; order is load-bearing (see fixture matrix).

const RESOURCE_LABELS: Array<[RegExp, string]> = [
  [/\/airtable\/action-items/, "Action Item"],
  [/\/airtable\/meetings/, "Meeting"],
  [/\/airtable\/accounts/, "Airtable Account"],
  [/\/accounts\/notes/, "Account Note"],
  [/\/accounts\/artifacts/, "Account Artifact"],
  [/\/accounts\/contacts/, "Contact"],
  [/\/accounts/, "Account"],
  [/\/scheduler\/events/, "Calendar Event"],
  [/\/scheduler\/action-items/, "Action Item"],
  [/\/scheduler\/reminders/, "Reminder"],
  [/\/scheduler\/tasks/, "Task"],
  [/\/scheduler\/meeting-notes/, "Meeting Note"],
  [/\/team\/members/, "Team Member"],
  [/\/team\/profile/, "Profile"],
  [/\/comments/, "Comment"],
  [/\/skills/, "Claude Skill"],
  [/\/layouts/, "Page Layout"],
  [/\/salesforce\/log-time/, "Salesforce Time Log"],
  [/\/discover/, "Discover Applet"],
];

export const MUTATING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

export function matchResourceLabel(url: string): string | null {
  const hit = RESOURCE_LABELS.find(([re]) => re.test(url));
  return hit ? hit[1] : null;
}
