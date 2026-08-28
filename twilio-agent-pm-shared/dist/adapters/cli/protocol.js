// CLI adapter I/O protocol.
//
// Invocation contract (mirrors CLIBridge's CLIResult + ArtifactFileReader pattern):
//   stdin  — JSON CommandEnvelope (or CLI flags, see entry.ts)
//   stdout — exactly one JSON StatusLine, then EOF
//   stderr — all log output (info, warn, error)
//   exit 0 — success; exit 1 — error
//
// Large payloads are NEVER written to stdout (pipes truncate silently at ~64 KB).
// The caller reads the result from the path in StatusLine.outputPath.
//
// Swift/macOS side: passes the outputPath from StatusLine to ArtifactFileReader.readFile(at:).
import { z } from "zod";
// ── Input envelope ────────────────────────────────────────────────────────────
export const CommandNameSchema = z.enum([
    "getTitleRole",
    "dueDateGroup",
    "getRsvp",
    "fileIcon",
    "attachLinkIcon",
    "fmtBytes",
    "fmtTime",
    "formatArr",
    "calendarEventDisplay",
    "matchResourceLabel",
    "isTokenExpired",
    "toggleExportItem",
    "canvasFind",
    "canvasRemove",
    "canvasReducer",
    "claudeSkillTransition",
    "agentSkillTransition",
]);
export const CommandEnvelopeSchema = z.object({
    command: CommandNameSchema,
    // outputPath is required: caller supplies a writable path; result is written there.
    outputPath: z.string().min(1),
    // payload is command-specific; validated per-command inside the handler.
    payload: z.record(z.unknown()),
});
export function statusLine(fields) {
    return JSON.stringify(fields);
}
//# sourceMappingURL=protocol.js.map