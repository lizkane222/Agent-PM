// A team member has one primary `email` plus any number of `additional_emails` (a Segment or
// SendGrid address, say). Anything that must pick ONE address uses preferredEmail().

export interface HasEmails {
  email?: string | null;
  additional_emails?: string[] | null;
}

export const PREFERRED_EMAIL_DOMAIN = "twilio.com";

/** Every address, primary first, de-duplicated case-insensitively, blanks dropped. */
export function allEmails(m: HasEmails): string[] {
  const out: string[] = [];
  for (const raw of [m.email, ...(m.additional_emails ?? [])]) {
    const e = (raw ?? "").trim();
    if (e && !out.some((x) => x.toLowerCase() === e.toLowerCase())) out.push(e);
  }
  return out;
}

/** The twilio.com address if they have one, otherwise the primary, otherwise the first other. */
export function preferredEmail(m: HasEmails): string {
  const all = allEmails(m);
  return all.find((e) => e.toLowerCase().endsWith(`@${PREFERRED_EMAIL_DOMAIN}`)) ?? all[0] ?? "";
}

/** "a@x.com, b@y.com" -> ["a@x.com", "b@y.com"] (commas, semicolons or whitespace). */
export function parseEmailList(text: string): string[] {
  return text.split(/[\s,;]+/).map((s) => s.trim()).filter(Boolean);
}
