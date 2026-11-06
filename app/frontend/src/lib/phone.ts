// Phone numbers are stored in E.164 ("+14155550123") — what Twilio SMS needs. The Settings
// input edits them as a country code + national number; these convert between the two.

export interface CountryCode { iso: string; name: string; dial: string }

/** Common first, then alphabetical. Dial codes shared by several countries list each one. */
export const COUNTRY_CODES: CountryCode[] = [
  { iso: "US", name: "United States", dial: "1" },
  { iso: "CA", name: "Canada", dial: "1" },
  { iso: "GB", name: "United Kingdom", dial: "44" },
  { iso: "IE", name: "Ireland", dial: "353" },
  { iso: "AU", name: "Australia", dial: "61" },
  { iso: "NZ", name: "New Zealand", dial: "64" },
  { iso: "IN", name: "India", dial: "91" },
  { iso: "DE", name: "Germany", dial: "49" },
  { iso: "FR", name: "France", dial: "33" },
  { iso: "ES", name: "Spain", dial: "34" },
  { iso: "IT", name: "Italy", dial: "39" },
  { iso: "NL", name: "Netherlands", dial: "31" },
  { iso: "BE", name: "Belgium", dial: "32" },
  { iso: "CH", name: "Switzerland", dial: "41" },
  { iso: "SE", name: "Sweden", dial: "46" },
  { iso: "NO", name: "Norway", dial: "47" },
  { iso: "DK", name: "Denmark", dial: "45" },
  { iso: "FI", name: "Finland", dial: "358" },
  { iso: "PL", name: "Poland", dial: "48" },
  { iso: "PT", name: "Portugal", dial: "351" },
  { iso: "EE", name: "Estonia", dial: "372" },
  { iso: "IL", name: "Israel", dial: "972" },
  { iso: "AE", name: "United Arab Emirates", dial: "971" },
  { iso: "ZA", name: "South Africa", dial: "27" },
  { iso: "BR", name: "Brazil", dial: "55" },
  { iso: "MX", name: "Mexico", dial: "52" },
  { iso: "AR", name: "Argentina", dial: "54" },
  { iso: "CO", name: "Colombia", dial: "57" },
  { iso: "CL", name: "Chile", dial: "56" },
  { iso: "JP", name: "Japan", dial: "81" },
  { iso: "KR", name: "South Korea", dial: "82" },
  { iso: "CN", name: "China", dial: "86" },
  { iso: "HK", name: "Hong Kong", dial: "852" },
  { iso: "SG", name: "Singapore", dial: "65" },
  { iso: "PH", name: "Philippines", dial: "63" },
  { iso: "MY", name: "Malaysia", dial: "60" },
  { iso: "ID", name: "Indonesia", dial: "62" },
  { iso: "TH", name: "Thailand", dial: "66" },
  { iso: "VN", name: "Vietnam", dial: "84" },
];

const E164_RE = /^\+[1-9]\d{6,14}$/;

/** Split a stored E.164 number into a country ISO and the national digits. */
export function splitE164(value: string | null | undefined, fallbackIso = "US"): { iso: string; national: string } {
  const v = (value ?? "").trim();
  if (!v.startsWith("+")) return { iso: fallbackIso, national: v.replace(/\D/g, "") };
  const digits = v.slice(1).replace(/\D/g, "");
  // Longest dial-code match wins ("+353…" is Ireland, not "+35").
  const match = [...COUNTRY_CODES].sort((a, b) => b.dial.length - a.dial.length).find((c) => digits.startsWith(c.dial));
  if (!match) return { iso: fallbackIso, national: digits };
  // Shared codes (+1): keep the fallback if it uses the same code, so a Canadian stays Canadian.
  const fallback = COUNTRY_CODES.find((c) => c.iso === fallbackIso);
  const iso = fallback && fallback.dial === match.dial ? fallback.iso : match.iso;
  return { iso, national: digits.slice(match.dial.length) };
}

/** Join a country and a national number into E.164; "" when no number is entered. */
export function joinE164(iso: string, national: string): string {
  const digits = national.replace(/\D/g, "").replace(/^0+/, ""); // trunk "0" isn't dialled internationally
  if (!digits) return "";
  const country = COUNTRY_CODES.find((c) => c.iso === iso) ?? COUNTRY_CODES[0];
  return `+${country.dial}${digits}`;
}

export function isValidE164(value: string): boolean {
  return value === "" || E164_RE.test(value);
}
