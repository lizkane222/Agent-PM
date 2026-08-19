import { useEffect, useState } from "react";
import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import { DndContext } from "@dnd-kit/core";
import GlobalSearch from "./GlobalSearch";
import { accountsApi, teamApi, agentApi, skillsApi } from "../lib/api";
import SyncRunner from "./SyncRunner";
import type { Account, UserProfile } from "../types";
import TranscriptFooter from "./TranscriptFooter";
import ExportBar from "./ExportBar";
import { useFeedback } from "../context/FeedbackContext";
import FeedbackModal from "./feedback/FeedbackModal";
import { useExport } from "../context/ExportContext";
import HomeIcon from "../assets/icons/Home.svg?react";
import CalendarIcon from "../assets/icons/Calendar.svg?react";
import ConversationIcon from "../assets/icons/Conversation.svg?react";
import TeamIcon from "../assets/icons/Team.svg?react";
import CorporateIcon from "../assets/icons/Corporate.svg?react";
import ChecklistIcon from "../assets/icons/Checklist.svg?react";
import SettingsIcon from "../assets/icons/Settings.svg?react";
import NotificationIcon from "../assets/icons/Notification.svg?react";
import CodeIcon from "../assets/icons/Code.svg?react";
import ScheduleIcon from "../assets/icons/Schedule.svg?react";
import InnovationIcon from "../assets/icons/Innovation.svg?react";
import StructureIcon from "../assets/icons/Structure.svg?react";
import type { FC, SVGProps } from "react";
import { getTitleRole, ROLE_META, ROLED_PAGES } from "../lib/titleRoles";

type SvgIcon = FC<SVGProps<SVGSVGElement>>;

const BASE_NAV_ITEMS: { to: string; label: string; Icon: SvgIcon }[] = [
  { to: "/", label: "Dashboard", Icon: HomeIcon },
  { to: "/calendar", label: "Calendar", Icon: CalendarIcon },
  { to: "/action-items", label: "Action Items", Icon: ChecklistIcon },
  { to: "/reminders", label: "Reminders", Icon: ScheduleIcon },
  { to: "/agent", label: "Agent", Icon: ConversationIcon },
  { to: "/accounts", label: "Accounts", Icon: CorporateIcon },
  { to: "/team", label: "Team", Icon: TeamIcon },
];

function useUserProfile() {
  const [profile, setProfile] = useState<UserProfile | null>(null);
  // `fresh` bypasses the short GET cache (lib/requestCache.ts). The mount fetch is
  // cacheable on purpose — CurrentUserContext and NotificationDefaultsContext request
  // this same endpoint, and StrictMode doubles each of them. The event-driven refetch
  // below must see the toggled value, so it opts out.
  const doFetch = (fresh = false) =>
    teamApi.getMyProfile({ fresh }).then(({ data }) => setProfile(data)).catch(() => {});
  useEffect(() => { void doFetch(); }, []);
  // Re-fetch when staff_view_override is toggled.
  // StorageEvent fires only in other tabs; the window "accountsUpdated" event fires in the same tab.
  useEffect(() => {
    function onStorage(e: StorageEvent) {
      if (e.key === "accountsUpdated") void doFetch(true);
    }
    function onSameTab() { void doFetch(true); }
    window.addEventListener("storage", onStorage);
    window.addEventListener("accountsUpdated", onSameTab);
    return () => {
      window.removeEventListener("storage", onStorage);
      window.removeEventListener("accountsUpdated", onSameTab);
    };
  }, []);
  return profile;
}

