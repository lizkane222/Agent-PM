import { createContext, useCallback, useContext, useState } from "react";

export interface FeedbackAttachedElement {
  label: string;       // human-readable e.g. "Kanban card: Fix login bug"
  path: string;        // CSS selector / route path captured on click
  pageUrl: string;     // window.location.href at time of capture
}

interface FeedbackContextValue {
  pickMode: boolean;
  attachedElement: FeedbackAttachedElement | null;
  startPick: () => void;
  cancelPick: () => void;
  attachElement: (el: FeedbackAttachedElement) => void;
  clearAttached: () => void;
}

const FeedbackContext = createContext<FeedbackContextValue | null>(null);

export function FeedbackProvider({ children }: { children: React.ReactNode }) {
  const [pickMode, setPickMode] = useState(false);
  const [attachedElement, setAttachedElement] = useState<FeedbackAttachedElement | null>(null);

  const startPick = useCallback(() => setPickMode(true), []);

  const cancelPick = useCallback(() => setPickMode(false), []);

  const attachElement = useCallback((el: FeedbackAttachedElement) => {
    setAttachedElement(el);
    setPickMode(false);
  }, []);

  const clearAttached = useCallback(() => setAttachedElement(null), []);

  return (
    <FeedbackContext.Provider value={{ pickMode, attachedElement, startPick, cancelPick, attachElement, clearAttached }}>
      {children}
    </FeedbackContext.Provider>
  );
}

export function useFeedback() {
  const ctx = useContext(FeedbackContext);
  if (!ctx) throw new Error("useFeedback must be inside FeedbackProvider");
  return ctx;
}
