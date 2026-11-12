import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { login } from "../lib/auth";
import heroImage from "../assets/imgs/pixeliota-4q9bqweELy4-unsplash.jpg";

// Fixed codes from the backend's /auth/google/callback/. The server never sends detail text.
const SSO_ERRORS: Record<string, string> = {
  wrong_domain: "Sign in with your company Google account.",
  no_account: "Your Google account has no Agent PM user yet. Ask an admin to add you.",
  cancelled: "Google sign-in was cancelled.",
  session_expired: "That sign-in took too long. Please try again.",
  verification_failed: "Google sign-in could not be verified. Please try again.",
  not_configured: "Google sign-in is not set up.",
};

export default function LoginPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [oktaEnabled, setOktaEnabled] = useState(false);
  const [googleEnabled, setGoogleEnabled] = useState(false);

  useEffect(() => {
    fetch("/api/v1/auth/oidc-status/")
      .then((r) => r.json())
      .then((d: { okta_enabled?: boolean; google_enabled?: boolean }) => {
        if (d.okta_enabled) setOktaEnabled(true);
        if (d.google_enabled) setGoogleEnabled(true);
      })
      .catch(() => {});
  }, []);

  // With SSO configured, the company sign-in is the only door. `?local=1` is the break-glass
  // path for an SSO outage, so a provider problem cannot lock everyone out of the app.
  const ssoOnly = (oktaEnabled || googleEnabled) && searchParams.get("local") !== "1";
  // Google wins when both are configured: that is the company sign-in this app standardised on.
  const ssoHref = googleEnabled ? "/api/v1/auth/google/start/" : "/oidc/authenticate/";
  const ssoLabel = googleEnabled ? "Sign in with Google" : "Sign in with Okta SSO";
  const ssoError = SSO_ERRORS[searchParams.get("error") ?? ""] ?? "";

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      await login(username, password);
      navigate("/");
    } catch {
      setError("Invalid credentials.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex bg-gray-50">
      {/* Hero: the same on sign-in and after sign-out, since sign-out lands on this page. */}
      <div
        data-testid="login-hero"
        className="hidden md:flex md:w-1/2 lg:w-3/5 items-center justify-center bg-cover bg-center"
        style={{ backgroundImage: `url(${heroImage})` }}
      >
        <div className="flex items-center gap-4 rounded-2xl bg-white/95 px-8 py-6 shadow-lg">
          <img src="/logo.svg" alt="Agent PM" className="h-16 w-16 shrink-0" />
          <span className="text-3xl font-bold tracking-tight text-[var(--twilio-navy)]">Agent PM</span>
        </div>
      </div>
      <div className="flex flex-1 items-center justify-center p-6">
      <div className="w-full max-w-sm bg-white rounded-lg border border-gray-200 shadow-sm p-8">
        <img src="/logo.svg" alt="Agent PM" className="mb-4 h-12 w-12 md:hidden" />
        <h1 className="text-3xl font-semibold text-[var(--twilio-navy)] mb-6">Sign in to Agent PM</h1>
        {ssoOnly ? (
          <div className="space-y-4">
            {ssoError && <p role="alert" className="text-sm text-red-600">{ssoError}</p>}
            <a
              href={ssoHref}
              className="block w-full rounded-md bg-indigo-600 px-4 py-2 text-center text-sm font-medium text-white hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-indigo-500"
            >
              {ssoLabel}
            </a>
            <p className="text-center text-xs text-gray-500">
              Use your company account. <a href="?local=1" className="underline">Having trouble?</a>
            </p>
          </div>
        ) : (
        <form data-allow-autofill onSubmit={(e) => void handleSubmit(e)} className="space-y-4">
          <div>
            <label htmlFor="login-username" className="block text-sm font-medium text-[var(--twilio-navy)] mb-1">Username or Email</label>
            <input
              id="login-username"
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              required
              autoFocus
              placeholder="username or email@example.com"
              className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
            />
          </div>
          <div>
            <label htmlFor="login-password" className="block text-sm font-medium text-[var(--twilio-navy)] mb-1">Password</label>
            <input
              id="login-password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
            />
          </div>
          {error && <p className="text-sm text-red-600">{error}</p>}
          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:bg-indigo-300 focus:outline-none focus:ring-2 focus:ring-indigo-500"
          >
            {loading ? "Signing in…" : "Sign in"}
          </button>
        </form>
        )}
        {(oktaEnabled || googleEnabled) && !ssoOnly && (
          <div className="mt-4 text-center">
            <a
              href={ssoHref}
              className="text-sm text-indigo-600 hover:text-indigo-800 font-medium"
            >
              {ssoLabel}
            </a>
          </div>
        )}
      </div>
      </div>
    </div>
  );
}
