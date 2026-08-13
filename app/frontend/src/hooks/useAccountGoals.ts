import { useRef, type Dispatch, type SetStateAction } from "react";
import { accountsApi } from "../lib/api";
import type { Account, GoalSection } from "../types";

export interface UseAccountGoalsResult {
  handleGoalsChange: (newGoals: GoalSection[]) => void;
}

export function useAccountGoals(
  account: Account | null,
  goals: GoalSection[],
  setGoals: Dispatch<SetStateAction<GoalSection[]>>,
  goalsLoaded: boolean,
): UseAccountGoalsResult {
  const prevGoalsRef = useRef<GoalSection[]>(goals);
  const pendingGoalSaves = useRef(new Set<string>());

  function handleGoalsChange(newGoals: GoalSection[]) {
    setGoals(newGoals);
    if (!account || account.company_name.toLowerCase() === "admin") {
      prevGoalsRef.current = newGoals;
      return;
    }
    const prev = prevGoalsRef.current;
    prevGoalsRef.current = newGoals;

    if (goalsLoaded) {
      for (const g of prev) {
        if (!newGoals.find((n) => n.id === g.id) && /^\d+$/.test(g.id)) {
          accountsApi.deleteProject(Number(g.id)).catch(() => {});
        }
      }
    }

    for (const g of newGoals) {
      if (!prev.find((p) => p.id === g.id) && !pendingGoalSaves.current.has(g.id)) {
        pendingGoalSaves.current.add(g.id);
        accountsApi
          .createProject({ account: account.id, name: g.name, description: g.description ?? "" })
          .then(({ data: saved }) => {
            pendingGoalSaves.current.delete(g.id);
            const newId = String(saved.id);
            prevGoalsRef.current = prevGoalsRef.current.map((x) =>
              x.id === g.id ? { ...x, id: newId } : x
            );
            setGoals((curr) => curr.map((x) => x.id === g.id ? { ...x, id: newId } : x));
          })
          .catch(() => {
            pendingGoalSaves.current.delete(g.id);
          });
      }
    }

    for (const g of newGoals) {
      const old = prev.find((p) => p.id === g.id);
      if (
        old &&
        (old.name !== g.name || old.description !== g.description) &&
        /^\d+$/.test(g.id)
      ) {
        accountsApi
          .updateProject(Number(g.id), { name: g.name, description: g.description ?? "" })
          .catch(() => {});
      }
    }
  }

  return { handleGoalsChange };
}
