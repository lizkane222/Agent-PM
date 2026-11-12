import { useEffect } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { storeTokens } from "../lib/auth";
import { track } from "../lib/analytics";

/**
 * Landing page for "Sign in with Google". The backend redirects here with the token pair in the
 * URL fragment (never the query string, so it is not sent to a server or logged). Read it, store
 * it, scrub the fragment from the address bar and history, and go home.
 */
export function readTokensFromHash(hash: string): { access: string; refresh: string } | null {
  const params = new URLSearchParams(hash.replace(/^#/, ""));
  const access = params.get("access");
  const refresh = params.get("refresh");
  return access && refresh ? { access, refresh } : null;
}

export default function AuthCallbackPage() {
  const navigate = useNavigate();
  const tokens = readTokensFromHash(window.location.hash);

  useEffect(() => {
    if (!tokens) return;
    storeTokens(tokens);
    track("Signed In", { method: "google" });
    window.history.replaceState(null, "", window.location.pathname);
    navigate("/", { replace: true });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  if (!tokens) return <Navigate to="/login?error=verification_failed" replace />;
  return null;
}
