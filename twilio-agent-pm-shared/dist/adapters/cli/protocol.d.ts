import { z } from "zod";
export declare const CommandNameSchema: z.ZodEnum<["getTitleRole", "dueDateGroup", "getRsvp", "fileIcon", "attachLinkIcon", "fmtBytes", "fmtTime", "formatArr", "calendarEventDisplay", "matchResourceLabel", "isTokenExpired", "toggleExportItem", "canvasFind", "canvasRemove", "canvasReducer", "claudeSkillTransition", "agentSkillTransition"]>;
export type CommandName = z.infer<typeof CommandNameSchema>;
export declare const CommandEnvelopeSchema: z.ZodObject<{
    command: z.ZodEnum<["getTitleRole", "dueDateGroup", "getRsvp", "fileIcon", "attachLinkIcon", "fmtBytes", "fmtTime", "formatArr", "calendarEventDisplay", "matchResourceLabel", "isTokenExpired", "toggleExportItem", "canvasFind", "canvasRemove", "canvasReducer", "claudeSkillTransition", "agentSkillTransition"]>;
    outputPath: z.ZodString;
    payload: z.ZodRecord<z.ZodString, z.ZodUnknown>;
}, "strip", z.ZodTypeAny, {
    command: "getTitleRole" | "dueDateGroup" | "getRsvp" | "fileIcon" | "attachLinkIcon" | "fmtBytes" | "fmtTime" | "formatArr" | "calendarEventDisplay" | "matchResourceLabel" | "isTokenExpired" | "toggleExportItem" | "canvasFind" | "canvasRemove" | "canvasReducer" | "claudeSkillTransition" | "agentSkillTransition";
    outputPath: string;
    payload: Record<string, unknown>;
}, {
    command: "getTitleRole" | "dueDateGroup" | "getRsvp" | "fileIcon" | "attachLinkIcon" | "fmtBytes" | "fmtTime" | "formatArr" | "calendarEventDisplay" | "matchResourceLabel" | "isTokenExpired" | "toggleExportItem" | "canvasFind" | "canvasRemove" | "canvasReducer" | "claudeSkillTransition" | "agentSkillTransition";
    outputPath: string;
    payload: Record<string, unknown>;
}>;
export type CommandEnvelope = z.infer<typeof CommandEnvelopeSchema>;
export interface StatusLine {
    ok: boolean;
    command: string;
    outputPath: string;
    errorMessage?: string;
}
export declare function statusLine(fields: StatusLine): string;
//# sourceMappingURL=protocol.d.ts.map