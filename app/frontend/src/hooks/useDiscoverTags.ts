import { discoverApi } from "../lib/api";
import { useResource } from "./useResource";
import type { DiscoverTag } from "../types/discover";

/** Every tag in use on any Discovery item, most used first. Read-only. */
export function useDiscoverTags() {
  return useResource<DiscoverTag>(() => discoverApi.listTags().then((r) => r.data.tags));
}
