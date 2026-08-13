import { useCallback, useEffect, useRef, useState } from "react";
import { airtableApi } from "../lib/api";
import { addLog } from "../lib/appLog";
import { useAppError } from "../context/AppErrorContext";
import type { EventAccountLink } from "../types/calendar";
import type { CalendarEvent } from "../types/scheduler";

export interface UseEventAccountLinksResult {
  eventAccountLinks: Map<string, EventAccountLink>;
  setEventAccountLinks: React.Dispatch<React.SetStateAction<Map<string, EventAccountLink>>>;
  linkEventToAccount: (accountId: number, accountName: string, eventUid?: string, selectedEvent?: CalendarEvent | null, events?: CalendarEvent[]) => Promise<void>;
  unlinkEvent: (eventUid: string) => Promise<void>;
  bulkUpdateLinks: (byUid: Record<string, { linked: boolean; airtable_account_id?: number; account_name?: string }>, events: CalendarEvent[]) => void;
  linkEventToAccountRef: React.MutableRefObject<(accountId: number, accountName: string, eventUid: string, selectedEvent?: CalendarEvent | null, events?: CalendarEvent[]) => void>;
  lastLinkedEventName: string | null;
  setLastLinkedEventName: (name: string | null) => void;
  meetingDetailReloadTrigger: number;
}

export function useEventAccountLinks(): UseEventAccountLinksResult {
  const { reportError } = useAppError();
  const [eventAccountLinks, setEventAccountLinks] = useState<Map<string, EventAccountLink>>(new Map());
  const [lastLinkedEventName, setLastLinkedEventName] = useState<string | null>(null);
  const [meetingDetailReloadTrigger, setMeetingDetailReloadTrigger] = useState(0);

  const linkEventToAccountRef = useRef<(accountId: number, accountName: string, eventUid: string, selectedEvent?: CalendarEvent | null, events?: CalendarEvent[]) => void>(() => {});

  function applyDualKey(prev: Map<string, EventAccountLink>, uid: string, link: EventAccountLink, linkedEvent?: CalendarEvent | null): Map<string, EventAccountLink> {
    const next = new Map(prev);
    next.set(uid, link);
    if (linkedEvent?.google_event_id && linkedEvent.google_event_id !== uid)
      next.set(linkedEvent.google_event_id, link);
    if (linkedEvent && String(linkedEvent.id) !== uid)
      next.set(String(linkedEvent.id), link);
    return next;
  }

  const linkEventToAccount = useCallback(async (
    accountId: number,
    accountName: string,
    eventUid?: string,
    selectedEvent?: CalendarEvent | null,
    events?: CalendarEvent[],
  ) => {
    const uid = eventUid
      ?? (selectedEvent?.google_event_id || (selectedEvent?.id ? String(selectedEvent.id) : undefined));
    if (!uid) return;
    const linkedEvent = (events ?? []).find((e) => e.google_event_id === uid || String(e.id) === uid);
    const link: EventAccountLink = { accountId, accountName };
    // Optimistic update under all known keys for this event
    setEventAccountLinks((prev) => applyDualKey(prev, uid, link, linkedEvent));
    const evTitle = linkedEvent?.title ?? accountName;
    setLastLinkedEventName(evTitle);
    setTimeout(() => setLastLinkedEventName(null), 2500);
    try {
      await airtableApi.categorizeEvent({ event_uid: uid, account_id: accountId });
      setMeetingDetailReloadTrigger((n) => n + 1);
      addLog({
        category: "calendar",
        message: `Account "${accountName}" linked to event "${evTitle}"`,
        links: [{ label: "View calendar", path: "/calendar?glow=1" }],
        ...(linkedEvent ? { resource: { type: "calendar_event" as const, id: linkedEvent.id } } : {}),
      });
    } catch (err) {
      setEventAccountLinks((prev) => {
        const next = new Map(prev);
        next.delete(uid);
        return next;
      });
      setLastLinkedEventName(null);
      reportError(
        err instanceof Error ? err.message : "Failed to link event to account",
        "calendar",
      );
    }
  }, [reportError]);

  // Keep ref current so eventDidMount closures never go stale
  useEffect(() => {
    linkEventToAccountRef.current = (accountId, accountName, eventUid, selectedEvent, events) =>
      void linkEventToAccount(accountId, accountName, eventUid, selectedEvent, events);
  }, [linkEventToAccount]);

  const unlinkEvent = useCallback(async (eventUid: string) => {
    setEventAccountLinks((prev) => {
      const next = new Map(prev);
      next.delete(eventUid);
      return next;
    });
    try {
      await airtableApi.categorizeEvent({ event_uid: eventUid, account_id: null });
    } catch (err) {
      reportError(
        err instanceof Error ? err.message : "Failed to unlink event",
        "calendar",
      );
    }
  }, [reportError]);

  function bulkUpdateLinks(
    byUid: Record<string, { linked: boolean; airtable_account_id?: number; account_name?: string }>,
    events: CalendarEvent[],
  ): void {
    setEventAccountLinks((prev) => {
      const next = new Map(prev);
      for (const [uid, d] of Object.entries(byUid)) {
        if (!d.linked || !d.airtable_account_id || !d.account_name) continue;
        const link: EventAccountLink = { accountId: d.airtable_account_id, accountName: d.account_name };
        next.set(uid, link);
        const ev = events.find((e) => e.google_event_id === uid || String(e.id) === uid);
        if (ev) {
          if (ev.google_event_id && ev.google_event_id !== uid) next.set(ev.google_event_id, link);
          if (String(ev.id) !== uid) next.set(String(ev.id), link);
        }
      }
      return next;
    });
  }

  return {
    eventAccountLinks, setEventAccountLinks,
    linkEventToAccount, unlinkEvent, bulkUpdateLinks,
    linkEventToAccountRef,
    lastLinkedEventName, setLastLinkedEventName,
    meetingDetailReloadTrigger,
  };
}
