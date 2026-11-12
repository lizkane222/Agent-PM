/**
 * VoiceButton — microphone button that manages a Twilio ConversationRelay call.
 *
 * Connects via the Twilio Voice SDK, then opens a WebSocket to receive live
 * transcript turns (user utterances + Agent PM responses) as they happen.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { Device, Call } from "@twilio/voice-sdk";
import { realtimeApi } from "../lib/api";
import { getAccessToken } from "../lib/auth";

type VoiceState = "idle" | "connecting" | "active" | "error";

// The SDK defaults to the "roaming" edge, i.e. wss://voice-js.roaming.twilio.com. Some corporate
// DNS resolves every other edge host but returns nothing for that one, so register() never
// settles and the button spins on "Connecting…" with no error. Pinning a concrete edge avoids
// it. Set VITE_TWILIO_VOICE_EDGE to another edge id (e.g. "umatilla"), or to "roaming" to get
// the SDK's automatic selection back.
const DEFAULT_VOICE_EDGE = "ashburn";

// How long to wait for the device to register before giving up. The SDK retries a failed
// signaling connection internally and never rejects, so without a deadline a blocked network
// is indistinguishable from "still connecting".
const REGISTER_TIMEOUT_MS = 15_000;

function voiceEdge(): string {
  return (import.meta.env.VITE_TWILIO_VOICE_EDGE as string | undefined)?.trim() || DEFAULT_VOICE_EDGE;
}

export interface VoiceTurn {
  role: "user" | "assistant";
  content: string;
}

interface VoiceButtonProps {
  /** Called for each live transcript turn during the session. */
  onTurn?: (turn: VoiceTurn) => void;
  /** Called when the session ends. */
  onTranscript?: (transcript: string) => void;
}

/** Dispatched by "Use in Voice": start a call that already knows what the user wants. */
export const VOICE_LAUNCH_EVENT = "voice-launch";
export interface VoiceLaunchDetail {
  /** Server-side launch context (see POST /skills/.../voice-start/); rides the call as `ctx`. */
  key?: string;
  /** Plain-language brief. Shown on screen so the user can read it if the context didn't take. */
  script: string;
  title?: string;
}

