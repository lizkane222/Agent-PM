/**
 * Time zone lookup for the contact "Time zone" field. Pure and offline: everything resolves to an
 * IANA name using the tables below plus the browser's built-in Intl data. Display only.
 *
 * Decisions
 *  - A US state resolves to the zone covering most of it (or its capital). A state that spans two
 *    zones lists the other one as an alternative ("Other zone in this state").
 *  - A country with one civil zone resolves directly. A country with several (US, Canada, Brazil,
 *    Australia, Russia, Mexico, Indonesia, Kazakhstan) returns a chooser and no automatic answer.
 *    China is Asia/Shanghai only.
 *  - Abbreviations map to one representative zone (PST -> America/Los_Angeles, IST -> India).
 *    The zone's current abbreviation is shown after choosing, so PST in July reads PDT.
 */

export interface ZoneSuggestion {
  zone: string;
  label: string;
  /** What produced it: "zone" | "city" | "abbr" | "state" | "province" | "country". */
  kind: string;
  /** Present on the extra zone of a split state, e.g. "Other zone in this state". */
  hint?: string;
}

export interface ResolveResult {
  /** The single unambiguous answer, or null when the user has to pick. */
  zone: string | null;
  suggestions: ZoneSuggestion[];
  /** Other zones of the matched split state (empty otherwise). */
  alternatives: ZoneSuggestion[];
}

// ── Abbreviations ──────────────────────────────────────────────────────────────────────────────
export const ABBREVIATIONS: Record<string, string> = {
  PST: "America/Los_Angeles", PDT: "America/Los_Angeles", PT: "America/Los_Angeles",
  MST: "America/Denver", MDT: "America/Denver", MT: "America/Denver",
  CST: "America/Chicago", CDT: "America/Chicago", CT: "America/Chicago",
  EST: "America/New_York", EDT: "America/New_York", ET: "America/New_York",
  AKST: "America/Anchorage", AKDT: "America/Anchorage",
  HST: "Pacific/Honolulu", HAST: "Pacific/Honolulu",
  AST: "America/Halifax", ADT: "America/Halifax", NST: "America/St_Johns", NDT: "America/St_Johns",
  UTC: "UTC", GMT: "Etc/GMT",
  BST: "Europe/London", WET: "Europe/Lisbon", WEST: "Europe/Lisbon",
  CET: "Europe/Berlin", CEST: "Europe/Berlin", EET: "Europe/Athens", EEST: "Europe/Athens",
  MSK: "Europe/Moscow", IST: "Asia/Kolkata", PKT: "Asia/Karachi", NPT: "Asia/Kathmandu",
  BDT: "Asia/Dhaka", ICT: "Asia/Bangkok", WIB: "Asia/Jakarta", SGT: "Asia/Singapore",
  HKT: "Asia/Hong_Kong", PHT: "Asia/Manila", JST: "Asia/Tokyo", KST: "Asia/Seoul",
  GST: "Asia/Dubai", IRST: "Asia/Tehran", AWST: "Australia/Perth",
  ACST: "Australia/Adelaide", ACDT: "Australia/Adelaide",
  AEST: "Australia/Sydney", AEDT: "Australia/Sydney", NZST: "Pacific/Auckland", NZDT: "Pacific/Auckland",
  SAST: "Africa/Johannesburg", WAT: "Africa/Lagos", CAT: "Africa/Maputo", EAT: "Africa/Nairobi",
  BRT: "America/Sao_Paulo", ART: "America/Argentina/Buenos_Aires",
};

