#!/usr/bin/env node
// CLI adapter entry point.
//
// Reads a JSON CommandEnvelope from stdin, calls the brain, writes the result
// to the caller-supplied outputPath, then prints exactly one JSON StatusLine
// to stdout and exits.
//
// NOTHING other than the StatusLine may be written to stdout.
// All diagnostics go to stderr.
//
// Modelled after CLIBridge (subprocess invocation) + ArtifactFileReader (disk reads).
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { CommandEnvelopeSchema, statusLine } from "./protocol.js";
import { dispatch } from "./handlers.js";
function log(msg) {
    process.stderr.write(`[agentpm-cli] ${msg}\n`);
}
// Collapse multi-line error messages to a single line for the StatusLine JSON.
function compact(s) {
    return s.replace(/\s+/g, " ").trim();
}
async function main() {
    let rawInput;
    try {
        rawInput = readFileSync(process.stdin.fd, "utf8");
    }
    catch (err) {
        const outputPath = "/tmp/agentpm-cli-error.json";
        writeFileSync(outputPath, JSON.stringify({ error: "Failed to read stdin", detail: String(err) }));
        process.stdout.write(statusLine({ ok: false, command: "unknown", outputPath, errorMessage: "stdin read failed" }));
        process.exit(1);
    }
    let envelope;
    try {
        const raw = JSON.parse(rawInput);
        envelope = CommandEnvelopeSchema.parse(raw);
    }
    catch (err) {
        const outputPath = "/tmp/agentpm-cli-error.json";
        const errorMessage = compact(err instanceof Error ? err.message : String(err));
        log(`Envelope parse error: ${errorMessage}`);
        writeFileSync(outputPath, JSON.stringify({ error: "Invalid envelope", detail: errorMessage }));
        process.stdout.write(statusLine({ ok: false, command: "unknown", outputPath, errorMessage }));
        process.exit(1);
    }
    const { command, outputPath } = envelope;
    log(`command=${command} outputPath=${outputPath}`);
    let result;
    try {
        result = dispatch(envelope);
    }
    catch (err) {
        const errorMessage = compact(err instanceof Error ? err.message : String(err));
        log(`Dispatch error: ${errorMessage}`);
        mkdirSync(dirname(outputPath), { recursive: true });
        writeFileSync(outputPath, JSON.stringify({ error: errorMessage }));
        process.stdout.write(statusLine({ ok: false, command, outputPath, errorMessage }));
        process.exit(1);
    }
    try {
        mkdirSync(dirname(outputPath), { recursive: true });
        writeFileSync(outputPath, JSON.stringify(result));
    }
    catch (err) {
        const errorMessage = `Failed to write output: ${err instanceof Error ? err.message : String(err)}`;
        log(errorMessage);
        process.stdout.write(statusLine({ ok: false, command, outputPath, errorMessage }));
        process.exit(1);
    }
    // Success — one line to stdout, then done.
    process.stdout.write(statusLine({ ok: true, command, outputPath }));
    process.exit(0);
}
main();
//# sourceMappingURL=entry.js.map