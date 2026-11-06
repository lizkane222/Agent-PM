import { test } from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import WebSocket from "ws";
import { createServer } from "../server.js";
import { Session } from "../session.js";
import { assertAnthropicModel, gatewayToken, resetTokenCache } from "../gateway.js";

/** Fake Anthropic client: streams the given chunks, optionally gated so a test can interrupt. */
function fakeClient(chunks, { gate, fail } = {}) {
  const calls = [];
  return {
    calls,
    messages: {
      stream(params, opts) {
        calls.push({ params: structuredClone(params), opts });
        return (async function* () {
          if (fail) throw new Error("boom");
          for (const c of chunks) {
            if (gate) await gate;
            if (opts.signal.aborted) throw new Error("aborted");
            yield { type: "content_block_delta", delta: { type: "text_delta", text: c } };
          }
        })();
      },
    },
  };
}

const ENV = { RELAY_TOKEN: "s3cret", MODEL: "claude-haiku-4-5" };

async function start(client) {
  const server = createServer(ENV, { getClient: async () => client });
  await new Promise((r) => server.listen(0, r));
  const port = server.address().port;
  return { server, port, close: () => new Promise((r) => server.close(r)) };
}

test("rejects a connection with a wrong or missing relay_token (401)", async () => {
  const { port, close } = await start(fakeClient(["x"]));
  for (const q of ["", "?relay_token=nope"]) {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/relay${q}`);
    const [err] = await once(ws, "error");
    assert.match(err.message, /401/);
  }
  await close();
});

test("rejects the wrong path even with a valid token", async () => {
  const { port, close } = await start(fakeClient(["x"]));
  const ws = new WebSocket(`ws://127.0.0.1:${port}/other?relay_token=s3cret`);
  const [err] = await once(ws, "error");
  assert.match(err.message, /401/);
  await close();
});

test("prompt -> streams text tokens then a last:true terminator", async () => {
  const client = fakeClient(["Hello", " there."]);
  const { port, close } = await start(client);
  const ws = new WebSocket(`ws://127.0.0.1:${port}/relay?relay_token=s3cret`);
  await once(ws, "open");
  const got = [];
  ws.on("message", (d) => got.push(JSON.parse(d.toString())));
  ws.send(JSON.stringify({ type: "setup", callSid: "CA1" }));
  ws.send(JSON.stringify({ type: "prompt", voicePrompt: "hi", lang: "en-US", last: true }));
  while (!got.some((m) => m.last === true)) await once(ws, "message");
  assert.deepEqual(got.map((m) => [m.type, m.token, m.last]), [
    ["text", "Hello", false], ["text", " there.", false], ["text", "", true],
  ]);
  assert.equal(client.calls[0].params.model, "claude-haiku-4-5");
  assert.deepEqual(client.calls[0].params.messages, [{ role: "user", content: "hi" }]);
  ws.close();
  await close();
});

test("history alternates user/assistant across turns", async () => {
  const sent = [];
  const client = fakeClient(["ok"]);
  const s = new Session({ send: (m) => sent.push(m), getClient: async () => client, model: "claude-haiku-4-5" });
  await s.handle({ type: "prompt", voicePrompt: "one", last: true });
  await s.handle({ type: "prompt", voicePrompt: "two", last: true });
  assert.deepEqual(client.calls[1].params.messages.map((m) => m.role), ["user", "assistant", "user"]);
});

test("ignores partial prompts (last:false) and blank prompts", async () => {
  const client = fakeClient(["x"]);
  const s = new Session({ send() {}, getClient: async () => client, model: "claude-haiku-4-5" });
  await s.handle({ type: "prompt", voicePrompt: "half a sent", last: false });
  await s.handle({ type: "prompt", voicePrompt: "   ", last: true });
  assert.equal(client.calls.length, 0);
});

test("interrupt aborts the in-flight stream and trims history to what was spoken", async () => {
  let release;
  const gate = new Promise((r) => (release = r));
  const client = fakeClient(["a", "b", "c"], { gate });
  const sent = [];
  const s = new Session({ send: (m) => sent.push(m), getClient: async () => client, model: "claude-haiku-4-5" });
  const turn = s.handle({ type: "prompt", voicePrompt: "tell me", last: true });
  await new Promise((r) => setTimeout(r, 10));
  await s.handle({ type: "interrupt", utteranceUntilInterrupt: "a" });
  release();
  await turn;
  assert.equal(client.calls[0].opts.signal.aborted, true);
  assert.ok(!sent.some((m) => m.last === true), "no terminator after an interrupt");
  assert.deepEqual(s.messages.at(-1), { role: "assistant", content: "a" });
});

test("interrupt after the stream finished trims the stored turn to what was heard", async () => {
  const s = new Session({ send() {}, getClient: async () => fakeClient(["one two three"]), model: "claude-haiku-4-5" });
  await s.handle({ type: "prompt", voicePrompt: "hi", last: true });
  await s.handle({ type: "interrupt", utteranceUntilInterrupt: "one two" });
  assert.deepEqual(s.messages.at(-1), { role: "assistant", content: "one two" });
});

test("a model failure speaks an apology and leaves history valid", async () => {
  const sent = [];
  const s = new Session({ send: (m) => sent.push(m), getClient: async () => fakeClient([], { fail: true }), model: "claude-haiku-4-5" });
  await s.handle({ type: "prompt", voicePrompt: "hi", last: true });
  assert.equal(sent.at(-1).last, true);
  assert.match(sent.at(-1).token, /Sorry/);
  assert.deepEqual(s.messages, []);
});

test("getClient failure (e.g. expired gateway token) is also spoken, not thrown", async () => {
  const sent = [];
  const s = new Session({ send: (m) => sent.push(m), getClient: async () => { throw new Error("token"); }, model: "claude-haiku-4-5" });
  await s.handle({ type: "prompt", voicePrompt: "hi", last: true });
  assert.match(sent.at(-1).token, /Sorry/);
});

test("refuses non-Claude and router model ids", () => {
  for (const bad of ["et-router", "claude-router", "moonshotai.kimi-k2.5", "", undefined]) {
    assert.throws(() => assertAnthropicModel(bad), /Anthropic Claude/);
  }
  assert.equal(assertAnthropicModel("claude-sonnet-4-6"), "claude-sonnet-4-6");
});

test("gateway token: static key wins; helper token is cached until near expiry", async () => {
  resetTokenCache();
  assert.equal(await gatewayToken({ GATEWAY_API_KEY: "static" }), "static");
  await assert.rejects(() => gatewayToken({ GATEWAY_TOKEN_COMMAND: "/nonexistent/helper" }), /nonexistent/);
});