// ── US states: code|name|majority zone|other zone (optional) ───────────────────────────────────
const ET = "America/New_York", CT = "America/Chicago", MT = "America/Denver", PT = "America/Los_Angeles";
const ROWS_US: [string, string, string, string?][] = [
  ["AL", "Alabama", CT], ["AK", "Alaska", "America/Anchorage"], ["AZ", "Arizona", "America/Phoenix"],
  ["AR", "Arkansas", CT], ["CA", "California", PT], ["CO", "Colorado", MT], ["CT", "Connecticut", ET],
  ["DE", "Delaware", ET], ["DC", "District of Columbia", ET], ["FL", "Florida", ET, CT],
  ["GA", "Georgia", ET], ["HI", "Hawaii", "Pacific/Honolulu"], ["ID", "Idaho", MT, PT],
  ["IL", "Illinois", CT], ["IN", "Indiana", ET, CT], ["IA", "Iowa", CT], ["KS", "Kansas", CT, MT],
  ["KY", "Kentucky", ET, CT], ["LA", "Louisiana", CT], ["ME", "Maine", ET], ["MD", "Maryland", ET],
  ["MA", "Massachusetts", ET], ["MI", "Michigan", ET, CT], ["MN", "Minnesota", CT],
  ["MS", "Mississippi", CT], ["MO", "Missouri", CT], ["MT", "Montana", MT], ["NE", "Nebraska", CT, MT],
  ["NV", "Nevada", PT], ["NH", "New Hampshire", ET], ["NJ", "New Jersey", ET], ["NM", "New Mexico", MT],
  ["NY", "New York", ET], ["NC", "North Carolina", ET], ["ND", "North Dakota", CT, MT],
  ["OH", "Ohio", ET], ["OK", "Oklahoma", CT], ["OR", "Oregon", PT, MT], ["PA", "Pennsylvania", ET],
  ["RI", "Rhode Island", ET], ["SC", "South Carolina", ET], ["SD", "South Dakota", CT, MT],
  ["TN", "Tennessee", CT, ET], ["TX", "Texas", CT, MT], ["UT", "Utah", MT], ["VT", "Vermont", ET],
  ["VA", "Virginia", ET], ["WA", "Washington", PT], ["WV", "West Virginia", ET],
  ["WI", "Wisconsin", CT], ["WY", "Wyoming", MT],
];
/** Plain-language description of where the second zone applies, for the hint. */
const OTHER_ZONE_NOTE: Record<string, string> = {
  FL: "western panhandle", ID: "northern panhandle", IN: "northwest and southwest corners",
  KS: "far west", KY: "western half", MI: "western Upper Peninsula", NE: "western panhandle",
  ND: "southwest", OR: "Malheur County", SD: "western half", TN: "western two thirds (Memphis, Nashville)",
  TX: "El Paso area",
};
// Tennessee: majority by area is Central, East Tennessee is Eastern. The capital (Nashville) is Central.

const ROWS_CA: [string, string, string, string?][] = [
  ["AB", "Alberta", MT], ["BC", "British Columbia", PT], ["MB", "Manitoba", CT],
  ["NB", "New Brunswick", "America/Halifax"], ["NL", "Newfoundland and Labrador", "America/St_Johns"],
  ["NS", "Nova Scotia", "America/Halifax"], ["NT", "Northwest Territories", MT],
  ["NU", "Nunavut", CT], ["ON", "Ontario", "America/Toronto", CT], ["PE", "Prince Edward Island", "America/Halifax"],
  ["QC", "Quebec", "America/Toronto"], ["SK", "Saskatchewan", "America/Regina"], ["YT", "Yukon", "America/Whitehorse"],
];

