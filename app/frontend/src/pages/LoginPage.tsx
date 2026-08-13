import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { login } from "../lib/auth";

export default function LoginPage() {
  const navigate = useNavigate();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [oktaEnabled, setOktaEnabled] = useState(false);

  useEffect(() => {
    fetch("/api/v1/auth/oidc-status/")
      .then((r) => r.json())
      .then((d: { okta_enabled?: boolean }) => { if (d.okta_enabled) setOktaEnabled(true); })
      .catch(() => {});
  }, []);

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
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="w-full max-w-sm bg-white rounded-lg border border-gray-200 shadow-sm p-8">
        <h1 className="text-3xl font-semibold text-[var(--twilio-navy)] mb-6">Sign in to Agent PM</h1>
        <form onSubmit={(e) => void handleSubmit(e)} className="space-y-4">
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
        {oktaEnabled && (
          <div className="mt-4 text-center">
            <a
              href="/oidc/authenticate/"
              className="text-sm text-indigo-600 hover:text-indigo-800 font-medium"
            >
              Sign in with Okta SSO
            </a>
          </div>
        )}
      </div>
    </div>
  );
}
