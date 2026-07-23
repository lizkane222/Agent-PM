import { useEffect, useState } from "react";
import { airtableApi } from "../lib/api";

const FALLBACK_STATUS = ["Open", "In Progress", "Done", "Blocked", "Backlogged"];
const FALLBACK_PRIORITY = ["Critical", "High", "Medium", "Low"];

// Module-level cache so the API is called at most once per page load.
let _cached: { status: string[]; priority: string[] } | null = null;
let _promise: Promise<void> | null = null;

export function useActionItemFieldOptions() {
  const [options, setOptions] = useState<{ status: string[]; priority: string[] }>(
    _cached ?? { status: FALLBACK_STATUS, priority: FALLBACK_PRIORITY }
  );

  useEffect(() => {
    if (_cached) {
      setOptions(_cached);
      return;
    }
    if (!_promise) {
      _promise = airtableApi.getFieldOptions()
        .then(({ data }) => {
          _cached = {
            status: data.status?.length ? data.status : FALLBACK_STATUS,
            priority: data.priority?.length ? data.priority : FALLBACK_PRIORITY,
          };
        })
        .catch(() => {
          _cached = { status: FALLBACK_STATUS, priority: FALLBACK_PRIORITY };
        });
    }
    _promise.then(() => {
      if (_cached) setOptions(_cached);
    });
  }, []);

  return options;
}