// ── Countries: ISO|name|zones (first is the default; more than one means "chooser") ────────────
// [code, name, zones[], optional aliases]
type CountryRow = [string, string, string[], string[]?];
const COUNTRIES: CountryRow[] = [
  ["US", "United States", [ET, CT, MT, PT, "America/Anchorage", "Pacific/Honolulu"], ["USA", "America", "United States of America"]],
  ["CA", "Canada", ["America/St_Johns", "America/Halifax", "America/Toronto", CT, MT, PT]],
  ["MX", "Mexico", ["America/Mexico_City", "America/Tijuana", "America/Cancun", "America/Hermosillo"]],
  ["BR", "Brazil", ["America/Sao_Paulo", "America/Manaus", "America/Rio_Branco", "America/Noronha"]],
  ["AU", "Australia", ["Australia/Sydney", "Australia/Brisbane", "Australia/Adelaide", "Australia/Darwin", "Australia/Perth"]],
  ["RU", "Russia", ["Europe/Moscow", "Europe/Kaliningrad", "Asia/Yekaterinburg", "Asia/Novosibirsk", "Asia/Vladivostok"]],
  ["ID", "Indonesia", ["Asia/Jakarta", "Asia/Makassar", "Asia/Jayapura"]],
  ["KZ", "Kazakhstan", ["Asia/Almaty", "Asia/Aqtobe"]],
  ["CN", "China", ["Asia/Shanghai"], ["PRC"]],
  ["IN", "India", ["Asia/Kolkata"]],
  ["JP", "Japan", ["Asia/Tokyo"]],
  ["KR", "South Korea", ["Asia/Seoul"], ["Korea"]],
  ["KP", "North Korea", ["Asia/Pyongyang"]],
  ["TW", "Taiwan", ["Asia/Taipei"]],
  ["HK", "Hong Kong", ["Asia/Hong_Kong"]],
  ["SG", "Singapore", ["Asia/Singapore"]],
  ["MY", "Malaysia", ["Asia/Kuala_Lumpur"]],
  ["TH", "Thailand", ["Asia/Bangkok"]],
  ["VN", "Vietnam", ["Asia/Ho_Chi_Minh"]],
  ["PH", "Philippines", ["Asia/Manila"]],
  ["PK", "Pakistan", ["Asia/Karachi"]],
  ["BD", "Bangladesh", ["Asia/Dhaka"]],
  ["LK", "Sri Lanka", ["Asia/Colombo"]],
  ["NP", "Nepal", ["Asia/Kathmandu"]],
  ["AF", "Afghanistan", ["Asia/Kabul"]],
  ["IR", "Iran", ["Asia/Tehran"]],
  ["IQ", "Iraq", ["Asia/Baghdad"]],
  ["IL", "Israel", ["Asia/Jerusalem"]],
  ["SA", "Saudi Arabia", ["Asia/Riyadh"]],
  ["AE", "United Arab Emirates", ["Asia/Dubai"], ["UAE"]],
  ["QA", "Qatar", ["Asia/Qatar"]],
  ["KW", "Kuwait", ["Asia/Kuwait"]],
  ["JO", "Jordan", ["Asia/Amman"]],
  ["LB", "Lebanon", ["Asia/Beirut"]],
  ["TR", "Turkey", ["Europe/Istanbul"], ["Turkiye"]],
  ["UZ", "Uzbekistan", ["Asia/Tashkent"]],
  ["GB", "United Kingdom", ["Europe/London"], ["UK", "Britain", "Great Britain", "England", "Scotland", "Wales"]],
  ["IE", "Ireland", ["Europe/Dublin"]],
  ["PT", "Portugal", ["Europe/Lisbon"]],
  ["ES", "Spain", ["Europe/Madrid"]],
  ["FR", "France", ["Europe/Paris"]],
  ["DE", "Germany", ["Europe/Berlin"], ["Deutschland"]],
  ["NL", "Netherlands", ["Europe/Amsterdam"], ["Holland"]],
  ["BE", "Belgium", ["Europe/Brussels"]],
  ["LU", "Luxembourg", ["Europe/Luxembourg"]],
  ["CH", "Switzerland", ["Europe/Zurich"]],
  ["AT", "Austria", ["Europe/Vienna"]],
  ["IT", "Italy", ["Europe/Rome"]],
  ["MT", "Malta", ["Europe/Malta"]],
  ["GR", "Greece", ["Europe/Athens"]],
  ["DK", "Denmark", ["Europe/Copenhagen"]],
  ["NO", "Norway", ["Europe/Oslo"]],
  ["SE", "Sweden", ["Europe/Stockholm"]],
  ["FI", "Finland", ["Europe/Helsinki"]],
  ["IS", "Iceland", ["Atlantic/Reykjavik"]],
  ["PL", "Poland", ["Europe/Warsaw"]],
  ["CZ", "Czechia", ["Europe/Prague"], ["Czech Republic"]],
  ["SK", "Slovakia", ["Europe/Bratislava"]],
  ["HU", "Hungary", ["Europe/Budapest"]],
  ["RO", "Romania", ["Europe/Bucharest"]],
  ["BG", "Bulgaria", ["Europe/Sofia"]],
  ["RS", "Serbia", ["Europe/Belgrade"]],
  ["HR", "Croatia", ["Europe/Zagreb"]],
  ["SI", "Slovenia", ["Europe/Ljubljana"]],
  ["UA", "Ukraine", ["Europe/Kyiv"]],
  ["BY", "Belarus", ["Europe/Minsk"]],
  ["LT", "Lithuania", ["Europe/Vilnius"]],
  ["LV", "Latvia", ["Europe/Riga"]],
  ["EE", "Estonia", ["Europe/Tallinn"]],
  ["EG", "Egypt", ["Africa/Cairo"]],
  ["MA", "Morocco", ["Africa/Casablanca"]],
  ["DZ", "Algeria", ["Africa/Algiers"]],
  ["TN", "Tunisia", ["Africa/Tunis"]],
  ["NG", "Nigeria", ["Africa/Lagos"]],
  ["GH", "Ghana", ["Africa/Accra"]],
  ["KE", "Kenya", ["Africa/Nairobi"]],
  ["ET", "Ethiopia", ["Africa/Addis_Ababa"]],
  ["TZ", "Tanzania", ["Africa/Dar_es_Salaam"]],
  ["UG", "Uganda", ["Africa/Kampala"]],
  ["ZA", "South Africa", ["Africa/Johannesburg"]],
  ["ZW", "Zimbabwe", ["Africa/Harare"]],
  ["AR", "Argentina", ["America/Argentina/Buenos_Aires"]],
  ["CL", "Chile", ["America/Santiago"]],
  ["CO", "Colombia", ["America/Bogota"]],
  ["PE", "Peru", ["America/Lima"]],
  ["VE", "Venezuela", ["America/Caracas"]],
  ["EC", "Ecuador", ["America/Guayaquil"]],
  ["UY", "Uruguay", ["America/Montevideo"]],
  ["BO", "Bolivia", ["America/La_Paz"]],
  ["PY", "Paraguay", ["America/Asuncion"]],
  ["CR", "Costa Rica", ["America/Costa_Rica"]],
  ["PA", "Panama", ["America/Panama"]],
  ["GT", "Guatemala", ["America/Guatemala"]],
  ["DO", "Dominican Republic", ["America/Santo_Domingo"]],
  ["JM", "Jamaica", ["America/Jamaica"]],
  ["PR", "Puerto Rico", ["America/Puerto_Rico"]],
  ["CU", "Cuba", ["America/Havana"]],
  ["NZ", "New Zealand", ["Pacific/Auckland"]],
];

