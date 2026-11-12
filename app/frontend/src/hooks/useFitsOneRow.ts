import { useCallback, useLayoutEffect, useRef, useState } from "react";
import { decideTeamLayout, type TeamLayout } from "../lib/teamLayout";

/**
 * Measures a container and the natural one-line width of each team's chips
 * (sum of the children of every [data-team-chips] element) and returns the layout to use. Zero widths -> "stacked".
 */
export function useTeamLayout(teamCount: number, gap = 8, deps: unknown[] = []) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [layout, setLayout] = useState<TeamLayout>("stacked");

  const measure = useCallback(() => {
    const el = ref.current;
    if (!el || teamCount < 2) { setLayout("stacked"); return; }
    const widths = Array.from(el.querySelectorAll<HTMLElement>("[data-team-chips]")).map((row) => {
      const kids = Array.from(row.children) as HTMLElement[];
      return kids.reduce((sum, k) => sum + k.offsetWidth, 0) + gap * Math.max(0, kids.length - 1);
    });
    setLayout(decideTeamLayout({ containerWidth: el.clientWidth, teamWidths: widths, gap }));
  }, [teamCount, gap]);

  useLayoutEffect(() => {
    measure();
    const el = ref.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => measure());
    ro.observe(el);
    return () => ro.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [measure, ...deps]);

  return { ref, layout };
}
