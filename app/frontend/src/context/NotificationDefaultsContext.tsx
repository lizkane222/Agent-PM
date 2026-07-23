/**
 * NotificationDefaultsContext
 *
 * Single source of truth for the four reminder notification default flags.
 * Fetched once on mount (inside RequireAuth), written to the server on every
 * change. Both SettingsPage and RemindersPage consume this context so any
 * toggle on either page is immediately reflected on the other.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import { teamApi } from "../lib/api";

export interface NotificationDefaults {
  notify_default_in_app: boolean;
  notify_default_slack: boolean;
  notify_default_push: boolean;
  notify_default_sms: boolean;
}

interface NotificationDefaultsContextValue {
  defaults: NotificationDefaults;
  /** Update one or more fields locally and persist to the server. */
  setDefaults: (patch: Partial<NotificationDefaults>) => void;
  loaded: boolean;
}

const FALLBACK: NotificationDefaults = {
  notify_default_in_app: true,
  notify_default_slack: false,
  notify_default_push: false,
  notify_default_sms: false,
};

const NotificationDefaultsContext =
  createContext<NotificationDefaultsContextValue>({
    defaults: FALLBACK,
    setDefaults: () => {},
    loaded: false,
  });

export function NotificationDefaultsProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [defaults, setDefaultsState] = useState<NotificationDefaults>(FALLBACK);
  const [loaded, setLoaded] = useState(false);
  const defaultsRef = useRef<NotificationDefaults>(FALLBACK);

  useEffect(() => {
    teamApi
      .getMyProfile()
      .then(({ data }) => {
        const loaded: NotificationDefaults = {
          notify_default_in_app: data.notify_default_in_app ?? true,
          notify_default_slack: data.notify_default_slack ?? false,
          notify_default_push: data.notify_default_push ?? false,
          notify_default_sms: data.notify_default_sms ?? false,
        };
        defaultsRef.current = loaded;
        setDefaultsState(loaded);
      })
      .catch(() => {})
      .finally(() => setLoaded(true));
  }, []);

  const setDefaults = useCallback((patch: Partial<NotificationDefaults>) => {
    const next = { ...defaultsRef.current, ...patch };
    defaultsRef.current = next;
    setDefaultsState(next);
    // Fire-and-forget — optimistic update; failure is silent (non-critical preference)
    teamApi.updateMyProfile(next).catch(() => {});
  }, []);

  return (
    <NotificationDefaultsContext.Provider value={{ defaults, setDefaults, loaded }}>
      {children}
    </NotificationDefaultsContext.Provider>
  );
}

export function useNotificationDefaults() {
  return useContext(NotificationDefaultsContext);
}
