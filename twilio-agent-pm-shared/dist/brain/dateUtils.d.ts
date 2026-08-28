/** Date → RFC3339 string preserving local wall-clock time and real UTC offset. */
export declare function dateToLocalISO(d: Date): string;
/**
 * Converts a local "YYYY-MM-DDTHH:MM:SS" string (no tz suffix) to RFC3339
 * with the current environment's real UTC offset.
 */
export declare function toLocalISO(localStr: string): string;
/**
 * Adds milliseconds to a local ISO string and returns a new RFC3339 local string.
 * Does NOT go through toISOString() — that would return UTC and cause a
 * double-offset bug when feeding the result back into toLocalISO().
 */
export declare function addMsToLocalISO(localStr: string, ms: number): string;
//# sourceMappingURL=dateUtils.d.ts.map