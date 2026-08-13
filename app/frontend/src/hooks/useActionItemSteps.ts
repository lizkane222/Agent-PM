import { useCallback } from "react";
import { stepsApi } from "../lib/api";
import { useResource } from "./useResource";
import type { ActionItemStep, StepStatus } from "../types";

export function useActionItemSteps(actionItemId: number | null) {
  const { data: steps, loading, error, refetch } = useResource<ActionItemStep>(
    () => {
      if (!actionItemId) return Promise.resolve([]);
      return stepsApi.list(actionItemId).then((r) => r.data);
    },
    [actionItemId],
  );

  const addStep = useCallback(
    async (title: string) => {
      if (!actionItemId) return;
      await stepsApi.create({ action_item: actionItemId, title, order: steps.length });
      refetch();
    },
    [actionItemId, steps.length, refetch],
  );

  const updateStep = useCallback(
    async (id: number, data: Partial<Pick<ActionItemStep, "title" | "status" | "order">>) => {
      await stepsApi.update(id, data);
      refetch();
    },
    [refetch],
  );

  const deleteStep = useCallback(
    async (id: number) => {
      await stepsApi.delete(id);
      refetch();
    },
    [refetch],
  );

  const setStatus = useCallback(
    async (id: number, status: StepStatus) => {
      await stepsApi.update(id, { status });
      refetch();
    },
    [refetch],
  );

  return { steps, loading, error, refetch, addStep, updateStep, deleteStep, setStatus };
}
