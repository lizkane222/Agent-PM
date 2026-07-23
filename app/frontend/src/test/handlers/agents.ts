import { http, HttpResponse } from "msw";
import type { AgentSession } from "../../types";

export const mockAgentSessions: AgentSession[] = [
  {
    id: 1,
    title: "Q3 Planning Session",
    status: "completed",
    is_shared: false,
    owner_username: "alice",
    participants: [],
    started_at: "2026-07-01T10:00:00Z",
    ended_at: "2026-07-01T11:00:00Z",
    messages: [],
    created_at: "2026-07-01T10:00:00Z",
    updated_at: "2026-07-01T11:00:00Z",
  },
];

export const agentsHandlers = [
  http.get("/api/v1/agents/sessions/", () =>
    HttpResponse.json({ results: mockAgentSessions, count: mockAgentSessions.length })
  ),
];
