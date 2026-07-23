import { createContext, useContext, useEffect, useState } from "react";
import { teamApi } from "../lib/api";
import { identify, track } from "../lib/analytics";
import type { UserProfile } from "../types";

const DAILY_OPEN_KEY = "agentpm_last_opened_date";

interface CurrentUserContextValue {
  profile: UserProfile | null;
}

const CurrentUserContext = createContext<CurrentUserContextValue>({ profile: null });

export function CurrentUserProvider({ children }: { children: React.ReactNode }) {
  const [profile, setProfile] = useState<UserProfile | null>(null);

  useEffect(() => {
    teamApi.getMyProfile()
      .then(({ data }) => {
        setProfile(data);
        // Identify the user with Segment on every app load
        identify(data.id, {
          username: data.username,
          email: data.email,
          display_name: data.display_name,
          title: data.title,
          role: data.role,
          timezone: data.timezone,
        });
        // Fire "App Opened" once per calendar day
        const today = new Date().toISOString().slice(0, 10);
        const lastOpened = localStorage.getItem(DAILY_OPEN_KEY);
        if (lastOpened !== today) {
          track("App Opened", { date: today });
          localStorage.setItem(DAILY_OPEN_KEY, today);
        }
      })
      .catch(() => {});
  }, []);

  return (
    <CurrentUserContext.Provider value={{ profile }}>
      {children}
    </CurrentUserContext.Provider>
  );
}

export function useCurrentUser(): UserProfile | null {
  return useContext(CurrentUserContext).profile;
}
