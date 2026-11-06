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
import VoiceButton, { VOICE_LAUNCH_EVENT } from "../VoiceButton";

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
    static options: Record<string, unknown>[] = [];
    static connectParams: Record<string, unknown>[] = [];
    static registerNeverSettles = false;
    static reset() {
      FakeDevice.lastInstance = null; FakeDevice.lastCall = null; FakeDevice.tokens = []; FakeDevice.options = [];
      FakeDevice.connectParams = [];
      FakeDevice.registerNeverSettles = false;
    }

    handlers: Record<string, Handler> = {};
    destroyed = false;

    constructor(token: string, options: Record<string, unknown> = {}) {
      FakeDevice.tokens.push(token);
      FakeDevice.options.push(options);
      FakeDevice.lastInstance = this;
    }
    on(event: string, cb: Handler) { this.handlers[event] = cb; }
    emit(event: string, ...args: unknown[]) { this.handlers[event]?.(...args); }
    register() { return FakeDevice.registerNeverSettles ? new Promise<void>(() => {}) : Promise.resolve(); }
    async connect(opts?: { params?: Record<string, unknown> }) {
      FakeDevice.connectParams.push(opts?.params ?? {});
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
  options: Record<string, unknown>[];
  connectParams: Record<string, unknown>[];
  registerNeverSettles: boolean;
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

  describe("signaling edge", () => {
    // The SDK's default edge is "roaming" -> wss://voice-js.roaming.twilio.com. Some corporate DNS
    // resolves every other edge host but returns nothing for that one, so register() never
    // settles and the button spins on "Connecting…" forever.
    async function registeredOptions() {
      render(<VoiceButton />);
      await userEvent.click(screen.getByRole("button", { name: /Start Voice Session/i }));
      await waitFor(() => expect(D.options).toHaveLength(1));
      return D.options[0];
    }

    afterEach(() => {
      vi.unstubAllEnvs();
    });

    it("pins the Device to the ashburn edge by default instead of the roaming default", async () => {
      expect((await registeredOptions()).edge).toBe("ashburn");
    });

    it("uses the edge named in VITE_TWILIO_VOICE_EDGE", async () => {
      vi.stubEnv("VITE_TWILIO_VOICE_EDGE", "umatilla");
      expect((await registeredOptions()).edge).toBe("umatilla");
    });

    it("lets the SDK's automatic selection be restored explicitly with 'roaming'", async () => {
      vi.stubEnv("VITE_TWILIO_VOICE_EDGE", "roaming");
      expect((await registeredOptions()).edge).toBe("roaming");
    });

    it("falls back to the default edge when the variable is blank", async () => {
      vi.stubEnv("VITE_TWILIO_VOICE_EDGE", "   ");
      expect((await registeredOptions()).edge).toBe("ashburn");
    });

    it("keeps the existing log level option", async () => {
      expect((await registeredOptions()).logLevel).toBe("warn");
    });
  });

  describe("registration that never settles", () => {
    // The SDK retries a failed signaling connection internally and never rejects, so without a
    // deadline a blocked network reads as an endless "Connecting…" with no explanation.
    beforeEach(() => {
      vi.useFakeTimers({ shouldAdvanceTime: true });
      D.registerNeverSettles = true;
    });
    afterEach(() => {
      vi.useRealTimers();
    });

    async function clickStart() {
      render(<VoiceButton />);
      await userEvent.click(screen.getByRole("button", { name: /Start Voice Session/i }));
      expect(await screen.findByText(/Connecting/i)).toBeInTheDocument();
    }

    it("stays on Connecting before the deadline", async () => {
      await clickStart();
      await act(async () => { await vi.advanceTimersByTimeAsync(14_000); });
      expect(screen.getByText(/Connecting/i)).toBeInTheDocument();
    });

    it("shows a readable error once the deadline passes", async () => {
      await clickStart();
      await act(async () => { await vi.advanceTimersByTimeAsync(16_000); });
      expect(await screen.findByText(/could not reach Twilio/i)).toBeInTheDocument();
      expect(screen.getByText(/network or DNS/i)).toBeInTheDocument();
      expect(screen.getByRole("button", { name: /Dismiss/i })).toBeInTheDocument();
    });

    it("destroys the stalled device so the SDK stops retrying in the background", async () => {
      await clickStart();
      const stalled = D.lastInstance as unknown as { destroyed: boolean };
      await act(async () => { await vi.advanceTimersByTimeAsync(16_000); });
      await screen.findByText(/could not reach Twilio/i);
      expect(stalled.destroyed).toBe(true);
    });

    it("builds a fresh device on the next attempt instead of reusing the stalled one", async () => {
      await clickStart();
      await act(async () => { await vi.advanceTimersByTimeAsync(16_000); });
      await screen.findByText(/could not reach Twilio/i);

      await userEvent.click(screen.getByRole("button", { name: /Dismiss/i }));
      D.registerNeverSettles = false;
      await userEvent.click(screen.getByRole("button", { name: /Start Voice Session/i }));
      await waitFor(() => expect(D.options).toHaveLength(2));
      await waitFor(() => expect(D.lastCall).toBeTruthy());
    });
  });

  it("does not time out a registration that settles promptly", async () => {
    render(<VoiceButton />);
    await userEvent.click(screen.getByRole("button", { name: /Start Voice Session/i }));
    await waitFor(() => expect(D.lastCall).toBeTruthy());
    expect(screen.queryByText(/could not reach Twilio/i)).not.toBeInTheDocument();
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

describe("VoiceButton — Use in Voice launch", () => {
  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem("agentpm_access", "jwt-abc");
    FakeSocket.instances = [];
    D.reset();
    vi.stubGlobal("WebSocket", FakeSocket);
  });
  afterEach(() => { vi.unstubAllGlobals(); });

  const launch = (detail: { key?: string; script: string; title?: string }) =>
    act(async () => { window.dispatchEvent(new CustomEvent(VOICE_LAUNCH_EVENT, { detail })); });

  it("a plain click connects with no context", async () => {
    render(<VoiceButton />);
    await userEvent.click(screen.getByRole("button", { name: /Start Voice Session/i }));
    await waitFor(() => expect(D.connectParams).toHaveLength(1));
    expect(D.connectParams[0]).toEqual({});
  });

  it("a launch event starts the call carrying only the short key as ctx", async () => {
    render(<VoiceButton />);
    await launch({ key: "abc123", script: "Workflow: weekly-update. Steps: do it", title: "weekly-update" });
    await waitFor(() => expect(D.connectParams).toHaveLength(1));
    expect(D.connectParams[0]).toEqual({ ctx: "abc123" });
    // The brief itself never rides the call.
    expect(JSON.stringify(D.connectParams[0])).not.toContain("Workflow");
  });

  it("shows the script on screen so it can be read aloud as a fallback", async () => {
    render(<VoiceButton />);
    await launch({ key: "k", script: "Workflow: weekly-update. Steps: do it", title: "weekly-update" });
    const panel = await screen.findByTestId("voice-script");
    expect(panel).toHaveTextContent("Workflow: weekly-update. Steps: do it");
    expect(panel).toHaveTextContent(/started from a skill/i);
  });

  it("with no key it presents the script as something to read, and connects without ctx", async () => {
    render(<VoiceButton />);
    await launch({ script: "Explain call recording." });
    await waitFor(() => expect(D.connectParams).toHaveLength(1));
    expect(D.connectParams[0]).toEqual({});
    expect(await screen.findByTestId("voice-script")).toHaveTextContent(/script to follow/i);
  });

  it("the key is used once: the next plain click carries no ctx", async () => {
    render(<VoiceButton />);
    await launch({ key: "once", script: "S" });
    await waitFor(() => expect(D.connectParams).toHaveLength(1));
    await act(async () => { D.lastCall!.emit("accept", D.lastCall); });
    await act(async () => { D.lastCall!.emit("disconnect"); });
    await userEvent.click(await screen.findByRole("button", { name: /Start Voice Session/i }));
    await waitFor(() => expect(D.connectParams).toHaveLength(2));
    expect(D.connectParams[1]).toEqual({});
  });

  it("ignores a launch event with no script", async () => {
    render(<VoiceButton />);
    await launch({ key: "x", script: "" });
    expect(D.connectParams).toHaveLength(0);
  });
});
