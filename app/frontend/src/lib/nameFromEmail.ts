// Infer a person's first/last name from an email address.
//
// Pure and conservative: a wrong name saved silently is worse than a blank one. Callers
// must show anything below "high" confidence in an editable field and must never write
// it with one click.
//
//   high - two (or more) separated name tokens: jane.doe, jane_doe, jane-doe, john.q.public
//   low  - a guess the user must review: j.doe / jdoe (initial + surname),
//          3+ separated tokens with no initial in the middle (mary.ann.smith -> Mary / Smith;
//          the middle token is dropped, since it may be half of a first or last name)
//   none - role mailboxes, a single unseparated token (janedoe), or nothing usable
//
// Decisions: order is never reversed (doe.jane -> first "Doe"); plus-tags and digits are
// stripped; because "-" is an email separator a hyphenated surname cannot be told from
// two tokens, so "smith-jones" reads as first "Smith" / last "Jones" (high), which is why
// callers show it in the tooltip. Pass `knownNames` (full names already on the account)
// to resolve an unseparated "janedoe" with certainty.

export type NameConfidence = "high" | "low" | "none";

export interface InferredName {
  first: string;
  last: string;
  confidence: NameConfidence;
}

const NONE: InferredName = { first: "", last: "", confidence: "none" };

export const GENERIC_MAILBOXES = new Set([
  "info", "sales", "support", "noreply", "no-reply", "donotreply", "do-not-reply", "admin",
  "administrator", "hello", "hi", "team", "billing", "accounts", "account", "contact", "contactus",
  "help", "office", "mail", "email", "marketing", "hr", "jobs", "careers", "press", "media",
  "legal", "finance", "invoices", "invoice", "payments", "orders", "service", "services",
  "security", "abuse", "postmaster", "webmaster", "root", "enquiries", "inquiries", "feedback",
  "notifications", "notification", "alerts", "newsletter", "events", "it", "ops", "dev",
  "engineering", "operations", "procurement", "purchasing", "reception", "everyone", "all",
  "staff", "general", "bot", "calendar", "mailer", "mailer-daemon", "reply", "unsubscribe",
]);

// Short list used only to avoid reading a one-token first name ("marcus") as initial+surname.
const COMMON_FIRST_NAMES = new Set([
  "marcus", "daniel", "andrew", "robert", "joseph", "joshua", "justin", "jordan", "jared",
  "jason", "jesse", "jerry", "jimmy", "johnny", "ethan", "dylan", "kevin", "ryan", "brian",
  "chris", "david", "james", "john", "mark", "matt", "peter", "paul", "steve", "tom", "tim",
  "sarah", "emily", "laura", "linda", "karen", "susan", "maria", "julia", "alice", "nancy",
  "helen", "donna", "carol", "amanda", "angela", "anna", "diana", "grace", "hannah", "irene",
  "jamie", "janet", "joyce", "judith", "julie", "kelly", "lisa", "megan", "nicole", "olivia",
  "rachel", "rebecca", "sophia", "teresa", "victor", "walter", "oscar", "simon", "samuel",
]);

function lettersOnly(s: string): string {
  return s.replace(/[^\p{L}']/gu, "");
}

/** Title-case one token: jane -> Jane, o'brien -> O'Brien, mcdonald -> McDonald. */
export function properCase(token: string): string {
  const t = token.toLocaleLowerCase();
  if (!t) return "";
  const cap = (s: string) => (s ? s.charAt(0).toLocaleUpperCase() + s.slice(1) : s);
  if (t.includes("'")) return t.split("'").map(cap).join("'");
  if (/^mc\p{L}{3,}$/u.test(t)) return "Mc" + cap(t.slice(2));
  return cap(t);
}

function norm(s: string): string {
  return s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().replace(/[^a-z]/g, "");
}

export function isGenericMailbox(email: string): boolean {
  const local = localPart(email);
  if (!local) return false;
  const bare = local.replace(/[._-]+/g, "");
  return GENERIC_MAILBOXES.has(local) || GENERIC_MAILBOXES.has(bare);
}

function localPart(email: string): string {
  const at = email.lastIndexOf("@");
  if (at <= 0) return "";
  return email.slice(0, at).trim().toLowerCase().replace(/\+.*$/, "");
}

export function nameFromEmail(email: string, knownNames: string[] = []): InferredName {
  if (!email || !email.includes("@")) return NONE;
  const local = localPart(email);
  if (!local || isGenericMailbox(email)) return NONE;

  const parts = local
    .replace(/\d+/g, "")
    .split(/[._-]+/)
    .map(lettersOnly)
    .filter(Boolean);
  if (parts.length === 0) return NONE;
  if (parts.some((p) => GENERIC_MAILBOXES.has(p))) return NONE;

  if (parts.length === 1) {
    const token = parts[0];
    // A known name on the account resolves the ambiguity with certainty.
    for (const full of knownNames) {
      const bits = full.trim().split(/\s+/).filter(Boolean);
      if (bits.length < 2) continue;
      const first = bits[0];
      const last = bits[bits.length - 1];
      const joined = norm(first) + norm(last);
      if (joined && norm(token) === joined) {
        return { first: properCase(first), last: properCase(last), confidence: "high" };
      }
      if (norm(token) === norm(first).charAt(0) + norm(last)) {
        return { first: properCase(first), last: properCase(last), confidence: "low" };
      }
    }
    // jdoe -> J Doe (low). Longer unseparated tokens (janedoe) are not guessed.
    if (token.length >= 4 && token.length <= 6 && !COMMON_FIRST_NAMES.has(norm(token))) {
      return { first: token.charAt(0).toLocaleUpperCase(), last: properCase(token.slice(1)), confidence: "low" };
    }
    return NONE;
  }

  const firstTok = parts[0];
  const lastTok = parts[parts.length - 1];
  if (lastTok.length < 2) return NONE;

  if (parts.length === 2) {
    if (firstTok.length === 1) {
      return { first: firstTok.toLocaleUpperCase(), last: properCase(lastTok), confidence: "low" };
    }
    return { first: properCase(firstTok), last: properCase(lastTok), confidence: "high" };
  }

  // 3+ tokens: first token and last token; the middle is dropped.
  if (firstTok.length === 1) {
    return { first: firstTok.toLocaleUpperCase(), last: properCase(lastTok), confidence: "low" };
  }
  const middleIsInitial = parts.slice(1, -1).every((p) => p.length === 1);
  return {
    first: properCase(firstTok),
    last: properCase(lastTok),
    confidence: middleIsInitial ? "high" : "low",
  };
}

/** "Jane Doe" from an inferred name ("" when none). */
export function fullNameFromEmail(email: string, knownNames: string[] = []): { name: string; confidence: NameConfidence } {
  const r = nameFromEmail(email, knownNames);
  return { name: [r.first, r.last].filter(Boolean).join(" "), confidence: r.confidence };
}
