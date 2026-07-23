import { useEffect } from "react";
import { useLocation, useNavigate } from "react-router-dom";

// Call this at the top of a page. Pass a ref to the element that should glow.
// When the URL contains ?glow=1, the class "log-glow" is added for 5s then removed,
// and the query param is stripped from the URL.
export function useLogGlow(ref: React.RefObject<HTMLElement | null>) {
  const location = useLocation();
  const navigate = useNavigate();

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    if (params.get("glow") !== "1") return;
    const el = ref.current;
    if (!el) return;

    el.classList.add("log-glow");
    el.scrollIntoView({ behavior: "smooth", block: "nearest" });

    const timer = setTimeout(() => el.classList.remove("log-glow"), 5000);

    // Strip the ?glow param without adding a history entry
    params.delete("glow");
    const newSearch = params.toString();
    navigate({ search: newSearch ? `?${newSearch}` : "" }, { replace: true });

    return () => clearTimeout(timer);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.search]);
}