// Common cities that are not IANA names. IANA names are matched separately.
const CITY_ALIASES: Record<string, string> = {
  bangalore: "Asia/Kolkata", bengaluru: "Asia/Kolkata", mumbai: "Asia/Kolkata", delhi: "Asia/Kolkata",
  "new delhi": "Asia/Kolkata", hyderabad: "Asia/Kolkata", chennai: "Asia/Kolkata", pune: "Asia/Kolkata",
  beijing: "Asia/Shanghai", shanghai: "Asia/Shanghai", shenzhen: "Asia/Shanghai",
  "san francisco": PT, seattle: PT, portland: PT, "san diego": PT, "las vegas": PT, sf: PT, nyc: ET,
  boston: ET, atlanta: ET, miami: ET, philadelphia: ET, washington: ET, dallas: CT, houston: CT, austin: CT,
  "san antonio": CT, minneapolis: CT, nashville: CT, denver: MT, "salt lake city": MT, phoenix: "America/Phoenix",
  vancouver: PT, montreal: "America/Toronto", ottawa: "America/Toronto", calgary: MT,
  london: "Europe/London", dublin: "Europe/Dublin", kyiv: "Europe/Kyiv", kiev: "Europe/Kyiv",
  "tel aviv": "Asia/Jerusalem", dubai: "Asia/Dubai", "abu dhabi": "Asia/Dubai", riyadh: "Asia/Riyadh",
  singapore: "Asia/Singapore", tokyo: "Asia/Tokyo", osaka: "Asia/Tokyo", seoul: "Asia/Seoul",
  "hong kong": "Asia/Hong_Kong", sydney: "Australia/Sydney", melbourne: "Australia/Sydney",
  brisbane: "Australia/Brisbane", perth: "Australia/Perth", auckland: "Pacific/Auckland",
  "sao paulo": "America/Sao_Paulo", "rio de janeiro": "America/Sao_Paulo", "mexico city": "America/Mexico_City",
  "buenos aires": "America/Argentina/Buenos_Aires", cairo: "Africa/Cairo", lagos: "Africa/Lagos",
  nairobi: "Africa/Nairobi", johannesburg: "Africa/Johannesburg", "cape town": "Africa/Johannesburg",
  hanoi: "Asia/Ho_Chi_Minh", "ho chi minh": "Asia/Ho_Chi_Minh", saigon: "Asia/Ho_Chi_Minh",
  kathmandu: "Asia/Kathmandu", colombo: "Asia/Colombo", karachi: "Asia/Karachi", lahore: "Asia/Karachi",
  dhaka: "Asia/Dhaka", jakarta: "Asia/Jakarta", manila: "Asia/Manila", bangkok: "Asia/Bangkok",
};

