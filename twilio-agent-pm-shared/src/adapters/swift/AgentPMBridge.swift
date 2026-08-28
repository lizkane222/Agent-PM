import Foundation

// ---------------------------------------------------------------------------
// AgentPMBridge — Swift adapter for the agentpm-cli subprocess.
//
// Invocation contract (mirrors CLIBridge + ArtifactFileReader):
//   stdin  — JSON CommandEnvelope  { command, outputPath, payload }
//   stdout — exactly one JSON StatusLine, then EOF
//   stderr — diagnostic log lines  (prefix: "[agentpm-cli]")
//   exit 0 — success; exit 1 — error
//
// Large payloads are NEVER in stdout. After a successful call, read the
// result from StatusLine.outputPath via Foundation's JSONDecoder — same
// pattern as ArtifactFileReader.readFile(at:).
//
// Binary resolution order (mirrors CLIBridge.resolveCLIPath):
//   1. .app/Contents/Helpers/agentpm-cli  (bundled standalone, no shell)
//   2. $(which agentpm-cli)               (system PATH, via zsh login shell)
//   3. node <monorepo>/dist/adapters/cli/entry.js  (monorepo dev)
// ---------------------------------------------------------------------------

/// Result of a single agentpm-cli invocation.
public struct AgentPMResult {
    public let exitCode: Int32
    /// Raw JSON string written to the output file.  Decode with JSONDecoder.
    public let outputJSON: String
    /// Stderr lines from the subprocess (informational — not errors unless exitCode != 0).
    public let stderr: String

    public var succeeded: Bool { exitCode == 0 }

    /// Decode the output JSON into a `Decodable` type.
    public func decode<T: Decodable>(_ type: T.Type) -> T? {
        guard succeeded, let data = outputJSON.data(using: .utf8) else { return nil }
        return try? JSONDecoder().decode(type, from: data)
    }
}

