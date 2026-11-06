/**
 * One ConversationRelay call: message handling + Claude streaming.
 * Transport-free (takes a `send` function) so it can be tested without sockets.
 */
export const SYSTEM_PROMPT = [
  "You are Agent PM, a voice assistant for a program manager, speaking on a phone call.",
  "Keep replies to one to three short sentences. Plain spoken language only:",
  "no markdown, no lists, no emoji, no URLs read aloud.",
  "If you did not understand, ask a short clarifying question.",
].join(" ");

const MAX_HISTORY = 40;

export class Session {
  constructor({ send, getClient, model, maxTokens = 300 }) {
    this.send = send;
    this.getClient = getClient;
    this.model = model;
    this.maxTokens = maxTokens;
    this.messages = [];
    this.abort = null;
    this.heard = "";
    this.callSid = "";
  }

  async handle(msg) {
    switch (msg.type) {
      case "setup":
        this.callSid = msg.callSid || "";
        return;
      case "prompt":
        // partialPrompts is off, but be defensive: only act on a finished utterance.
        if (msg.last === false || !msg.voicePrompt?.trim()) return;
        return this.respond(msg.voicePrompt.trim());
      case "interrupt":
        return this.interrupt(msg.utteranceUntilInterrupt);
      case "dtmf":
        return; // no DTMF actions in this server
      case "error":
        console.error(`[${this.callSid}] relay error: ${msg.description}`);
        return;
    }
  }

  interrupt(spokenSoFar) {
    const heard = typeof spokenSoFar === "string" ? spokenSoFar : "";
    if (this.abort) {
      // Stream still running: its turn is not in history yet, so hand the aborted
      // handler what the caller actually heard to record instead of what was generated.
      this.heard = heard;
      this.abort.abort();
      this.abort = null;
      return;
    }
    // Stream already finished (text arrives faster than it is spoken): trim the turn
    // already in history so the model does not believe the caller heard all of it.
    const last = this.messages[this.messages.length - 1];
    if (last?.role === "assistant") last.content = heard || "(interrupted)";
  }

  async respond(text) {
    this.abort?.abort();
    const controller = new AbortController();
    this.abort = controller;
    this.messages.push({ role: "user", content: text });
    if (this.messages.length > MAX_HISTORY) this.messages.splice(0, this.messages.length - MAX_HISTORY);

    let reply = "";
    try {
      const client = await this.getClient();
      const stream = client.messages.stream(
        { model: this.model, max_tokens: this.maxTokens, system: SYSTEM_PROMPT, messages: this.messages },
        { signal: controller.signal },
      );
      for await (const event of stream) {
        if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
          reply += event.delta.text;
          this.send({ type: "text", token: event.delta.text, last: false });
        }
      }
      this.send({ type: "text", token: "", last: true });
      this.messages.push({ role: "assistant", content: reply || "(no reply)" });
    } catch (err) {
      if (controller.signal.aborted) {
        // Interrupted mid-stream: Twilio has already stopped speaking. Record what was
        // generated so the transcript stays alternating; interrupt() trims it further.
        this.messages.push({ role: "assistant", content: this.heard || "(interrupted)" });
        this.heard = "";
        return;
      }
      // The gateway sits behind a proxy that can answer with its own HTML error page, so
      // record who answered (status + headers) and the shape of the request, not just the body.
      const h = err.headers ?? {};
      const who = ["server", "via", "x-request-id", "x-litellm-call-id", "content-type"]
        .filter((k) => h[k] || h.get?.(k)).map((k) => `${k}=${h[k] ?? h.get(k)}`).join(" ");
      console.error(
        `[${this.callSid}] model error: status=${err.status ?? "none"} ${who} ` +
        `prompt_chars=${text.length} turns=${this.messages.length} ` +
        `body=${String(err.message).replace(/\s+/g, " ").slice(0, 160)}`,
      );
      this.messages.pop(); // drop the unanswered user turn so history stays valid
      this.send({ type: "text", token: "Sorry, I hit a problem reaching my brain. Please try again.", last: true });
    } finally {
      if (this.abort === controller) this.abort = null;
    }
  }

  close() {
    this.abort?.abort();
  }
}
