/**
 * Tests for VoiceButton — the Twilio ConversationRelay call control.
 *
 * The Twilio Voice SDK (Device/Call) is replaced with fakes defined inside the
 * vi.mock factory (hoisted above imports, so it can't close over module-scope
 * classes). jsdom's WebSocket is read-only, so it's swapped via stubGlobal.
 * getSyncToken is served through MSW like every other API call.
 */

import { render, screen, waitFor, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { Device } from "@twilio/voice-sdk";
import VoiceButton from "../VoiceButton";

// --- fake @twilio/voice-sdk ------------------------------------------------
vi.mock("@twilio/voice-sdk", () => {
  type Handler = (...args: unknown[]) => void;

  class FakeCall {
    handlers: Record<string, Handler> = {};
    parameters: Record<string, string> = { CallSid: CALL_SID };
    on(event: string, cb: Handler) { this.handlers[event] = cb; }
    emit(event: string, ...args: unknown[]) { this.handlers[event]?.(...args); }
  }

  class FakeDevice {
    static lastInstance: FakeDevice | null = null;
    static lastCall: FakeCall | null = null;
    static tokens: string[] = [];
    static reset() { FakeDevice.lastInstance = null; FakeDevice.lastCall = null; FakeDevice.tokens = []; }

    handlers: Record<string, Handler> = {};
    destroyed = false;

    constructor(token: string) {
      FakeDevice.tokens.push(token);
      FakeDevice.lastInstance = this;
    }
    on(event: string, cb: Handler) { this.handlers[event] = cb; }
    emit(event: string, ...args: unknown[]) { this.handlers[event]?.(...args); }
    async register() {}
    async connect() {
      const call = new FakeCall();
      FakeDevice.lastCall = call;
      return call;
    }
    destroy() { this.destroyed = true; }
    disconnectAll() { FakeDevice.lastCall?.emit("disconnect"); }
  }

  return { Device: FakeDevice, Call: FakeCall };
});

const CALL_SID = "CA" + "9".repeat(32);

// --- fake WebSocket --------------------------------------------------------
class FakeSocket {
  static instances: FakeSocket[] = [];
  url: string;
  readyState = 1;
  closed = false;
  onopen: (() => void) | null = null;
  onmessage: ((e: MessageEvent) => void) | null = null;
  onerror: ((e: unknown) => void) | null = null;
  onclose: (() => void) | null = null;
  constructor(url: string) {
    this.url = url;
    FakeSocket.instances.push(this);
  }
  send() {}
  close() { this.closed = true; }
}

// Convenience accessors onto the mocked Device statics.
const D = Device as unknown as {
  lastInstance: { emit: (e: string, ...a: unknown[]) => void } | null;
  lastCall: { emit: (e: string, ...a: unknown[]) => void } | null;
  tokens: string[];
  reset: () => void;
};

async function startAndAccept() {
  await userEvent.click(screen.getByRole("button", { name: /Start Voice Session/i }));
  // Wait until Device.connect() has resolved and the accept handler is wired.
  await waitFor(() => expect(D.lastCall).toBeTruthy());
  await act(async () => {
    D.lastCall!.emit("accept", D.lastCall);
  });
}

describe("VoiceButton", () => {
  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem("agentpm_access", "jwt-abc");
    FakeSocket.instances = [];
    D.reset();
    vi.stubGlobal("WebSocket", FakeSocket);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("renders the idle Start button", () => {
    render(<VoiceButton />);
    expect(screen.getByRole("button", { name: /Start Voice Session/i })).toBeInTheDocument();
  });

  it("registers the Device with the fetched sync token on click", async () => {
    render(<VoiceButton />);
    await userEvent.click(screen.getByRole("button", { name: /Start Voice Session/i }));
    // Connecting spinner is shown while the device registers.
    expect(await screen.findByText(/Connecting/i)).toBeInTheDocument();
    await waitFor(() => expect(D.tokens).toContain("fake-access-token"));
  });

  it("goes active and opens the transcript socket on accept", async () => {
    render(<VoiceButton />);
    await startAndAccept();

    expect(await screen.findByRole("button", { name: /End Call/i })).toBeInTheDocument();
    expect(screen.getByText("00:00")).toBeInTheDocument();

    expect(FakeSocket.instances).toHaveLength(1);
    const expectedBase = window.location.origin.replace(/^http/, "ws");
    expect(FakeSocket.instances[0].url).toBe(
      `${expectedBase}/ws/voice-transcript/${CALL_SID}/?token=jwt-abc`
    );
  });

  it("forwards voice.turn frames to onTurn", async () => {
    const onTurn = vi.fn();
    render(<VoiceButton onTurn={onTurn} />);
    await startAndAccept();

    const ws = FakeSocket.instances[0];
    act(() => {
      ws.onmessage?.({
        data: JSON.stringify({ type: "voice.turn", role: "user", content: "hello" }),
      } as MessageEvent);
    });

    expect(onTurn).toHaveBeenCalledWith({ role: "user", content: "hello" });
  });

  it("ignores malformed transcript frames", async () => {
    const onTurn = vi.fn();
    render(<VoiceButton onTurn={onTurn} />);
    await startAndAccept();

    const ws = FakeSocket.instances[0];
    act(() => {
      ws.onmessage?.({ data: "{ not json" } as MessageEvent);
      ws.onmessage?.({ data: JSON.stringify({ type: "something-else" }) } as MessageEvent);
    });

    expect(onTurn).not.toHaveBeenCalled();
  });

  it("returns to idle, closes the socket and reports the transcript on disconnect", async () => {
    const onTranscript = vi.fn();
    render(<VoiceButton onTranscript={onTranscript} />);
    await startAndAccept();

    const ws = FakeSocket.instances[0];
    await userEvent.click(screen.getByRole("button", { name: /End Call/i }));

    await waitFor(() =>
      expect(screen.getByRole("button", { name: /Start Voice Session/i })).toBeInTheDocument()
    );
    expect(ws.closed).toBe(true);
    expect(onTranscript).toHaveBeenCalledWith("Voice session ended.");
  });

  it("shows an error state with Dismiss when the Device errors", async () => {
    render(<VoiceButton />);
    await userEvent.click(screen.getByRole("button", { name: /Start Voice Session/i }));
    await waitFor(() => expect(D.lastInstance).toBeTruthy());

    await act(async () => {
      D.lastInstance!.emit("error", new Error("Device registration failed"));
    });

    expect(await screen.findByText("Device registration failed")).toBeInTheDocument();
    const dismiss = screen.getByRole("button", { name: /Dismiss/i });
    await userEvent.click(dismiss);
    expect(screen.getByRole("button", { name: /Start Voice Session/i })).toBeInTheDocument();
  });
});