export default function VoiceButton({ onTurn, onTranscript }: VoiceButtonProps) {
  const [state, setState] = useState<VoiceState>("idle");
  const [brief, setBrief] = useState<VoiceLaunchDetail | null>(null);
  const pendingKeyRef = useRef<string | undefined>(undefined);
  const [errorMessage, setErrorMessage] = useState<string>("");
  const [duration, setDuration] = useState(0);
  const deviceRef = useRef<Device | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const wsRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      if (deviceRef.current) {
        deviceRef.current.destroy();
        deviceRef.current = null;
      }
      wsRef.current?.close();
    };
  }, []);

  const initDevice = useCallback(async (): Promise<Device> => {
    if (deviceRef.current) return deviceRef.current;

    const { data } = await realtimeApi.getSyncToken();
    const device = new Device(data.token, { logLevel: "warn", edge: voiceEdge() });

    device.on("error", (err: Error) => {
      setErrorMessage(err.message);
      setState("error");
    });

    device.on("tokenWillExpire", async () => {
      const { data: refreshed } = await realtimeApi.getSyncToken();
      device.updateToken(refreshed.token);
    });

    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        device.register(),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error("register timed out")), REGISTER_TIMEOUT_MS);
        }),
      ]);
    } catch (err) {
      // Stop the SDK retrying in the background, and never leave a half-registered device
      // behind for the next click to reuse.
      device.destroy();
      if (err instanceof Error && err.message === "register timed out") {
        throw new Error(
          "Voice could not reach Twilio. Check your network or DNS " +
            "(the call signaling host may be blocked), then try again.",
        );
      }
      throw err;
    } finally {
      clearTimeout(timer);
    }
    deviceRef.current = device;
    return device;
  }, []);

  const openTranscriptSocket = useCallback((callSid: string) => {
    const wsBase = window.location.origin.replace(/^http/, "ws");
    const token = getAccessToken();
    const qs = token ? `?token=${encodeURIComponent(token)}` : "";
    const ws = new WebSocket(`${wsBase}/ws/voice-transcript/${callSid}/${qs}`);
    wsRef.current = ws;

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        if (msg.type === "voice.turn" && onTurn) {
          onTurn({ role: msg.role, content: msg.content });
        }
      } catch {
        // ignore malformed frames
      }
    };

    ws.onerror = (err) => {
      console.warn("Voice transcript WebSocket error", err);
    };
  }, [onTurn]);

  const startCall = useCallback(async () => {
    try {
      setState("connecting");
      setDuration(0);

      const device = await initDevice();
      // Only a short key travels with the call; the server looks up what it points at.
      const key = pendingKeyRef.current;
      pendingKeyRef.current = undefined;
      const call = await device.connect({ params: key ? { ctx: key } : {} });

      call.on("accept", (acceptedCall: Call) => {
        setState("active");
        timerRef.current = setInterval(() => setDuration((d) => d + 1), 1000);

        // The call SID is available on the accepted call object.
        const sid = acceptedCall.parameters?.CallSid ?? (acceptedCall as unknown as { callSid?: string }).callSid;
        if (sid) {
          openTranscriptSocket(sid);
        }
      });

      call.on("disconnect", () => {
        setState("idle");
        if (timerRef.current) {
          clearInterval(timerRef.current);
          timerRef.current = null;
        }
        setDuration(0);
        wsRef.current?.close();
        wsRef.current = null;
        onTranscript?.("Voice session ended.");
      });

      call.on("error", (err: Error) => {
        setErrorMessage(err.message);
        setState("error");
      });
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : "Failed to start call.");
      setState("error");
    }
  }, [initDevice, openTranscriptSocket, onTranscript]);

  // "Use in Voice" from a skill: remember the launch key, show the script, and start.
  const startCallRef = useRef(startCall);
  startCallRef.current = startCall;
  useEffect(() => {
    function onLaunch(e: Event) {
      const detail = (e as CustomEvent<VoiceLaunchDetail>).detail;
      if (!detail?.script) return;
      // Tell the sender a session is handling this (see ExportBar's fallback).
      e.preventDefault();
      pendingKeyRef.current = detail.key;
      setBrief(detail);
      void startCallRef.current();
    }
    window.addEventListener(VOICE_LAUNCH_EVENT, onLaunch);
    return () => window.removeEventListener(VOICE_LAUNCH_EVENT, onLaunch);
  }, []);

  const endCall = useCallback(() => {
    deviceRef.current?.disconnectAll();
  }, []);

  const formatDuration = (secs: number) => {
    const m = Math.floor(secs / 60).toString().padStart(2, "0");
    const s = (secs % 60).toString().padStart(2, "0");
    return `${m}:${s}`;
  };

  const briefPanel = brief ? (
    <div
      data-testid="voice-script"
      className="fixed bottom-20 right-4 z-[300] w-[360px] max-w-[92vw] rounded-lg border border-indigo-200 bg-white p-3 shadow-xl"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="text-xs font-semibold text-indigo-700">
          {brief.key ? "Voice session started from a skill" : "Script to follow"}
          {brief.title ? ` — ${brief.title}` : ""}
        </div>
        <button onClick={() => setBrief(null)} aria-label="Close script" className="text-gray-400 hover:text-gray-600">×</button>
      </div>
      <p className="mt-1 text-xs text-gray-500">
        {brief.key
          ? "The agent already has this. If it doesn't act on it, read it aloud:"
          : "Read this to the agent once connected:"}
      </p>
      <p className="mt-1.5 max-h-40 overflow-y-auto whitespace-pre-wrap text-sm text-gray-800">{brief.script}</p>
      <button
        onClick={() => void navigator.clipboard?.writeText(brief.script)}
        className="mt-2 text-xs font-medium text-indigo-600 hover:underline"
      >
        Copy script
      </button>
    </div>
  ) : null;

  if (state === "error") {
    return (
      <div className="flex items-center gap-2">
        <span className="text-sm text-red-600">{errorMessage}</span>
        <button onClick={() => setState("idle")} className="text-sm text-indigo-600 hover:underline">
          Dismiss
        </button>
        {briefPanel}
      </div>
    );
  }

  if (state === "active") {
    return (
      <div className="flex items-center gap-3">
        <span className="relative flex h-3 w-3">
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75" />
          <span className="relative inline-flex rounded-full h-3 w-3 bg-red-500" />
        </span>
        <span className="text-sm font-mono text-[var(--twilio-gray-80)] tabular-nums">
          {formatDuration(duration)}
        </span>
        <button
          onClick={endCall}
          className="inline-flex items-center gap-1.5 rounded-md bg-red-600 px-3 py-1.5 text-sm font-medium text-white shadow-sm hover:bg-red-700 focus:outline-none focus:ring-2 focus:ring-red-500"
        >
          End Call
        </button>
        {briefPanel}
      </div>
    );
  }

  if (state === "connecting") {
    return (
      <>
        <button
          disabled
          className="inline-flex items-center gap-2 rounded-md bg-indigo-400 px-4 py-2 text-sm font-medium text-white cursor-not-allowed"
        >
          <span className="animate-spin h-4 w-4 border-2 border-white border-t-transparent rounded-full" />
          Connecting…
        </button>
        {briefPanel}
      </>
    );
  }

  return (
    <>
    {briefPanel}
    <button
      onClick={startCall}
      className="inline-flex items-center gap-2 rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-indigo-500"
    >
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="h-4 w-4">
        <path d="M12 2a4 4 0 0 1 4 4v6a4 4 0 0 1-8 0V6a4 4 0 0 1 4-4Z" />
        <path d="M6.25 10.083a.75.75 0 0 0-1.5 0 7.25 7.25 0 0 0 6.5 7.217V19.5h-2.5a.75.75 0 0 0 0 1.5h6.5a.75.75 0 0 0 0-1.5h-2.5v-2.2a7.25 7.25 0 0 0 6.5-7.217.75.75 0 0 0-1.5 0 5.75 5.75 0 0 1-11.5 0Z" />
      </svg>
      Start Voice Session
    </button>
    </>
  );
}