function useNavAccounts() {
  const [accounts, setAccounts] = useState<Account[]>([]);

  const fetch = async (fresh = false) => {
    // Run independently so admin account always appears even if listAccounts fails (or vice versa)
    const [listResult, adminResult] = await Promise.allSettled([
      accountsApi.listAccounts(undefined, { fresh }),
      accountsApi.getAdminAccount({ fresh }),
    ]);

    const regular: Account[] = listResult.status === "fulfilled"
      ? listResult.value.data.results.filter((a) => !a.is_admin_account)
      : [];

    const adminAccount: Account | null = adminResult.status === "fulfilled"
      ? adminResult.value.data
      : null;

    // Admin always pinned first; if getAdminAccount failed, fall back to whatever listAccounts returned
    if (adminAccount) {
      setAccounts([adminAccount, ...regular]);
    } else {
      setAccounts(regular);
    }
  };

  useEffect(() => { void fetch(); }, []);
  useEffect(() => {
    function onStorage(e: StorageEvent) {
      if (e.key === "accountsUpdated") void fetch(true);
    }
    function onSameTab() { void fetch(true); }
    window.addEventListener("storage", onStorage);
    window.addEventListener("accountsUpdated", onSameTab);
    return () => {
      window.removeEventListener("storage", onStorage);
      window.removeEventListener("accountsUpdated", onSameTab);
    };
  }, []);
  return accounts;
}

/**
 * When staff_view_override is on (or user is not staff), show all role pages.
 * When a staff user disables staff view, only show the role page matching their title.
 */
function useRolePages(profile: UserProfile | null): Array<{ slug: string; label: string }> {
  if (!profile) return ROLED_PAGES.map(r => ({ slug: ROLE_META[r].slug, label: ROLE_META[r].label }));

  const staffViewActive = !profile.is_staff || profile.staff_view_override;
  if (staffViewActive) {
    return ROLED_PAGES.map(r => ({ slug: ROLE_META[r].slug, label: ROLE_META[r].label }));
  }

  // Staff with override disabled — only show the role page matching this user's title
  const myRole = getTitleRole(profile.title);
  if (ROLED_PAGES.includes(myRole)) {
    return [{ slug: ROLE_META[myRole].slug, label: ROLE_META[myRole].label }];
  }
  return [];
}

function useTheme() {
  const [dark, setDark] = useState<boolean>(() => {
    const stored = localStorage.getItem("agentpm-theme");
    if (stored) return stored === "dark";
    return window.matchMedia("(prefers-color-scheme: dark)").matches;
  });

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", dark ? "dark" : "light");
    localStorage.setItem("agentpm-theme", dark ? "dark" : "light");
  }, [dark]);

  return { dark, toggle: () => setDark((d) => !d) };
}

