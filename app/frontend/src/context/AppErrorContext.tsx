import { createContext, useCallback, useContext, useState } from "react";
import { addError } from "../lib/errorLog";
import type { AppError } from "../types/errors";
import AppErrorBanner from "../components/AppErrorBanner";

interface AppErrorContextValue {
  reportError: (message: string, source?: string) => void;
}

const AppErrorContext = createContext<AppErrorContextValue>({ reportError: () => {} });

export function useAppError(): AppErrorContextValue {
  return useContext(AppErrorContext);
}

export function AppErrorProvider({ children }: { children: React.ReactNode }) {
  const [liveErrors, setLiveErrors] = useState<AppError[]>([]);

  const dismiss = useCallback((id: string) => {
    setLiveErrors((prev) => prev.filter((e) => e.id !== id));
  }, []);

  const reportError = useCallback((message: string, source?: string) => {
    const entry = addError({ message, source });
    setLiveErrors((prev) => [...prev, entry]);
    setTimeout(() => {
      setLiveErrors((prev) => prev.filter((e) => e.id !== entry.id));
    }, 5000);
  }, []);

  return (
    <AppErrorContext.Provider value={{ reportError }}>
      {children}
      <AppErrorBanner errors={liveErrors} onDismiss={dismiss} />
    </AppErrorContext.Provider>
  );
}
