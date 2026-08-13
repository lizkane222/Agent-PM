/**
 * TranscriptFooter — sticky bottom bar showing the last N transcript lines.
 *
 * - Displays the last few assistant messages from the active agent session.
 * - Includes a text input so users can send written prompts without navigating
 *   to the full /chat page.
 * - VoiceButton is embedded in the right side of the input row.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { skillsApi } from "../lib/api";
import { fmtBytes } from "twilio-agent-pm-shared";
import type { ClaudeSkill } from "../types";
import VoiceButton, { type VoiceTurn } from "./VoiceButton";

interface AttachedFile {
  name: string;
  type: string;
  size: number;
  content: string; // text content or "[binary]"
}

const TEXT_EXTENSIONS = new Set([
  "txt","md","csv","json","yaml","yml","xml","html","htm","css","js","ts",
  "tsx","jsx","py","rb","go","java","c","cpp","h","rs","sh","sql","toml","ini","env",
]);

function isTextFile(file: File): boolean {
  if (file.type.startsWith("text/")) return true;
  const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
  return TEXT_EXTENSIONS.has(ext);
}

function readFileAsText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsText(file);
  });
}

async function toAttachedFile(file: File): Promise<AttachedFile> {
  const content = isTextFile(file) ? await readFileAsText(file) : "[binary file — content not readable as text]";
  return { name: file.name, type: file.type || "application/octet-stream", size: file.size, content };
}


interface TranscriptLine {
  role: "user" | "assistant";
  content: string;
  timestamp: Date;
}


const LAST_SESSION_KEY = "agentpm_last_session_id";

function extractSkillKeywords(msg: string): string {
  // Strip filler phrases and extract the meaningful search term
  return msg
    .replace(/^(are there any|find|show|list|search for|do we have|which|what).*(skills?|tools?)\s*(that|related to|about|for|with|do|can|covering|covering)?\s*/i, "")
    .replace(/^(skills?|tools?)\s*(that|related to|about|for|with|do|can|covering)?\s*/i, "")
    .replace(/\?$/, "")
    .trim();
}

