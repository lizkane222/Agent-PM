/**
 * Calendar event colors — palettes, defaults, and contrast helpers.
 *
 * Single source of truth for every surface that paints an event type: the calendar
 * grid, the Colors popover, the create/edit category pills, and the Log Time dots.
 * User choices live on `UserProfile.calendar_colors` (see hooks/useCalendarColors).
 */

import type { EventCategory } from "../types/calendar";

/**
 * Action items and reminders are not `event_category` values — action items are
 * identified by `calendar_id === "work_tracking"` and reminders by a
 * `scheduled-reminder-*` uid — but both are still colorable types, painted on the
 * grid and in the calendar's right-hand sidebars.
 */
export type ColorableEventType = EventCategory | "action_item" | "reminder";

export interface PaletteGroup {
  name: string;
  colors: string[];
}

/** The four selectable palettes, in display order. */
export const PALETTES: PaletteGroup[] = [
  { name: "Bubblegum",     colors: ["#F2A2BD", "#FED3DD", "#F0F9F8", "#C6E6E3", "#82BFB7"] },
  { name: "Purple Pastel", colors: ["#CFC1D8", "#DED1DB", "#C3D3E0", "#F1EEFF", "#FFF6ED"] },
  { name: "Ocean",         colors: ["#18363E", "#5F97AA", "#2D5F6E", "#3E88A5", "#93C4D1"] },
  { name: "90s",           colors: ["#842D78", "#174DB1", "#297EA1", "#E5A836", "#B2336C"] },
];

/** "Mark as important!" picks from the 90s palette only. */
export const IMPORTANT_PALETTE: string[] =
  PALETTES.find((p) => p.name === "90s")!.colors;

/** Every swatch across all palettes — used to validate stored values. */
export const ALL_SWATCHES: string[] = PALETTES.flatMap((p) => p.colors);

/**
 * Out-of-the-box colors: Bubblegum, extended with Purple Pastel and one 90s swatch.
 *
 * Bubblegum has 5 colors for 8 types. Reusing swatches would make those types
 * indistinguishable, so the defaults borrow from the other palettes. The three
 * near-white swatches (#F0F9F8, #F1EEFF, #FFF6ED) are skipped here because they read
 * as blank against the white grid — they remain selectable, just not defaults.
 */
export const DEFAULT_CATEGORY_COLORS: Record<ColorableEventType, string> = {
  meeting:          "#C3D3E0", // Purple Pastel — light blue
  task:             "#F2A2BD", // Bubblegum — pink
  action_item:      "#CFC1D8", // Purple Pastel — light purple
  reminder:         "#E5A836", // 90s — amber; the pastels were spent, and amber is
                               // what reminders have always been painted.
  out_of_office:    "#FED3DD", // Bubblegum — light pink
  focus_time:       "#82BFB7", // Bubblegum — teal
  working_location: "#C6E6E3", // Bubblegum — light aqua
  appointment:      "#DED1DB", // Purple Pastel — mauve
};

/** Display order and labels for the 8 colorable types. */
export const EVENT_TYPE_META: { id: ColorableEventType; label: string }[] = [
  { id: "meeting",          label: "Meeting" },
  { id: "task",             label: "Task" },
  { id: "action_item",      label: "Action item" },
  { id: "reminder",         label: "Reminder" },
  { id: "out_of_office",    label: "Out of Office" },
  { id: "focus_time",       label: "Focus Time" },
  { id: "working_location", label: "Working Location" },
  { id: "appointment",      label: "Appointment" },
];

/**
 * The event types that can actually be written to `CalendarEvent.event_category`, with
 * the labels and icons every picker shows.
 *
 * Deliberately a **different** list from `EVENT_TYPE_META` above: that one has 8 entries
 * because `action_item` and `reminder` are colorable, but neither is in the model's
 * `EVENT_CATEGORY_CHOICES` — `PATCH /events/<pk>/details/` 400s on either. Anything that
 * offers the user a type to save must iterate this list, not that one.
 *
 * Converting an event to an action item is therefore not a category change at all; it
 * creates an AirtableActionItem and links it (see `convertEventToActionItemLinked`).
 */
export const EVENT_CATEGORY_META: { id: EventCategory; label: string; icon: string }[] = [
  { id: "meeting",          label: "Meeting",          icon: "🗓" },
  { id: "task",             label: "Task",             icon: "✓" },
  { id: "out_of_office",    label: "Out of Office",    icon: "🚫" },
  { id: "focus_time",       label: "Focus Time",       icon: "🎯" },
  { id: "working_location", label: "Working Location", icon: "📍" },
  { id: "appointment",      label: "Appointment",      icon: "📅" },
];

/** Dark text color for light fills — Twilio Navy. */
export const DARK_TEXT = "#121C2D";
export const LIGHT_TEXT = "#FFFFFF";

const HEX_RE = /^#[0-9A-Fa-f]{6}$/;

export function isHexColor(value: unknown): value is string {
  return typeof value === "string" && HEX_RE.test(value);
}

function channels(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff];
}

/** WCAG relative luminance, 0 (black) → 1 (white). */
export function relativeLuminance(hex: string): number {
  if (!isHexColor(hex)) return 1;
  const [r, g, b] = channels(hex).map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: number, b: number): number {
  const [hi, lo] = a > b ? [a, b] : [b, a];
  return (hi + 0.05) / (lo + 0.05);
}

/**
 * Dark or white text, whichever contrasts better against `hex`.
 *
 * Necessary because the default palette is pastel: the calendar used to hardcode
 * white text, which is unreadable on a #FED3DD event.
 */
export function readableTextColor(hex: string): string {
  const bg = relativeLuminance(hex);
  return contrast(bg, relativeLuminance(DARK_TEXT)) >= contrast(bg, relativeLuminance(LIGHT_TEXT))
    ? DARK_TEXT
    : LIGHT_TEXT;
}

/** Multiply each channel toward black. `amount` 0 → unchanged, 1 → black. */
export function darken(hex: string, amount: number): string {
  if (!isHexColor(hex)) return hex;
  const k = 1 - Math.min(Math.max(amount, 0), 1);
  const out = channels(hex)
    .map((c) => Math.round(c * k).toString(16).padStart(2, "0"))
    .join("");
  return `#${out}`;
}

/**
 * Mix each channel toward white. `amount` 0 → unchanged, 1 → white.
 *
 * The counterpart to `darken`, for surfaces that carry an accent color but must sit
 * behind body text — the calendar sidebar cards, whose fill is a wash of the type
 * color while the 3px left edge is the type color itself.
 */
export function tint(hex: string, amount: number): string {
  if (!isHexColor(hex)) return hex;
  const k = Math.min(Math.max(amount, 0), 1);
  const out = channels(hex)
    .map((c) => Math.round(c + (255 - c) * k).toString(16).padStart(2, "0"))
    .join("");
  return `#${out}`;
}

/**
 * Border color for an event fill. Very light fills get a darkened edge so the event
 * doesn't dissolve into the white grid; everything else borders in its own color.
 */
export function borderFor(hex: string): string {
  return relativeLuminance(hex) > 0.75 ? darken(hex, 0.18) : hex;
}

/** `hex` as an rgba() string at `alpha` opacity. Used to render a translucent fill
 *  that reads as faded rather than as a different flat color. */
export function withAlpha(hex: string, alpha: number): string {
  if (!isHexColor(hex)) return hex;
  const [r, g, b] = channels(hex);
  const a = Math.min(Math.max(alpha, 0), 1);
  return `rgba(${r}, ${g}, ${b}, ${a})`;
}