export default function Layout() {
  const { dark, toggle } = useTheme();
  const profile = useUserProfile();
  const navAccounts = useNavAccounts();
  const rolePages = useRolePages(profile);
  const location = useLocation();
  const navigate = useNavigate();
  const { pickMode } = useFeedback();
  const { exportMode, toggleMode, count: exportCount, items: exportItems, clearItems } = useExport();
  const [feedbackOpen, setFeedbackOpen] = useState(false);

  // Lifetime token usage — fetched once on mount, re-fetched when a new agent
  // response completes (indicated by a storage event set in ChatPage).
  const [lifetimeTokens, setLifetimeTokens] = useState<number>(0);
  useEffect(() => {
    const load = (fresh = false) => {
      Promise.all([
        agentApi.getTokenStats({ fresh }).catch(() => null),
        skillsApi.getTokenStats({ fresh }).catch(() => null),
      ]).then(([agent, skill]) => {
        const agentTotal = agent?.data?.all_time?.total_tokens ?? 0;
        const skillTotal = skill?.data?.all_time?.total_tokens ?? 0;
        setLifetimeTokens(agentTotal + skillTotal);
      });
    };
    load();
    const onStorage = (e: StorageEvent) => {
      if (e.key === "agentSessionUpdated" || e.key === "skillTokensUpdated") load(true);
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  function handleExportSend() {
    const text = [
      "I've selected the following content to export. Please ask me how I'd like to compile it:\n",
      ...exportItems.map((item) => `## ${item.label} (${item.type})\n${item.content}`),
    ].join("\n\n---\n\n");
    window.dispatchEvent(new CustomEvent("export-to-chat", { detail: { text } }));
    clearItems();
    toggleMode();
    navigate("/agent");
  }
  const buildPaths = ["/skills", "/edit-preview", "/discover"];
  const [buildOpen, setBuildOpen] = useState(() => buildPaths.some(p => location.pathname.startsWith(p)));
  const [accountsOpen, setAccountsOpen] = useState(true);

  // Sidebar expansion state for time allocation panel
  const [sidebarWide] = useState(false);

  const [windowWidth, setWindowWidth] = useState(() => window.innerWidth);
  useEffect(() => {
    const onResize = () => setWindowWidth(window.innerWidth);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);
  // 192px on laptop screens (≤1440px), 224px on larger desktop monitors
  const baseWidth = windowWidth <= 1440 ? 192 : 224;
  const sidebarWidth = sidebarWide ? 520 : baseWidth;

  return (
    <DndContext>
    <div className="flex h-screen overflow-hidden" style={{ background: "var(--twilio-gray-10)" }}>
      {/* Sidebar */}
      <aside
        className="shrink-0 flex flex-col"
        style={{
          width: sidebarWidth,
          minWidth: sidebarWidth,
          background: "var(--twilio-navy)",
          transition: "width 0.25s ease, min-width 0.25s ease",
          overflow: "hidden",
        }}
      >
        {/* Wordmark */}
        <div
          className="px-5 py-5 border-b"
          style={{ borderColor: "rgba(255,255,255,0.08)" }}
        >
          <div className="flex items-center gap-2">
            <img
              src="/logo.svg"
              alt="Agent PM"
              className="shrink-0"
              style={{ width: 28, height: 28 }}
            />
            <span
              className="text-sm font-bold tracking-tight"
              style={{ color: "var(--twilio-white)", fontFamily: "var(--font-base)" }}
            >
              Agent PM
            </span>
          </div>
        </div>

        {/* Search */}
        <div className="px-3 pt-3 pb-1">
          <GlobalSearch pageContext={
            location.pathname.startsWith("/action-items") ? "action_items"
            : location.pathname.startsWith("/calendar") ? "calendar"
            : location.pathname.startsWith("/accounts") ? "accounts"
            : location.pathname.startsWith("/reminders") ? "reminders"
            : location.pathname.startsWith("/skills") ? "skills"
            : ""
          } />
        </div>

        {/* Nav */}
        <nav className="flex-1 min-h-0 px-3 py-4 space-y-1.5 overflow-y-auto">
          {BASE_NAV_ITEMS.map(({ to, label, Icon }) => (
            <div key={to}>
              <NavLink
                to={to}
                end={to === "/"}
                className="nav-main-link"
                style={({ isActive }) => ({
                  display: "flex",
                  alignItems: "center",
                  gap: "10px",
                  padding: "7px 12px",
                  borderRadius: "4px",
                  fontSize: "0.9375rem",
                  fontWeight: isActive ? 600 : 400,
                  fontFamily: "var(--font-base)",
                  textDecoration: "none",
                  background: isActive ? "var(--twilio-red)" : "transparent",
                  color: isActive ? "#ffffff" : "var(--twilio-red)",
                })}
              >
                <Icon width={16} height={16} style={{ flexShrink: 0 }} />
                <span style={{ color: "#ffffff" }}>{label}</span>
              </NavLink>

              {/* Nested role pages under Team */}
              {to === "/team" && rolePages.length > 0 && (
                <div className="mt-0.5 space-y-0.5 pl-2">
                  {rolePages.map(({ slug, label }) => (
                    <NavLink
                      key={slug}
                      to={`/role/${slug}`}
                      style={({ isActive }) => ({
                        display: "flex",
                        alignItems: "center",
                        gap: "6px",
                        padding: "5px 10px",
                        borderRadius: "4px",
                        fontSize: "0.8125rem",
                        fontFamily: "var(--font-base)",
                        textDecoration: "none",
                        transition: "background 0.15s, color 0.15s",
                        background: isActive ? "rgba(255,255,255,0.12)" : "transparent",
                        color: isActive ? "rgba(255,255,255,0.95)" : "rgba(255,255,255,0.45)",
                        fontWeight: isActive ? 500 : 400,
                      })}
                      onMouseEnter={(e) => {
                        (e.currentTarget as HTMLAnchorElement).style.background = "var(--twilio-navy-light)";
                        (e.currentTarget as HTMLAnchorElement).style.color = "rgba(255,255,255,0.85)";
                      }}
                      onMouseLeave={(e) => {
                        const el = e.currentTarget as HTMLAnchorElement;
                        const isSelected = location.pathname === `/role/${slug}`;
                        el.style.background = isSelected ? "rgba(255,255,255,0.12)" : "transparent";
                        el.style.color = isSelected ? "rgba(255,255,255,0.95)" : "rgba(255,255,255,0.45)";
                      }}
                    >
                      <span style={{ color: "rgba(255,255,255,0.25)", fontFamily: "monospace" }}>↳</span>
                      <span className="truncate">{label}</span>
                    </NavLink>
                  ))}
                </div>
              )}

              {/* Nested account sub-items under Accounts */}
              {to === "/accounts" && navAccounts.length > 0 && (
                <div className="mt-0.5 pl-2">
                  {/* Collapsible header — only shown when there are many accounts (staff view) */}
                  {navAccounts.length > 5 && (
                    <button
                      onClick={() => setAccountsOpen(v => !v)}
                      style={{
                        display: "flex", alignItems: "center", gap: 4,
                        width: "100%", padding: "3px 10px", borderRadius: 4,
                        fontSize: "0.75rem", fontFamily: "var(--font-base)",
                        color: "rgba(255,255,255,0.35)", background: "transparent",
                        border: "none", cursor: "pointer", textAlign: "left",
                      }}
                    >
                      <span style={{ fontFamily: "monospace", fontSize: "0.7rem" }}>{accountsOpen ? "▾" : "▸"}</span>
                      <span>{accountsOpen ? "Hide accounts" : `${navAccounts.length} accounts`}</span>
                    </button>
                  )}
                  {(accountsOpen || navAccounts.length <= 5) && <div className="space-y-0.5">
                  {navAccounts.map((acct) => (
                    <NavLink
                      key={acct.id}
                      to={`/accounts/${acct.id}`}
                      style={({ isActive }) => ({
                        display: "flex",
                        alignItems: "center",
                        gap: "6px",
                        padding: "5px 10px",
                        borderRadius: "4px",
                        fontSize: "0.8125rem",
                        fontFamily: "var(--font-base)",
                        textDecoration: "none",
                        transition: "background 0.15s, color 0.15s",
                        background: isActive ? "rgba(255,255,255,0.12)" : "transparent",
                        color: isActive ? "rgba(255,255,255,0.95)" : acct.is_admin_account ? "rgba(255,255,255,0.65)" : "rgba(255,255,255,0.45)",
                        fontWeight: isActive ? 500 : acct.is_admin_account ? 500 : 400,
                      })}
                      onMouseEnter={(e) => {
                        (e.currentTarget as HTMLAnchorElement).style.background = "var(--twilio-navy-light)";
                        (e.currentTarget as HTMLAnchorElement).style.color = "rgba(255,255,255,0.85)";
                      }}
                      onMouseLeave={(e) => {
                        const el = e.currentTarget as HTMLAnchorElement;
                        const isSelected = location.pathname === `/accounts/${acct.id}`;
                        el.style.background = isSelected ? "rgba(255,255,255,0.12)" : "transparent";
                        el.style.color = isSelected ? "rgba(255,255,255,0.95)" : acct.is_admin_account ? "rgba(255,255,255,0.65)" : "rgba(255,255,255,0.45)";
                      }}
                    >
                      <span style={{ color: acct.is_admin_account ? "rgba(255,255,255,0.4)" : "rgba(255,255,255,0.25)", fontFamily: "monospace" }}>
                        {acct.is_admin_account ? "⚙" : "↳"}
                      </span>
                      <span className="truncate">{acct.company_name}</span>
                    </NavLink>
                  ))}
                  </div>}
                </div>
              )}
            </div>
          ))}

          {/* Build section */}
          <div>
            <button
              onClick={() => setBuildOpen(v => !v)}
              style={{
                display: "flex", alignItems: "center", gap: "10px",
                width: "100%", padding: "7px 12px", borderRadius: "4px",
                fontSize: "0.9375rem", fontWeight: buildPaths.some(p => location.pathname.startsWith(p)) ? 600 : 400,
                fontFamily: "var(--font-base)",
                background: buildPaths.some(p => location.pathname.startsWith(p)) ? "var(--twilio-red)" : "transparent",
                color: "var(--twilio-red)", border: "none", cursor: "pointer", textAlign: "left",
              }}
            >
              <StructureIcon width={16} height={16} style={{ flexShrink: 0, color: buildPaths.some(p => location.pathname.startsWith(p)) ? "#ffffff" : "var(--twilio-red)" }} />
              <span style={{ color: "#ffffff", flex: 1 }}>Build</span>
              <span style={{ color: "rgba(255,255,255,0.45)", fontSize: "0.75rem", marginLeft: "auto" }}>
                {buildOpen ? "▾" : "▸"}
              </span>
            </button>
            {buildOpen && (
              <div className="mt-0.5 space-y-0.5 pl-2">
                {[
                  { to: "/skills", label: "Claude Skills", Icon: CodeIcon },
                  { to: "/edit-preview", label: "Layouts", Icon: InnovationIcon },
                  { to: "/discover", label: "Discovery", Icon: InnovationIcon },
                ].map(({ to, label, Icon }) => (
                  <NavLink
                    key={to}
                    to={to}
                    style={({ isActive }) => ({
                      display: "flex", alignItems: "center", gap: "6px",
                      padding: "5px 10px", borderRadius: "4px",
                      fontSize: "0.8125rem", fontFamily: "var(--font-base)",
                      textDecoration: "none", transition: "background 0.15s, color 0.15s",
                      background: isActive ? "rgba(255,255,255,0.12)" : "transparent",
                      color: isActive ? "rgba(255,255,255,0.95)" : "rgba(255,255,255,0.45)",
                      fontWeight: isActive ? 500 : 400,
                    })}
                    onMouseEnter={(e) => {
                      (e.currentTarget as HTMLAnchorElement).style.background = "var(--twilio-navy-light)";
                      (e.currentTarget as HTMLAnchorElement).style.color = "rgba(255,255,255,0.85)";
                    }}
                    onMouseLeave={(e) => {
                      const el = e.currentTarget as HTMLAnchorElement;
                      const isSelected = location.pathname === to || location.pathname.startsWith(to + "/");
                      el.style.background = isSelected ? "rgba(255,255,255,0.12)" : "transparent";
                      el.style.color = isSelected ? "rgba(255,255,255,0.95)" : "rgba(255,255,255,0.45)";
                    }}
                  >
                    <Icon width={14} height={14} style={{ flexShrink: 0 }} />
                    <span className="truncate">{label}</span>
                  </NavLink>
                ))}
              </div>
            )}
          </div>
        </nav>

        {/* Activity Log + Settings + Profile — sit above the animation */}
        <div className="px-3 space-y-1.5 pb-2">
          {[
            { to: "/logs", label: "Activity Log", Icon: NotificationIcon },
            ...(profile?.is_staff ? [{ to: "/admin-data", label: "Admin Data", Icon: SettingsIcon }] : []),
            { to: "/settings", label: "Settings", Icon: SettingsIcon },
          ].map(({ to, label, Icon }) => (
            <NavLink
              key={to}
              to={to}
              className="nav-bottom-link"
              style={({ isActive }) => ({
                display: "flex",
                alignItems: "center",
                gap: "10px",
                padding: "7px 12px",
                borderRadius: "4px",
                fontSize: "0.9375rem",
                fontWeight: isActive ? 600 : 400,
                fontFamily: "var(--font-base)",
                textDecoration: "none",
                background: isActive ? "var(--twilio-red)" : "transparent",
                color: isActive ? "#ffffff" : "var(--twilio-red)",
              })}
            >
              <Icon width={16} height={16} style={{ flexShrink: 0 }} />
              <span style={{ color: "#ffffff" }}>{label}</span>
            </NavLink>
          ))}
        </div>

        {/* Sync runner — outside padded section so it spans full sidebar width */}
        <SyncRunner />

        {/* Dark / light toggle + version */}
        <div
          className="px-3 py-4 border-t space-y-2"
          style={{ borderColor: "rgba(255,255,255,0.08)" }}
        >
          {/* User profile card */}
          {profile && (
            <NavLink
              to="/profile"
              style={{ textDecoration: "none" }}
            >
              <div
                style={{
                  display: "flex", alignItems: "center", gap: 10,
                  padding: "6px 8px", borderRadius: 8,
                  cursor: "pointer", transition: "background 0.12s",
                }}
                onMouseEnter={e => (e.currentTarget.style.background = "rgba(255,255,255,0.07)")}
                onMouseLeave={e => (e.currentTarget.style.background = "transparent")}
              >
                <div style={{
                  width: 36, height: 36, borderRadius: "50%", flexShrink: 0,
                  background: "var(--twilio-red,#DB131A)",
                  display: "flex", alignItems: "center", justifyContent: "center",
                  fontSize: "0.9375rem", fontWeight: 700, color: "#fff",
                }}>
                  {(profile.display_name || profile.username || profile.email || "?")[0].toUpperCase()}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <p style={{
                    fontSize: "0.9375rem", fontWeight: 700, fontFamily: "var(--font-base)",
                    color: "#ffffff", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", margin: 0,
                  }}>
                    {profile.display_name || profile.username || profile.email}
                  </p>
                  {(profile.title || profile.role) && (
                    <p style={{
                      fontSize: "0.8125rem", fontFamily: "var(--font-base)", color: "rgba(255,255,255,0.55)",
                      marginTop: "1px", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", margin: 0,
                    }}>
                      {profile.title || profile.role}
                    </p>
                  )}
                </div>
              </div>
            </NavLink>
          )}
          {/* Lifetime token counter */}
          {lifetimeTokens > 0 && (
            <div style={{
              display: "flex", alignItems: "center", justifyContent: "center", gap: 5,
              padding: "4px 10px", borderRadius: "6px",
              background: "rgba(255,255,255,0.06)",
              marginBottom: 2,
            }}>
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.45)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/>
              </svg>
              <span style={{ fontSize: "0.6875rem", color: "rgba(255,255,255,0.5)", fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" }}>
                {lifetimeTokens >= 1_000_000
                  ? `${(lifetimeTokens / 1_000_000).toFixed(1)}M tokens`
                  : lifetimeTokens >= 1_000
                  ? `${(lifetimeTokens / 1_000).toFixed(1)}K tokens`
                  : `${lifetimeTokens} tokens`}
              </span>
            </div>
          )}

          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-evenly", gap: 4 }}>
              {/* Export button */}
              <button
                onClick={exportCount > 0 ? handleExportSend : toggleMode}
                title={exportMode ? (exportCount > 0 ? `Send ${exportCount} item${exportCount !== 1 ? "s" : ""} to chat` : "Exit export mode") : "Enter export mode"}
                style={{
                  position: "relative",
                  display: "flex", alignItems: "center", justifyContent: "center",
                  width: "30px", height: "30px", borderRadius: "6px",
                  border: "none", cursor: "pointer", transition: "background 0.15s",
                  background: exportMode ? "rgba(255,255,255,0.15)" : "transparent",
                  color: exportMode ? "#fff" : "rgba(255,255,255,0.6)",
                }}
                onMouseEnter={(e) => {
                  (e.currentTarget as HTMLButtonElement).style.background = "var(--twilio-navy-light)";
                  (e.currentTarget as HTMLButtonElement).style.color = "rgba(255,255,255,0.9)";
                }}
                onMouseLeave={(e) => {
                  (e.currentTarget as HTMLButtonElement).style.background = exportMode ? "rgba(255,255,255,0.15)" : "transparent";
                  (e.currentTarget as HTMLButtonElement).style.color = exportMode ? "#fff" : "rgba(255,255,255,0.6)";
                }}
              >
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                  <polyline points="17 8 12 3 7 8"/>
                  <line x1="12" y1="3" x2="12" y2="15"/>
                </svg>
                {exportCount > 0 && (
                  <span style={{
                    position: "absolute", top: 1, right: 1,
                    minWidth: 14, height: 14, borderRadius: 99,
                    background: "var(--twilio-red, #DB131A)", color: "#fff",
                    fontSize: "0.5625rem", fontWeight: 700,
                    display: "flex", alignItems: "center", justifyContent: "center",
                    padding: "0 3px", lineHeight: 1,
                  }}>{exportCount}</span>
                )}
              </button>
            <button
              onClick={toggle}
              title={dark ? "Switch to light mode" : "Switch to dark mode"}
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                width: "30px",
                height: "30px",
                borderRadius: "6px",
                background: "transparent",
                color: "rgba(255,255,255,0.6)",
                border: "none",
                cursor: "pointer",
                transition: "background 0.15s, color 0.15s",
              }}
              onMouseEnter={(e) => {
                (e.currentTarget as HTMLButtonElement).style.background = "var(--twilio-navy-light)";
                (e.currentTarget as HTMLButtonElement).style.color = "rgba(255,255,255,0.9)";
              }}
              onMouseLeave={(e) => {
                (e.currentTarget as HTMLButtonElement).style.background = "transparent";
                (e.currentTarget as HTMLButtonElement).style.color = "rgba(255,255,255,0.6)";
              }}
            >
              {dark ? (
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="5"/>
                  <line x1="12" y1="1" x2="12" y2="3"/>
                  <line x1="12" y1="21" x2="12" y2="23"/>
                  <line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/>
                  <line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/>
                  <line x1="1" y1="12" x2="3" y2="12"/>
                  <line x1="21" y1="12" x2="23" y2="12"/>
                  <line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/>
                  <line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/>
                </svg>
              ) : (
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>
                </svg>
              )}
            </button>

              {/* Feedback button */}
              <button
                onClick={() => setFeedbackOpen(true)}
                title="Share feedback or report an issue"
                style={{
                  display: "flex", alignItems: "center", justifyContent: "center",
                  width: "30px", height: "30px", borderRadius: "6px",
                  border: "none", cursor: "pointer", transition: "background 0.15s",
                  background: feedbackOpen || pickMode ? "rgba(255,255,255,0.15)" : "transparent",
                  color: feedbackOpen || pickMode ? "#fff" : "rgba(255,255,255,0.6)",
                }}
                onMouseEnter={(e) => {
                  if (!feedbackOpen && !pickMode) {
                    (e.currentTarget as HTMLButtonElement).style.background = "var(--twilio-navy-light)";
                    (e.currentTarget as HTMLButtonElement).style.color = "rgba(255,255,255,0.9)";
                  }
                }}
                onMouseLeave={(e) => {
                  if (!feedbackOpen && !pickMode) {
                    (e.currentTarget as HTMLButtonElement).style.background = "transparent";
                    (e.currentTarget as HTMLButtonElement).style.color = "rgba(255,255,255,0.6)";
                  }
                }}
              >
                {/* Flag / feedback icon */}
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"/>
                  <line x1="4" y1="22" x2="4" y2="15"/>
                </svg>
              </button>
          </div>
        </div>
      </aside>

      {/* Feedback modal */}
      {(feedbackOpen || pickMode) && (
        <FeedbackModal onClose={() => setFeedbackOpen(false)} />
      )}

      {/* Main */}
      <div className="flex-1 flex flex-col min-w-0">
        <ExportBar />
        <main className="flex-1 overflow-y-auto">
          <Outlet />
        </main>
        <TranscriptFooter />
      </div>
    </div>
    </DndContext>
  );
}