export default function TranscriptFooter() {
  const navigate = useNavigate();
  const location = useLocation();
  const isSkillsPage = location.pathname.startsWith("/skills");
  const [lines, setLines] = useState<TranscriptLine[]>([]);
  const [input, setInput] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [isExpanded, setIsExpanded] = useState(false);
  const [activeSessionId, setActiveSessionId] = useState<number | null>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const activeSessionIdRef = useRef<number | null>(null);
  const transcriptBottomRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Attached files
  const [attachments, setAttachments] = useState<AttachedFile[]>([]);
  const [isDragOver, setIsDragOver] = useState(false);

  const addAttachments = useCallback(async (files: FileList | File[]) => {
    const arr = Array.from(files).slice(0, 5); // max 5 at once
    const parsed = await Promise.all(arr.map(toAttachedFile));
    setAttachments((prev) => {
      // deduplicate by name
      const existing = new Set(prev.map((a) => a.name));
      return [...prev, ...parsed.filter((a) => !existing.has(a.name))];
    });
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    if (e.dataTransfer.files.length) {
      void addAttachments(e.dataTransfer.files);
    }
  }, [addAttachments]);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    // Only clear when leaving the footer entirely
    if (!e.currentTarget.contains(e.relatedTarget as Node)) {
      setIsDragOver(false);
    }
  }, []);

  // Slash-command autocomplete
  const [allSkills, setAllSkills] = useState<ClaudeSkill[]>([]);
  const [cmdSuggestions, setCmdSuggestions] = useState<ClaudeSkill[]>([]);
  const [cmdHighlight, setCmdHighlight] = useState(0);

  useEffect(() => {
    skillsApi.list().then(({ data }) => setAllSkills(data.results)).catch(() => {});
  }, []);

  // Recompute suggestions whenever input changes
  useEffect(() => {
    if (input.startsWith("/")) {
      const query = input.toLowerCase();
      const matches = allSkills.filter(
        s => s.command && s.command.toLowerCase().startsWith(query)
      );
      setCmdSuggestions(matches);
      setCmdHighlight(0);
    } else {
      setCmdSuggestions([]);
    }
  }, [input, allSkills]);

  const addLine = useCallback(
    (role: "user" | "assistant", content: string) => {
      setLines((prev) => [
        ...prev,
        { role, content, timestamp: new Date() },
      ]);
    },
    []
  );

  // Listen for any page injecting text into the chat input (e.g. meeting note → agent).
  useEffect(() => {
    function handleChatInject(e: Event) {
      const text = (e as CustomEvent<{ text: string }>).detail?.text;
      if (!text) return;
      setInput(text);
      setIsExpanded(true);
      setTimeout(() => inputRef.current?.focus(), 80);
    }
    window.addEventListener("chat-inject", handleChatInject);
    return () => window.removeEventListener("chat-inject", handleChatInject);
  }, []);

  // Listen for the skills page requesting the assistant open with a guided message.
  useEffect(() => {
    function handleSkillAssistantOpen() {
      setIsExpanded(true);
      setLines((prev) => {
        // Only seed the welcome if the chat is empty or the last message wasn't this same prompt.
        const welcome =
          "Hey! Let's plan your new skill together. Tell me what you'd like it to do — describe the problem it solves, what data or APIs it would need to access (Airtable, Google Calendar, Slack, etc.), and what it should return. Once we've talked through the details I'll help you write the description and generate the code.";
        const alreadySeeded = prev.length > 0 && prev[prev.length - 1].content === welcome;
        if (alreadySeeded) return prev;
        return [...prev, { role: "assistant", content: welcome, timestamp: new Date() }];
      });
      // Focus after the expand animation settles.
      setTimeout(() => inputRef.current?.focus(), 80);
    }
    window.addEventListener("skill-assistant-open", handleSkillAssistantOpen);
    return () => window.removeEventListener("skill-assistant-open", handleSkillAssistantOpen);
  }, []);

  // Scroll transcript to bottom whenever lines change while expanded.
  useEffect(() => {
    if (isExpanded) transcriptBottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [lines, isExpanded]);

  const handleSend = useCallback(async () => {
    const message = input.trim();
    if (!message && attachments.length === 0) return;
    if (isSending) return;

    // On the skills page, extract keywords and filter the sidebar — then also send to agent
    if (isSkillsPage) {
      const term = extractSkillKeywords(message);
      if (term) {
        window.dispatchEvent(new CustomEvent("skills-filter", { detail: { term } }));
      }
    }

    // Build the full message including any file context
    let fullMessage = message;
    if (attachments.length > 0) {
      const fileContext = attachments.map((a) =>
        `--- File: ${a.name} (${fmtBytes(a.size)}) ---\n${a.content}`
      ).join("\n\n");
      fullMessage = message
        ? `${message}\n\n${fileContext}`
        : fileContext;
    }

    setInput("");
    setAttachments([]);
    setIsSending(true);
    addLine("user", message || `[${attachments.map((a) => a.name).join(", ")}]`);

    try {
      // Use fetch directly for streaming SSE response.
      const token = localStorage.getItem("agentpm_access");
      const baseUrl = import.meta.env["VITE_API_BASE_URL"] ?? "/api/v1";
      const response = await fetch(`${baseUrl}/agents/sessions/send/`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          message: fullMessage,
          session_id: activeSessionIdRef.current ?? undefined,
        }),
      });

      // Read the session ID from the response header.
      const sessionId = response.headers.get("X-Session-Id");
      if (sessionId) {
        const sid = parseInt(sessionId, 10);
        activeSessionIdRef.current = sid;
        setActiveSessionId(sid);
        // Notify ChatPage to refresh its session list.
        window.dispatchEvent(new StorageEvent("storage", { key: "agentSessionUpdated", newValue: sessionId }));
      }

      const reader = response.body?.getReader();
      if (!reader) throw new Error("No response body.");

      const decoder = new TextDecoder();
      let accumulated = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        accumulated += decoder.decode(value, { stream: true });
      }

      addLine("assistant", accumulated);
    } catch (err) {
      addLine("assistant", `Error: ${err instanceof Error ? err.message : "Unknown error"}`);
    } finally {
      setIsSending(false);
    }
  }, [input, isSending, addLine, isSkillsPage]);

  const selectSuggestion = useCallback((skill: ClaudeSkill) => {
    const msg = `Run the skill "${skill.name}": ${skill.description}`;
    setInput("");
    setCmdSuggestions([]);
    // send immediately
    void (async () => {
      setIsSending(true);
      addLine("user", skill.command || skill.name);
      try {
        const token = localStorage.getItem("agentpm_access");
        const baseUrl = import.meta.env["VITE_API_BASE_URL"] ?? "/api/v1";
        const response = await fetch(`${baseUrl}/agents/sessions/send/`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
          body: JSON.stringify({
            message: msg,
            session_id: activeSessionIdRef.current ?? undefined,
          }),
        });
        const sessionId = response.headers.get("X-Session-Id");
        if (sessionId) {
          const sid = parseInt(sessionId, 10);
          activeSessionIdRef.current = sid;
          setActiveSessionId(sid);
          window.dispatchEvent(new StorageEvent("storage", { key: "agentSessionUpdated", newValue: sessionId }));
        }
        const reader = response.body?.getReader();
        if (!reader) throw new Error("No response body.");
        const decoder = new TextDecoder();
        let accumulated = "";
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          accumulated += decoder.decode(value, { stream: true });
        }
        addLine("assistant", accumulated);
        setIsExpanded(true);
      } catch (err) {
        addLine("assistant", `Error: ${err instanceof Error ? err.message : "Unknown error"}`);
      } finally {
        setIsSending(false);
      }
    })();
  }, [addLine]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (cmdSuggestions.length > 0) {
        if (e.key === "ArrowDown") {
          e.preventDefault();
          setCmdHighlight(h => Math.min(h + 1, cmdSuggestions.length - 1));
          return;
        }
        if (e.key === "ArrowUp") {
          e.preventDefault();
          setCmdHighlight(h => Math.max(h - 1, 0));
          return;
        }
        if (e.key === "Tab" || (e.key === "Enter" && !e.shiftKey)) {
          e.preventDefault();
          const s = cmdSuggestions[cmdHighlight];
          if (s) selectSuggestion(s);
          return;
        }
        if (e.key === "Escape") {
          setCmdSuggestions([]);
          return;
        }
      }
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        void handleSend();
      }
    },
    [handleSend, cmdSuggestions, cmdHighlight, selectSuggestion]
  );

  const handleVoiceTurn = useCallback(
    (turn: VoiceTurn) => {
      addLine(turn.role, turn.content);
      setIsExpanded(true);
    },
    [addLine]
  );

  const handleVoiceTranscript = useCallback(
    (_transcript: string) => {
      // Session ended — nothing extra needed; turns already appeared live.
    },
    []
  );

  return (
    <footer
      className={`sticky bottom-0 z-10 bg-white border-t shadow-lg transition-colors ${isDragOver ? "border-indigo-400 bg-indigo-50/60" : "border-gray-200"}`}
      onDrop={handleDrop}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
    >
      {/* Hidden file input */}
      <input
        ref={fileInputRef}
        type="file"
        multiple
        className="hidden"
        onChange={(e) => { if (e.target.files) { void addAttachments(e.target.files); e.target.value = ""; } }}
      />
      {/* Transcript area — only rendered when expanded */}
      {lines.length > 0 && isExpanded && (
        <div className="px-4 pt-2 pb-1 overflow-y-auto max-h-72">
          {lines.map((line, i) => (
            <div
              key={i}
              className={[
                "mb-1 flex gap-2 text-sm",
                line.role === "user" ? "text-[var(--twilio-navy)]" : "text-[var(--text-primary,#111)]",
              ].join(" ")}
            >
              <span className="shrink-0 font-medium w-20">
                {line.role === "user" ? "You" : "Agent PM"}
              </span>
              <span className="flex-1 whitespace-pre-wrap break-words">{line.content}</span>
            </div>
          ))}
          {isSending && (
            <div className="mb-1 flex gap-2 items-center">
              <span className="shrink-0 font-medium w-20 text-sm" style={{ color: "var(--twilio-red, #e22)" }}>Agent PM</span>
              <style>{`
                @keyframes tfDot {
                  0%, 80%, 100% { transform: scale(0.6); opacity: 0.4; }
                  40% { transform: scale(1); opacity: 1; }
                }
              `}</style>
              <span style={{ display: "flex", alignItems: "center", gap: "4px" }}>
                {[0, 1, 2].map((i) => (
                  <span key={i} style={{
                    display: "inline-block", width: "6px", height: "6px", borderRadius: "50%",
                    background: "var(--twilio-red, #e22)",
                    animation: `tfDot 1.2s ease-in-out ${i * 0.2}s infinite`,
                  }} />
                ))}
              </span>
            </div>
          )}
          <div ref={transcriptBottomRef} />
        </div>
      )}

      {/* Drag-over hint */}
      {isDragOver && (
        <div className="mx-4 mb-0 mt-2 flex items-center justify-center gap-2 rounded-lg border-2 border-dashed border-indigo-400 bg-indigo-50 py-3 text-sm font-medium text-indigo-600 pointer-events-none">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
          Drop files to attach
        </div>
      )}

      {/* Attachment chips */}
      {attachments.length > 0 && (
        <div className="flex flex-wrap gap-1.5 px-4 pt-2">
          {attachments.map((a) => (
            <div key={a.name} className="flex items-center gap-1.5 rounded-md bg-indigo-50 border border-indigo-200 px-2 py-1 text-xs text-indigo-700 max-w-[200px]">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
              <span className="truncate">{a.name}</span>
              <span className="text-indigo-400 shrink-0">{fmtBytes(a.size)}</span>
              <button
                onClick={() => setAttachments((prev) => prev.filter((x) => x.name !== a.name))}
                className="shrink-0 ml-0.5 text-indigo-400 hover:text-indigo-700"
                aria-label={`Remove ${a.name}`}
              >✕</button>
            </div>
          ))}
        </div>
      )}

      {/* Input row */}
      <div className="flex items-end gap-2 px-4 py-3">
        {/* Expand/collapse button — visible whenever there are any lines */}
        {lines.length > 0 && (
          <button
            onClick={() => setIsExpanded((v) => !v)}
            className="shrink-0 text-sm text-[var(--twilio-navy)] hover:text-[var(--twilio-gray-80)] mb-1"
          >
            {isExpanded ? "▼ Collapse" : `▲ Show (${lines.length})`}
          </button>
        )}

        {/* View chat — appears after the first message is sent */}
        {activeSessionId !== null && (
          <button
            onClick={() => {
              localStorage.setItem(LAST_SESSION_KEY, String(activeSessionId));
              navigate("/agent");
            }}
            className="shrink-0 rounded-md border border-gray-300 px-3 py-2 text-sm font-medium text-[var(--twilio-navy)] hover:bg-gray-50 transition-colors"
          >
            View chat →
          </button>
        )}

        <div className="flex-1 relative">
          {cmdSuggestions.length > 0 && (
            <div style={{
              position: "absolute", bottom: "calc(100% + 6px)", left: 0, right: 0,
              background: "#fff", border: "1px solid rgba(0,0,0,0.12)", borderRadius: "10px",
              boxShadow: "0 4px 16px rgba(0,0,0,0.12)", zIndex: 50, overflow: "hidden",
            }}>
              {cmdSuggestions.map((s, i) => (
                <button
                  key={s.id}
                  onMouseDown={(e) => { e.preventDefault(); selectSuggestion(s); }}
                  style={{
                    display: "flex", flexDirection: "column", width: "100%", textAlign: "left",
                    padding: "8px 12px", border: "none", cursor: "pointer",
                    background: i === cmdHighlight ? "rgba(226,35,26,0.06)" : "transparent",
                    borderLeft: i === cmdHighlight ? "3px solid var(--twilio-red, #e22)" : "3px solid transparent",
                  }}
                  onMouseEnter={() => setCmdHighlight(i)}
                >
                  <span style={{ fontSize: "0.8125rem", fontWeight: 700, fontFamily: "var(--font-mono, monospace)", color: "var(--twilio-red, #e22)" }}>
                    {s.command}
                  </span>
                  <span style={{ fontSize: "0.75rem", color: "var(--text-secondary, #888)", marginTop: "1px", lineHeight: 1.4 }}>
                    {s.name} — {s.description}
                  </span>
                </button>
              ))}
            </div>
          )}
            <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            rows={1}
            placeholder={isSkillsPage
              ? "Are there any skills that do __? Find me all skills related to Twilio SMS…"
              : "Ask Agent PM something… (Enter to send, / for skills, drag files to attach)"
            }
            disabled={isSending}
            className="w-full resize-none rounded-md border border-gray-300 px-3 py-2 text-sm placeholder-gray-400 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 disabled:bg-gray-50"
          />
        </div>

        {/* Paperclip / attach button */}
        <button
          onClick={() => fileInputRef.current?.click()}
          disabled={isSending}
          title="Attach files"
          className="shrink-0 rounded-md border border-gray-300 px-2.5 py-2 text-gray-500 hover:text-indigo-600 hover:border-indigo-400 hover:bg-indigo-50 disabled:opacity-40 transition-colors"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/>
          </svg>
        </button>

        <button
          onClick={() => void handleSend()}
          disabled={isSending || (!input.trim() && attachments.length === 0)}
          className="shrink-0 rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:bg-indigo-300 focus:outline-none focus:ring-2 focus:ring-indigo-500"
        >
          {isSending ? "…" : "Send"}
        </button>

        <VoiceButton onTurn={handleVoiceTurn} onTranscript={handleVoiceTranscript} />
      </div>
    </footer>
  );
}
