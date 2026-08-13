
export const STATUS_COLORS: Record<string, { bg: string; text: string }> = {
  red:   { bg: "rgba(239,68,68,0.12)",   text: "#dc2626" },
  amber: { bg: "rgba(245,158,11,0.12)",  text: "#d97706" },
  green: { bg: "rgba(34,197,94,0.12)",   text: "#16a34a" },
  blue:  { bg: "rgba(37,99,235,0.12)",   text: "#2563eb" },
  gray:  { bg: "rgba(107,114,128,0.12)", text: "#6b7280" },
};

export function EmailStatusBadge({ status, color }: { status: string; color: string }) {
  const c = STATUS_COLORS[color] ?? STATUS_COLORS.gray;
  return (
    <span style={{
      padding: "2px 8px", borderRadius: 4, fontSize: "0.6875rem", fontWeight: 700,
      background: c.bg, color: c.text, whiteSpace: "nowrap", letterSpacing: "0.02em",
    }}>{status}</span>
  );
}
