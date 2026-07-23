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

export default function VoiceButton({ onTurn, onTranscript }: VoiceButtonProps) {
  const [state, setState] = useState<VoiceState>("idle");
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
    const device = new Device(data.token, { logLevel: "warn" });

    device.on("error", (err: Error) => {
      setErrorMessage(err.message);
      setState("error");
    });

    device.on("tokenWillExpire", async () => {
      const { data: refreshed } = await realtimeApi.getSyncToken();
      device.updateToken(refreshed.token);
    });

    await device.register();
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
      const call = await device.connect({ params: {} });

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

  const endCall = useCallback(() => {
    deviceRef.current?.disconnectAll();
  }, []);

  const formatDuration = (secs: number) => {
    const m = Math.floor(secs / 60).toString().padStart(2, "0");
    const s = (secs % 60).toString().padStart(2, "0");
    return `${m}:${s}`;
  };

  if (state === "error") {
    return (
      <div className="flex items-center gap-2">
        <span className="text-sm text-red-600">{errorMessage}</span>
        <button onClick={() => setState("idle")} className="text-sm text-indigo-600 hover:underline">
          Dismiss
        </button>
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
      </div>
    );
  }

  if (state === "connecting") {
    return (
      <button
        disabled
        className="inline-flex items-center gap-2 rounded-md bg-indigo-400 px-4 py-2 text-sm font-medium text-white cursor-not-allowed"
      >
        <span className="animate-spin h-4 w-4 border-2 border-white border-t-transparent rounded-full" />
        Connecting…
      </button>
    );
  }

  return (
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
  );
}
