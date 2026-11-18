import { apiClient } from "./api";
import type { SensitiveMark, SensitiveMarksResponse, SensitiveResourceType } from "../types/sensitive";

/** Sensitive-text marks API. Kept out of lib/api.ts so that busy file stays untouched. */
export const sensitiveApi = {
  list: (resourceType: SensitiveResourceType, resourceIds: string[]) =>
    apiClient.get<SensitiveMarksResponse>("/sensitive/marks/", {
      params: { resource_type: resourceType, resource_ids: resourceIds.join(",") },
    }),
  create: (data: {
    resource_type: SensitiveResourceType;
    resource_id: string;
    field: string;
    text: string;
    line_key?: string;
  }) => apiClient.post<SensitiveMark>("/sensitive/marks/", data),
  remove: (id: number) => apiClient.delete(`/sensitive/marks/${id}/`),
};
