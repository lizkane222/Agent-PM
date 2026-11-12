import { useCallback } from "react";
import { accountsApi } from "../lib/api";
import { useResource } from "./useResource";
import type { AccountTicket, TicketKind } from "../types";

interface TicketParams {
  /** Account id; omit (with `review`) to list records that have no account yet. */
  account?: number | null;
  kind?: TicketKind;
  review?: "needs_review";
}

export interface UseAccountTicketsResult {
  data: AccountTicket[];
  loading: boolean;
  error: Error | null;
  refetch: () => void;
  createTicket: (payload: Partial<AccountTicket>) => Promise<AccountTicket>;
  updateTicket: (id: number, payload: Partial<AccountTicket>) => Promise<AccountTicket>;
  removeTicket: (id: number) => Promise<void>;
  assignTicket: (id: number, payload: { account: number; kind?: TicketKind; title?: string }) => Promise<AccountTicket>;
}

/** Tickets / product gaps for one account + kind, or the caller's "needs review" queue. */
export function useAccountTickets({ account, kind, review }: TicketParams): UseAccountTicketsResult {
  const params: Record<string, string> = {};
  if (account != null) params.account = String(account);
  if (kind) params.kind = kind;
  if (review) params.review = review;

  const resource = useResource<AccountTicket>(
    () => accountsApi.listTickets(params).then((r) => r.data),
    [account, kind, review],
  );
  const refetch = resource.refetch;

  const createTicket = useCallback(async (payload: Partial<AccountTicket>) => {
    const { data } = await accountsApi.createTicket(payload);
    refetch();
    return data;
  }, [refetch]);

  const updateTicket = useCallback(async (id: number, payload: Partial<AccountTicket>) => {
    const { data } = await accountsApi.updateTicket(id, payload);
    refetch();
    return data;
  }, [refetch]);

  const removeTicket = useCallback(async (id: number) => {
    await accountsApi.deleteTicket(id);
    refetch();
  }, [refetch]);

  const assignTicket = useCallback(async (id: number, payload: { account: number; kind?: TicketKind; title?: string }) => {
    const { data } = await accountsApi.assignTicket(id, payload);
    refetch();
    return data;
  }, [refetch]);

  return { ...resource, createTicket, updateTicket, removeTicket, assignTicket };
}
