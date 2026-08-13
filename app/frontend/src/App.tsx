import { useEffect, useState } from "react";
import { BrowserRouter, Navigate, Route, Routes, useLocation } from "react-router-dom";
import axios from "axios";
import Layout from "./components/Layout";
import AccountsPage from "./pages/AccountsPage";
import AccountDetailPage from "./pages/AccountDetailPage";
import ActionItemsPage from "./pages/ActionItemsPage";
import CalendarPage from "./pages/CalendarPage";
import ChatPage from "./pages/ChatPage";
import DashboardPage from "./pages/DashboardPage";
import PageBuilder from "./components/pagebuilder/PageBuilder";
import LogsPage from "./pages/LogsPage";
import LoginPage from "./pages/LoginPage";
import RemindersPage from "./pages/RemindersPage";
import SettingsPage from "./pages/SettingsPage";
import TeamPage from "./pages/TeamPage";
import RolePage from "./pages/RolePage";
import ClaudeSkillsPage from "./pages/ClaudeSkillsPage";
import DiscoverPage from "./pages/DiscoverPage";
import ProfilePage from "./pages/ProfilePage";
import AdminDataPage from "./pages/AdminDataPage";
import { clearTokens, getAccessToken, getRefreshToken, isTokenExpired, storeTokens } from "./lib/auth";
import { page, reset } from "./lib/analytics";
import type { TokenPair } from "./types";
import { NotificationDefaultsProvider } from "./context/NotificationDefaultsContext";
import { ExportProvider } from "./context/ExportContext";
import { FeedbackProvider } from "./context/FeedbackContext";
import { CurrentUserProvider } from "./context/CurrentUserContext";
import { CommentProvider } from "./components/comments/CommentContext";

const BASE_URL = import.meta.env["VITE_API_BASE_URL"] ?? "/api/v1";

const PAGE_NAMES: Record<string, string> = {
  "/": "Dashboard",
  "/calendar": "Calendar",
  "/action-items": "Action Items",
  "/agent": "Agent Chat",
  "/accounts": "Accounts",
  "/team": "Team",
  "/reminders": "Reminders",
  "/skills": "Claude Skills",
  "/discover": "Discover",
  "/settings": "Settings",
  "/logs": "Logs",
  "/edit-preview": "Edit Preview",
};

function PageTracker() {
  const location = useLocation();
  useEffect(() => {
    const name = PAGE_NAMES[location.pathname] ?? location.pathname;
    page(name, { path: location.pathname, search: location.search });
  }, [location.pathname, location.search]);
  return null;
}

function AuthedApp({ children }: { children: React.ReactNode }) {
  return (
    <CurrentUserProvider>
      <NotificationDefaultsProvider>
        <ExportProvider>
          <FeedbackProvider>
            <CommentProvider>{children}</CommentProvider>
          </FeedbackProvider>
        </ExportProvider>
      </NotificationDefaultsProvider>
    </CurrentUserProvider>
  );
}

function RequireAuth({ children }: { children: React.ReactNode }) {
  const token = getAccessToken();

  // No token → go to login immediately.
  const needsRefresh = !!token && isTokenExpired(token);
  const [ready, setReady] = useState(!needsRefresh && !!token);
  const [redirectToLogin, setRedirectToLogin] = useState(!token);

  useEffect(() => {
    if (ready || redirectToLogin) return;
    const refresh = getRefreshToken();
    if (!refresh) {
      clearTokens();
      reset();
      setRedirectToLogin(true);
      return;
    }
    axios
      .post<TokenPair>(`${BASE_URL}/auth/token/refresh/`, { refresh })
      .then(({ data }) => {
        storeTokens(data);
        setReady(true);
      })
      .catch(() => {
        clearTokens();
      reset();
        setRedirectToLogin(true);
      });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  if (redirectToLogin) return <Navigate to="/login" replace />;
  if (!ready) return null;

  return <AuthedApp>{children}</AuthedApp>;
}

export default function App() {
  return (
    <BrowserRouter>
      <PageTracker />
      <Routes>
        <Route path="login" element={<LoginPage />} />
        <Route element={<RequireAuth><Layout /></RequireAuth>}>
          <Route index element={<DashboardPage />} />
          <Route path="calendar" element={<CalendarPage />} />
          <Route path="action-items" element={<ActionItemsPage />} />
          <Route path="agent" element={<ChatPage />} />
          <Route path="chat" element={<Navigate to="/agent" replace />} />
          <Route path="accounts" element={<AccountsPage />} />
          <Route path="accounts/:id" element={<AccountDetailPage />} />
          <Route path="team" element={<TeamPage />} />
          <Route path="role/:roleSlug" element={<RolePage />} />
          <Route path="reminders" element={<RemindersPage />} />
          <Route path="skills" element={<ClaudeSkillsPage />} />
          <Route path="discover" element={<DiscoverPage />} />
          <Route path="settings" element={<SettingsPage />} />
          <Route path="admin-data" element={<AdminDataPage />} />
          <Route path="logs" element={<LogsPage />} />
          <Route path="edit-preview" element={<PageBuilder />} />
          <Route path="profile" element={<ProfilePage />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