// ── Intl helpers ───────────────────────────────────────────────────────────────────────────────
export function isValidZone(zone: string): boolean {
  if (!zone) return false;
  try { new Intl.DateTimeFormat("en-US", { timeZone: zone }); return true; } catch { return false; }
}

/** Minutes east of UTC for `zone` at the instant `ms`. */
export function offsetMinutesAt(zone: string, ms: number): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: zone, hourCycle: "h23", year: "numeric", month: "numeric", day: "numeric",
    hour: "numeric", minute: "numeric", second: "numeric",
  }).formatToParts(new Date(ms));
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0);
  const asUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour") % 24, get("minute"), get("second"));
  return Math.round((asUtc - Math.floor(ms / 1000) * 1000) / 60000);
}

export function formatOffset(minutes: number): string {
  if (minutes === 0) return "UTC";
  const sign = minutes < 0 ? "-" : "+";
  const abs = Math.abs(minutes);
  const h = Math.floor(abs / 60), m = abs % 60;
  return `UTC${sign}${h}${m ? `:${String(m).padStart(2, "0")}` : ""}`;
}

/** "CST", "CET", "IST"... falling back to "UTC+5:45" when no locale has a real abbreviation. */
export function zoneAbbreviation(zone: string, ms: number): string {
  for (const locale of ["en-US", "en-GB", "en-AU", "en-IN"]) {
    try {
      const name = new Intl.DateTimeFormat(locale, { timeZone: zone, timeZoneName: "short" })
        .formatToParts(new Date(ms)).find((p) => p.type === "timeZoneName")?.value;
      if (name && (!/^GMT[+-]/.test(name) && !/^UTC[+-]/.test(name))) return name;
    } catch { /* try next */ }
  }
  return formatOffset(offsetMinutesAt(zone, ms));
}

export interface ZoneDescription {
  zone: string;
  abbr: string;
  offsetMinutes: number;
  offset: string;
  /** Local clock time, e.g. "2:14 PM". */
  time: string;
  /** "America/Chicago · CST (UTC-6) · 2:14 PM" */
  text: string;
}

export function describeZone(zone: string, at: Date = new Date()): ZoneDescription {
  const ms = at.getTime();
  const offsetMinutes = offsetMinutesAt(zone, ms);
  const abbr = zoneAbbreviation(zone, ms);
  const offset = formatOffset(offsetMinutes);
  const time = new Intl.DateTimeFormat("en-US", { timeZone: zone, hour: "numeric", minute: "2-digit" }).format(at);
  return { zone, abbr, offsetMinutes, offset, time, text: `${zone} · ${abbr} (${offset}) · ${time}` };
}

/** Short "2:14 PM CST" for chips and panel headers. */
export function localTimeLabel(zone: string, at: Date = new Date()): string {
  if (!isValidZone(zone)) return "";
  const d = describeZone(zone, at);
  return `${d.time} ${d.abbr}`;
}

