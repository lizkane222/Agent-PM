import { http, HttpResponse } from "msw";
import type { SearchResult } from "../../lib/api";

export const mockSearchResults: SearchResult[] = [
  {
    type: "account",
    type_label: "Account",
    id: 1,
    title: "Acme Corp",
    detail: "Technology",
    account: "Acme Corp",
    meta: "",
    url: "/accounts/1",
    accent: "blue",
  },
  {
    type: "action_item",
    type_label: "Action Item",
    id: 2,
    title: "Finish Q3 review",
    detail: "Open",
    account: "Acme Corp",
    meta: "",
    url: "/action-items/2",
    accent: "indigo",
  },
];

export const searchHandlers = [
  http.get("/api/v1/search/", () => HttpResponse.json({ results: mockSearchResults })),
];
