import { feedbackApi } from "../lib/api";
import { useResource } from "./useResource";
import type { FeedbackItem } from "../types/feedback";

export function useFeedbackItems() {
  return useResource<FeedbackItem>(
    () => feedbackApi.list().then((r) => r.data.results),
  );
}
