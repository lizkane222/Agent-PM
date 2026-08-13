import { useCallback, useEffect, useState } from "react";
import type { Dispatch, SetStateAction } from "react";
import { accountsApi, airtableApi, teamApi } from "../lib/api";
import { useAppError } from "../context/AppErrorContext";
import type {
  Account,
  AccountNote,
  AccountQuickLink,
  AirtableAccount,
  AirtableActionItem,
  AirtableMeeting,
  CalendarEvent,
  CustomerContact,
  GoalSection,
  Reminder,
  TeamMember,
} from "../types";

export type LoadPhase = "idle" | "base" | "airtable" | "done" | "error";

export interface UseAccountDetailResult {
  account: Account | null;
  notes: AccountNote[];
  allMembers: TeamMember[];
  calendarEvents: CalendarEvent[];
  accountReminders: Reminder[];
  contacts: CustomerContact[];
  quickLinks: AccountQuickLink[];
  goals: GoalSection[];
  goalsLoaded: boolean;
  actionItems: AirtableActionItem[];
  meetings: AirtableMeeting[];
  airtableAccount: AirtableAccount | null;
  meetingReminders: Record<number, Reminder[]>;
  loading: boolean;
  phase: LoadPhase;
  error: Error | null;
  setAccount: Dispatch<SetStateAction<Account | null>>;
  setNotes: Dispatch<SetStateAction<AccountNote[]>>;
  setActionItems: Dispatch<SetStateAction<AirtableActionItem[]>>;
  setMeetings: Dispatch<SetStateAction<AirtableMeeting[]>>;
  setContacts: Dispatch<SetStateAction<CustomerContact[]>>;
  setQuickLinks: Dispatch<SetStateAction<AccountQuickLink[]>>;
  setAccountReminders: Dispatch<SetStateAction<Reminder[]>>;
  setMeetingReminders: Dispatch<SetStateAction<Record<number, Reminder[]>>>;
  setGoals: Dispatch<SetStateAction<GoalSection[]>>;
  refetch: () => void;
}

export function useAccountDetail(id: string | undefined): UseAccountDetailResult {
  const { reportError } = useAppError();
  const [account, setAccount] = useState<Account | null>(null);
  const [notes, setNotes] = useState<AccountNote[]>([]);
  const [allMembers, setAllMembers] = useState<TeamMember[]>([]);
  const [calendarEvents, setCalendarEvents] = useState<CalendarEvent[]>([]);
  const [accountReminders, setAccountReminders] = useState<Reminder[]>([]);
  const [contacts, setContacts] = useState<CustomerContact[]>([]);
  const [quickLinks, setQuickLinks] = useState<AccountQuickLink[]>([]);
  const [goals, setGoals] = useState<GoalSection[]>([]);
  const [goalsLoaded, setGoalsLoaded] = useState(false);
  const [actionItems, setActionItems] = useState<AirtableActionItem[]>([]);
  const [meetings, setMeetings] = useState<AirtableMeeting[]>([]);
  const [airtableAccount, setAirtableAccount] = useState<AirtableAccount | null>(null);
  const [meetingReminders, setMeetingReminders] = useState<Record<number, Reminder[]>>({});
  const [loading, setLoading] = useState(true);
  const [phase, setPhase] = useState<LoadPhase>("idle");
  const [error, setError] = useState<Error | null>(null);
  const [tick, setTick] = useState(0);

  const refetch = useCallback(() => setTick((t) => t + 1), []);

  useEffect(() => {
    if (!id) return;
    const numId = Number(id);
    setLoading(true);
    setPhase("base");
    setError(null);
    setGoals([]);
    setGoalsLoaded(false);

    Promise.all([
      accountsApi.getAccount(numId),
      accountsApi.listNotes(numId),
      teamApi.listMembers(),
      accountsApi.listCalendarEvents(numId),
      accountsApi.listAccountReminders(numId),
    ]).then(([acctRes, notesRes, membersRes, calRes, remindersRes]) => {
      setAccount(acctRes.data);
      setNotes(notesRes.data);
      setAllMembers(membersRes.data.results);
      setCalendarEvents(calRes.data);
      setAccountReminders(remindersRes.data);

      if (acctRes.data.company_name.toLowerCase() !== "admin") {
        accountsApi.listProjectsByAccount(acctRes.data.company_name)
          .then(({ data }) => {
            const loaded = data.results.map((p) => ({
              id: String(p.id),
              name: p.name,
              description: p.description ?? "",
              url: "",
              actionIds: [],
              meetingIds: [],
              goalIds: [],
              resources: [],
            }));
            setGoals(loaded);
            setGoalsLoaded(true);
          })
          .catch(() => setGoalsLoaded(true));
      }

      const atId = acctRes.data.airtable_id;
      if (atId) {
        setPhase("airtable");
        return Promise.all([
          airtableApi.listActionItems({ account: String(atId) }),
          airtableApi.listMeetings({ account: String(atId) }),
          airtableApi.listAccounts({ airtable_id: String(atId) }),
        ]).then(([itemsRes, meetingsRes, atAcctRes]) => {
          setActionItems(itemsRes.data);
          setMeetings(meetingsRes.data.results);
          setAirtableAccount(atAcctRes.data.results[0] ?? null);
        });
      }
    }).then(() => {
      setPhase("done");
    }).catch((err: unknown) => {
      setPhase("error");
      setError(err instanceof Error ? err : new Error("Load failed"));
      reportError(err instanceof Error ? err.message : "Failed to load account data", "accounts");
    }).finally(() => {
      setLoading(false);
    });

    accountsApi.listContacts(numId).then(({ data }) => setContacts(data.results)).catch(() => {});
    accountsApi.listQuickLinks(numId).then(({ data }) => setQuickLinks(data)).catch(() => {});
  }, [id, tick, reportError]);

  return {
    account,
    notes,
    allMembers,
    calendarEvents,
    accountReminders,
    contacts,
    quickLinks,
    goals,
    goalsLoaded,
    actionItems,
    meetings,
    airtableAccount,
    meetingReminders,
    loading,
    phase,
    error,
    setAccount,
    setNotes,
    setActionItems,
    setMeetings,
    setContacts,
    setQuickLinks,
    setAccountReminders,
    setMeetingReminders,
    setGoals,
    refetch,
  };
}
