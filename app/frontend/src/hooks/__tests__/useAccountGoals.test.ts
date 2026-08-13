import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { http, HttpResponse } from "msw";
import { useState } from "react";
import { server } from "../../test/msw-server";
import { mockAccount, mockProject } from "../../test/handlers/accounts";
import { useAccountGoals } from "../useAccountGoals";
import type { GoalSection } from "../../types";

const baseGoal: GoalSection = {
  id: "1",
  name: "Q3 Launch",
  description: "Q3 launch plan",
  actionIds: [],
  meetingIds: [],
  goalIds: [],
  resources: [],
};

const tempGoal: GoalSection = {
  id: "temp-abc",
  name: "New Goal",
  description: "",
  actionIds: [],
  meetingIds: [],
  goalIds: [],
  resources: [],
};

function useTestWrapper(
  initialGoals: GoalSection[],
  account = mockAccount,
  goalsLoaded = true,
) {
  const [goals, setGoals] = useState<GoalSection[]>(initialGoals);
  const { handleGoalsChange } = useAccountGoals(account, goals, setGoals, goalsLoaded);
  return { goals, setGoals, handleGoalsChange };
}

describe("useAccountGoals", () => {
  it("adding a goal with a temp id creates a project via API and swaps in the real id", async () => {
    server.use(
      http.post("/api/v1/accounts/projects/", async ({ request }) => {
        const body = await request.json() as { name: string };
        return HttpResponse.json({ ...mockProject, id: 99, name: body.name }, { status: 201 });
      })
    );

    const { result } = renderHook(() => useTestWrapper([]));

    act(() => {
      result.current.handleGoalsChange([tempGoal]);
    });

    await waitFor(() =>
      expect(result.current.goals.find((g) => g.name === "New Goal")?.id).toBe("99")
    );
  });

  it("removing a goal with a numeric id deletes the project via API", async () => {
    let deletedId: string | undefined;
    server.use(
      http.delete("/api/v1/accounts/projects/:id/", ({ params }) => {
        deletedId = params.id as string;
        return new HttpResponse(null, { status: 204 });
      })
    );

    const { result } = renderHook(() => useTestWrapper([baseGoal], mockAccount, true));

    act(() => {
      result.current.handleGoalsChange([]);
    });

    await waitFor(() => expect(deletedId).toBe("1"));
  });

  it("renaming a goal with a numeric id updates the project via API", async () => {
    let patchedName: string | undefined;
    server.use(
      http.patch("/api/v1/accounts/projects/:id/", async ({ request }) => {
        const body = await request.json() as { name: string };
        patchedName = body.name;
        return HttpResponse.json({ ...mockProject, name: body.name });
      })
    );

    const { result } = renderHook(() => useTestWrapper([baseGoal]));

    act(() => {
      result.current.handleGoalsChange([{ ...baseGoal, name: "Renamed Goal" }]);
    });

    await waitFor(() => expect(patchedName).toBe("Renamed Goal"));
  });

  it("does not delete goals whose id is not numeric even when goalsLoaded is true", async () => {
    let deleteHit = false;
    server.use(
      http.delete("/api/v1/accounts/projects/:id/", () => {
        deleteHit = true;
        return new HttpResponse(null, { status: 204 });
      })
    );

    const { result } = renderHook(() => useTestWrapper([tempGoal], mockAccount, true));

    act(() => {
      result.current.handleGoalsChange([]);
    });

    // Give any async work a chance to run
    await new Promise((r) => setTimeout(r, 50));
    expect(deleteHit).toBe(false);
  });

  it("does not make API calls for an admin account", async () => {
    let apiHit = false;
    server.use(
      http.post("/api/v1/accounts/projects/", () => {
        apiHit = true;
        return HttpResponse.json(mockProject, { status: 201 });
      }),
      http.delete("/api/v1/accounts/projects/:id/", () => {
        apiHit = true;
        return new HttpResponse(null, { status: 204 });
      })
    );

    const adminAccount = { ...mockAccount, company_name: "Admin" };
    const { result } = renderHook(() => useTestWrapper([baseGoal], adminAccount, true));

    act(() => {
      result.current.handleGoalsChange([tempGoal]);
    });

    await new Promise((r) => setTimeout(r, 50));
    expect(apiHit).toBe(false);
  });

  it("does not create duplicate goals when called twice with the same temp id", async () => {
    let createCount = 0;
    server.use(
      http.post("/api/v1/accounts/projects/", async () => {
        createCount++;
        await new Promise((r) => setTimeout(r, 20));
        return HttpResponse.json({ ...mockProject, id: 99, name: "New Goal" }, { status: 201 });
      })
    );

    const { result } = renderHook(() => useTestWrapper([]));

    act(() => {
      result.current.handleGoalsChange([tempGoal]);
    });
    act(() => {
      result.current.handleGoalsChange([tempGoal]);
    });

    await waitFor(() => expect(result.current.goals.find((g) => g.name === "New Goal")?.id).toBe("99"));
    expect(createCount).toBe(1);
  });
});
