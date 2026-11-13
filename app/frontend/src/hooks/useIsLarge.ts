import { useEffect, useState } from "react";

const QUERY = "(min-width: 1024px)"; // Tailwind `lg`

const read = (): boolean => (typeof window !== "undefined" && typeof window.matchMedia === "function" ? window.matchMedia(QUERY).matches : false);

/** True at Tailwind's `lg` breakpoint and above. False where matchMedia is unavailable (jsdom). */
export function useIsLarge(): boolean {
  const [large, setLarge] = useState(read);
  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return;
    const mq = window.matchMedia(QUERY);
    const on = () => setLarge(mq.matches);
    on();
    mq.addEventListener?.("change", on);
    return () => mq.removeEventListener?.("change", on);
  }, []);
  return large;
}