public actor AgentPMBridge {

    public init() {}

    // MARK: - Resolution

    private var resolvedPath: ResolvedPath?

    private enum ResolvedPath {
        /// bundled .app binary — execute directly via Process, no shell
        case bundled(URL)
        /// system command string — run via /bin/zsh -l -c
        case shell(String)
    }

    private func resolvePath() async -> ResolvedPath? {
        if let cached = resolvedPath { return cached }

        // 1. Bundled binary inside .app/Contents/Helpers/
        let bundled = Bundle.main.bundlePath + "/Contents/Helpers/agentpm-cli"
        if FileManager.default.isExecutableFile(atPath: bundled) {
            let path: ResolvedPath = .bundled(URL(fileURLWithPath: bundled))
            resolvedPath = path
            return path
        }

        // 2. System PATH — ask zsh so GUI apps get the user's full PATH
        let whichResult = await ShellRunner.run("which agentpm-cli")
        if whichResult.exitCode == 0 {
            let bin = whichResult.output.trimmingCharacters(in: .whitespacesAndNewlines)
            if !bin.isEmpty {
                let path: ResolvedPath = .shell(bin)
                resolvedPath = path
                return path
            }
        }

        // 3. Monorepo dev — locate entry.js relative to this source file
        let entryJS = URL(fileURLWithPath: #filePath)
            .deletingLastPathComponent() // swift/
            .deletingLastPathComponent() // adapters/
            .deletingLastPathComponent() // src/
            .deletingLastPathComponent() // twilio-agent-pm-shared/
            .appendingPathComponent("twilio-agent-pm-shared/dist/adapters/cli/entry.js")
            .path
        if FileManager.default.fileExists(atPath: entryJS) {
            let path: ResolvedPath = .shell("node \(entryJS)")
            resolvedPath = path
            return path
        }

        return nil
    }

    // MARK: - Public API

    public func isAvailable() async -> Bool {
        await resolvePath() != nil
    }

    /// Run a brain command and return the decoded result from disk.
    ///
    /// - Parameters:
    ///   - command: One of the CommandName values defined in protocol.ts.
    ///   - payload: JSON-serialisable dictionary matching the command's payload schema.
    ///   - outputPath: Writable path for the result file.
    ///                 Defaults to a per-invocation temp file.
    public func call(
        command: String,
        payload: [String: Any],
        outputPath: String? = nil
    ) async -> AgentPMResult {
        guard let resolved = await resolvePath() else {
            return AgentPMResult(exitCode: -1, outputJSON: "{}", stderr: "agentpm-cli not found")
        }

        let outPath = outputPath ?? NSTemporaryDirectory() + "agentpm-\(command)-\(ProcessInfo.processInfo.globallyUniqueString).json"

        let envelope: [String: Any] = [
            "command": command,
            "outputPath": outPath,
            "payload": payload,
        ]

        guard let envelopeData = try? JSONSerialization.data(withJSONObject: envelope),
              let envelopeJSON = String(data: envelopeData, encoding: .utf8) else {
            return AgentPMResult(exitCode: -1, outputJSON: "{}", stderr: "Failed to serialise envelope")
        }

        let raw: ShellRunner.CommandResult
        switch resolved {
        case .bundled(let url):
            // Direct execution — no shell, no injection risk.
            // stdin is passed via a Pipe; the binary reads it with readFileSync(process.stdin.fd).
            raw = await runDirect(executableURL: url, stdinData: envelopeData)
        case .shell(let cmd):
            // Shell invocation — echo piped into the CLI.
            // Single-quote the JSON after escaping any embedded single quotes.
            let escaped = envelopeJSON.replacingOccurrences(of: "'", with: "'\\''")
            raw = await ShellRunner.run("echo '\(escaped)' | \(cmd)")
        }

        // stdout must be exactly one StatusLine JSON.
        let statusLineStr = raw.output.trimmingCharacters(in: .whitespacesAndNewlines)
        guard raw.exitCode == 0,
              let statusData = statusLineStr.data(using: .utf8),
              let status = try? JSONSerialization.jsonObject(with: statusData) as? [String: Any],
              status["ok"] as? Bool == true else {
            return AgentPMResult(exitCode: raw.exitCode == 0 ? 1 : raw.exitCode,
                                 outputJSON: "{}",
                                 stderr: raw.error)
        }

        // Read the result payload from disk — mirrors ArtifactFileReader.readFile(at:).
        let resultJSON = (try? String(contentsOfFile: outPath, encoding: .utf8)) ?? "{}"
        return AgentPMResult(exitCode: 0, outputJSON: resultJSON, stderr: raw.error)
    }

    // MARK: - Stdin Injection (bundled binary path)

    /// Run an executable with JSON piped to its stdin.
    /// Uses a Pipe so the subprocess reads a complete UTF-8 payload without shell quoting.
    private func runDirect(executableURL: URL, stdinData: Data) async -> ShellRunner.CommandResult {
        await withCheckedContinuation { continuation in
            let process = Process()
            process.executableURL = executableURL

            let stdinPipe  = Pipe()
            let stdoutPipe = Pipe()
            let stderrPipe = Pipe()
            process.standardInput  = stdinPipe
            process.standardOutput = stdoutPipe
            process.standardError  = stderrPipe

            // Inherit a clean environment — PATH resolved by ShellRunner convention.
            var env = ProcessInfo.processInfo.environment
            env["HOME"] = FileManager.default.homeDirectoryForCurrentUser.path
            env.removeValue(forKey: "CLAUDECODE")
            process.environment = env

            process.terminationHandler = { proc in
                let stdout = String(data: stdoutPipe.fileHandleForReading.readDataToEndOfFile(), encoding: .utf8) ?? ""
                let stderr = String(data: stderrPipe.fileHandleForReading.readDataToEndOfFile(), encoding: .utf8) ?? ""
                continuation.resume(returning: ShellRunner.CommandResult(
                    exitCode: proc.terminationStatus,
                    output: stdout,
                    error: stderr
                ))
            }

            do {
                try process.run()
                stdinPipe.fileHandleForWriting.write(stdinData)
                stdinPipe.fileHandleForWriting.closeFile()
            } catch {
                continuation.resume(returning: ShellRunner.CommandResult(
                    exitCode: -1, output: "", error: error.localizedDescription
                ))
            }
        }
    }
}

// ---------------------------------------------------------------------------
// Typed convenience wrappers — one per CommandName.
// Each marshals Swift values → payload dict → AgentPMBridge.call → Decodable.
// ---------------------------------------------------------------------------

extension AgentPMBridge {

    // MARK: - titleRoles

    public struct TitleRoleResult: Decodable {
        public let role: String?
    }

    public func getTitleRole(title: String?) async -> TitleRoleResult? {
        var payload: [String: Any] = [:]
        if let t = title { payload["title"] = t }
        let result = await call(command: "getTitleRole", payload: payload)
        return result.decode(TitleRoleResult.self)
    }

    // MARK: - dueDateGroup

    public struct DueDateGroupResult: Decodable {
        public let group: String
    }

    /// - Parameter nowIso: ISO-8601 date string for clock injection (e.g. "2024-03-15").
    public func dueDateGroup(dueDate: String?, nowIso: String? = nil) async -> DueDateGroupResult? {
        var payload: [String: Any] = ["due_date": dueDate as Any]
        if let n = nowIso { payload["nowIso"] = n }
        let result = await call(command: "dueDateGroup", payload: payload)
        return result.decode(DueDateGroupResult.self)
    }

    // MARK: - getRsvp

    public struct RsvpResult: Decodable {
        public let rsvp: String?
    }

    /// - Parameter attendees: Array of `{ email, responseStatus }` dicts.
    public func getRsvp(attendees: [[String: Any]], userEmail: String?) async -> RsvpResult? {
        let payload: [String: Any] = ["attendees": attendees, "userEmail": userEmail as Any]
        let result = await call(command: "getRsvp", payload: payload)
        return result.decode(RsvpResult.self)
    }

    // MARK: - formatters

    public struct IconResult: Decodable { public let icon: String }
    public struct FormattedResult: Decodable { public let formatted: String }

    public func fileIcon(mime: String, name: String) async -> IconResult? {
        let result = await call(command: "fileIcon", payload: ["mime": mime, "name": name])
        return result.decode(IconResult.self)
    }

    public func attachLinkIcon(url: String) async -> IconResult? {
        let result = await call(command: "attachLinkIcon", payload: ["url": url])
        return result.decode(IconResult.self)
    }

    public func fmtBytes(bytes: Int?) async -> FormattedResult? {
        let result = await call(command: "fmtBytes", payload: ["bytes": bytes as Any])
        return result.decode(FormattedResult.self)
    }

    public func fmtTime(seconds: Double) async -> FormattedResult? {
        let result = await call(command: "fmtTime", payload: ["seconds": seconds])
        return result.decode(FormattedResult.self)
    }

    public func formatArr(arr: String?) async -> FormattedResult? {
        let result = await call(command: "formatArr", payload: ["arr": arr as Any])
        return result.decode(FormattedResult.self)
    }

    // MARK: - calendarEventDisplay

    public struct CalendarEventDisplayResult: Decodable {
        public let backgroundColor: String
        public let borderColor: String
        public let textColor: String
        public let editable: Bool
        public let title: String
    }

    public func calendarEventDisplay(
        calendarId: String,
        googleEventId: String,
        isSynced: Bool,
        agentpmAirtableId: String,
        status: String,
        title: String
    ) async -> CalendarEventDisplayResult? {
        let payload: [String: Any] = [
            "calendar_id": calendarId,
            "google_event_id": googleEventId,
            "is_synced": isSynced,
            "agentpm_airtable_id": agentpmAirtableId,
            "status": status,
            "title": title,
        ]
        let result = await call(command: "calendarEventDisplay", payload: payload)
        return result.decode(CalendarEventDisplayResult.self)
    }

    // MARK: - matchResourceLabel

    public struct ResourceLabelResult: Decodable { public let label: String }

    public func matchResourceLabel(url: String) async -> ResourceLabelResult? {
        let result = await call(command: "matchResourceLabel", payload: ["url": url])
        return result.decode(ResourceLabelResult.self)
    }

    // MARK: - isTokenExpired

    public struct TokenExpiredResult: Decodable { public let expired: Bool }

    /// - Parameter nowSecs: Unix epoch seconds for clock injection.
    public func isTokenExpired(token: String, nowSecs: Double? = nil) async -> TokenExpiredResult? {
        var payload: [String: Any] = ["token": token]
        if let n = nowSecs { payload["nowSecs"] = n }
        let result = await call(command: "isTokenExpired", payload: payload)
        return result.decode(TokenExpiredResult.self)
    }

    // MARK: - skillStateMachine

    public struct SkillTransitionResult: Decodable { public let to: String? }

    public func claudeSkillTransition(from: String, action: String) async -> SkillTransitionResult? {
        let result = await call(command: "claudeSkillTransition", payload: ["from": from, "action": action])
        return result.decode(SkillTransitionResult.self)
    }

    public func agentSkillTransition(from: String, action: String) async -> SkillTransitionResult? {
        let result = await call(command: "agentSkillTransition", payload: ["from": from, "action": action])
        return result.decode(SkillTransitionResult.self)
    }
}