export function browserZone(): string {
  try { return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC"; } catch { return "UTC"; }
}

// ── Search ─────────────────────────────────────────────────────────────────────────────────────
let ianaCache: string[] | null = null;
function ianaZones(): string[] {
  if (ianaCache) return ianaCache;
  let list: string[] = [];
  try {
    const sv = (Intl as unknown as { supportedValuesOf?: (k: string) => string[] }).supportedValuesOf;
    if (sv) list = sv("timeZone");
  } catch { /* older engines */ }
  const extra = new Set<string>([...Object.values(ABBREVIATIONS), ...Object.values(CITY_ALIASES)]);
  for (const c of COUNTRIES) c[2].forEach((z) => extra.add(z));
  for (const r of [...ROWS_US, ...ROWS_CA]) { extra.add(r[2]); if (r[3]) extra.add(r[3]); }
  // Engines list Asia/Calcutta; people type Kolkata.
  list = list.filter((z) => z !== "Asia/Calcutta" && z !== "Asia/Katmandu" && z !== "Asia/Saigon");
  ianaCache = Array.from(new Set([...list, ...extra])).filter(isValidZone).sort();
  return ianaCache;
}

const norm = (s: string) => s.trim().toLowerCase().replace(/[._]/g, " ").replace(/\s+/g, " ");
const cityOf = (zone: string) => norm(zone.split("/").pop() ?? zone);
const prettyCity = (zone: string) => (zone.split("/").pop() ?? zone).replace(/_/g, " ");

function zoneSuggestion(zone: string, label: string, kind: string, hint?: string): ZoneSuggestion {
  return { zone, label, kind, ...(hint ? { hint } : {}) };
}

function dedupe(list: ZoneSuggestion[], limit: number): ZoneSuggestion[] {
  const seen = new Set<string>();
  const out: ZoneSuggestion[] = [];
  for (const s of list) {
    const key = `${s.zone}|${s.label}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(s);
    if (out.length >= limit) break;
  }
  return out;
}

function regionRows(rows: [string, string, string, string?][], q: string, mode: "exact" | "prefix") {
  const out: { row: [string, string, string, string?]; exact: boolean }[] = [];
  for (const row of rows) {
    const code = row[0].toLowerCase(), name = row[1].toLowerCase();
    const exact = q === code || q === name;
    if (exact) out.push({ row, exact: true });
    else if (mode === "prefix" && q.length >= 2 && name.startsWith(q)) out.push({ row, exact: false });
  }
  return out;
}

function regionSuggestions(row: [string, string, string, string?], kind: "state" | "province"): { main: ZoneSuggestion; others: ZoneSuggestion[] } {
  const [code, name, main, other] = row;
  const m = zoneSuggestion(main, `${name} (${code}) · ${prettyCity(main)}`, kind);
  const others = other
    ? [zoneSuggestion(other, `${name}${OTHER_ZONE_NOTE[code] ? `, ${OTHER_ZONE_NOTE[code]}` : ""} · ${prettyCity(other)}`, kind, "Other zone in this state")]
    : [];
  return { main: m, others };
}

function countrySuggestions(c: CountryRow): ZoneSuggestion[] {
  const [code, name, zones] = c;
  return zones.map((z) => zoneSuggestion(z, `${name} (${code})${zones.length > 1 ? ` · ${prettyCity(z)}` : ""}`, "country"));
}

/**
 * Resolve free text to IANA zone(s). `zone` is set only when the input is unambiguous
 * (an exact IANA name, abbreviation, city, state, province or single-zone country).
 */
export function resolveInput(input: string, limit = 8): ResolveResult {
  const raw = input.trim();
  const q = norm(raw);
  if (!q) return { zone: null, suggestions: [], alternatives: [] };

  // 1. Exact IANA name typed with its slash.
  if (raw.includes("/")) {
    const hit = ianaZones().find((z) => z.toLowerCase() === raw.toLowerCase());
    if (hit) return { zone: hit, suggestions: [zoneSuggestion(hit, hit, "zone")], alternatives: [] };
  }

  const exactSets: ZoneSuggestion[][] = [];
  let alternatives: ZoneSuggestion[] = [];
  const upper = raw.toUpperCase();

  // 2. Abbreviation (PST, CET...)
  const abbr = ABBREVIATIONS[upper];
  if (abbr) {
    exactSets.push([zoneSuggestion(abbr, `${upper} · ${prettyCity(abbr)}`, "abbr")]);
  }

  // 3. City alias or IANA city (exact)
  if (CITY_ALIASES[q]) exactSets.push([zoneSuggestion(CITY_ALIASES[q], `${raw} · ${CITY_ALIASES[q]}`, "city")]);
  const ianaExact = ianaZones().filter((z) => cityOf(z) === q);
  if (ianaExact.length) exactSets.push(ianaExact.slice(0, 1).map((z) => zoneSuggestion(z, z, "zone")));

  // 4. State / province (exact)
  const stateHits = regionRows(ROWS_US, q, "exact");
  const provHits = regionRows(ROWS_CA, q, "exact");
  const stateSug: ZoneSuggestion[][] = [];
  for (const h of stateHits) { const s = regionSuggestions(h.row, "state"); stateSug.push([s.main, ...s.others]); }
  for (const h of provHits) { const s = regionSuggestions(h.row, "province"); stateSug.push([s.main, ...s.others]); }
  // A 2-letter code that is both a state and a country (IN, DE, CA...) stays a choice, not an answer.
  exactSets.push(...stateSug);

  // 5. Country (exact name, ISO code or alias)
  const countryHits = COUNTRIES.filter((c) => c[0].toLowerCase() === q || c[1].toLowerCase() === q || (c[3] ?? []).some((a) => a.toLowerCase() === q));
  for (const c of countryHits) exactSets.push(countrySuggestions(c));

  if (exactSets.length) {
    const flat = dedupe(exactSets.flat(), limit + 6);
    const single = exactSets.length === 1 ? exactSets[0] : null;
    if (single) {
      const main = single[0];
      const isMultiZoneCountry = main.kind === "country" && single.length > 1;
      if (!isMultiZoneCountry) {
        alternatives = single.filter((s) => s.hint);
        return { zone: main.zone, suggestions: flat.slice(0, limit), alternatives };
      }
    }
    // Several distinct exact meanings, or a multi-zone country: user chooses.
    const zones = new Set(exactSets.map((s) => s[0].zone));
    if (zones.size === 1 && exactSets.every((s) => s.length === 1)) {
      return { zone: exactSets[0][0].zone, suggestions: flat.slice(0, limit), alternatives: [] };
    }
    return { zone: null, suggestions: flat.slice(0, limit), alternatives: [] };
  }

  // 6. Partial matches, best first.
  const partial: ZoneSuggestion[] = [];
  for (const [a, z] of Object.entries(ABBREVIATIONS)) if (q.length >= 2 && a.toLowerCase().startsWith(q)) partial.push(zoneSuggestion(z, `${a} · ${prettyCity(z)}`, "abbr"));
  for (const [city, z] of Object.entries(CITY_ALIASES)) if (city.startsWith(q)) partial.push(zoneSuggestion(z, `${city.replace(/\b\w/g, (c) => c.toUpperCase())} · ${z}`, "city"));
  for (const h of regionRows(ROWS_US, q, "prefix")) { const s = regionSuggestions(h.row, "state"); partial.push(s.main, ...s.others); }
  for (const h of regionRows(ROWS_CA, q, "prefix")) { const s = regionSuggestions(h.row, "province"); partial.push(s.main, ...s.others); }
  for (const c of COUNTRIES) if (c[1].toLowerCase().startsWith(q) || (c[3] ?? []).some((a) => a.toLowerCase().startsWith(q))) partial.push(...countrySuggestions(c).slice(0, c[2].length > 1 ? 6 : 1));
  const zs = ianaZones();
  for (const z of zs) if (cityOf(z).startsWith(q)) partial.push(zoneSuggestion(z, z, "zone"));
  for (const z of zs) if (q.length >= 3 && !cityOf(z).startsWith(q) && norm(z).includes(q)) partial.push(zoneSuggestion(z, z, "zone"));
  return { zone: null, suggestions: dedupe(partial, limit), alternatives: [] };
}

export function suggestZones(input: string, limit = 8): ZoneSuggestion[] {
  return resolveInput(input, limit).suggestions;
}

/** Exposed for tests. */
export const _tables = { ROWS_US, ROWS_CA, COUNTRIES, CITY_ALIASES };
