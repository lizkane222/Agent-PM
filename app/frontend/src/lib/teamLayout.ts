export type TeamLayout = "stacked" | "row";

/**
 * Multiple customer teams: lay them out side by side ("row") unless every contact of every team
 * fits on one line, in which case the teams are stacked one per row ("stacked").
 * Unknown / zero measurements default to "stacked" (what jsdom and the first paint get).
 */
export function decideTeamLayout({
  containerWidth,
  teamWidths,
  gap,
}: {
  containerWidth: number;
  /** Natural single-line width of each team's chips (without wrapping). */
  teamWidths: number[];
  gap: number;
}): TeamLayout {
  if (teamWidths.length < 2) return "stacked";
  if (!(containerWidth > 0) || teamWidths.some((w) => !(w > 0))) return "stacked";
  const total = teamWidths.reduce((a, b) => a + b, 0) + gap * (teamWidths.length - 1);
  return total <= containerWidth ? "stacked" : "row";
}
