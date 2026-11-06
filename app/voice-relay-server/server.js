import http from "node:http";
import { WebSocketServer } from "ws";
import { buildClient, assertAnthropicModel } from "./gateway.js";
import { Session } from "./session.js";

export function createServer(env = process.env, deps = {}) {
  const model = assertAnthropicModel(env.MODEL || "claude-haiku-4-5");
  const getClient = deps.getClient ?? (() => buildClient(env));

  const server = http.createServer((req, res) => {
    // Health check only; the relay itself is WebSocket.
    res.writeHead(req.url === "/health" ? 200 : 404).end(req.url === "/health" ? "ok" : "");
  });
  const wss = new WebSocketServer({ noServer: true });

  server.on("upgrade", (req, socket, head) => {
    const url = new URL(req.url, "http://x");
    const provided = url.searchParams.get("relay_token") || "";
    if (url.pathname !== "/relay" || !env.RELAY_TOKEN || provided !== env.RELAY_TOKEN) {
      socket.write("HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n");
      return socket.destroy();
    }
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit("connection", ws));
  });

  wss.on("connection", (ws) => {
    const session = new Session({
      send: (m) => ws.readyState === ws.OPEN && ws.send(JSON.stringify(m)),
      getClient,
      model,
      maxTokens: Number(env.MAX_TOKENS) || 300,
    });
    // Serialise per socket so a slow turn cannot be overtaken out of order by setup/dtmf.
    ws.on("message", (raw) => {
      let msg;
      try { msg = JSON.parse(raw.toString()); } catch { return; }
      session.handle(msg).catch((e) => console.error("handler error:", e.message));
    });
    ws.on("close", () => session.close());
  });
  return server;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const port = Number(process.env.PORT) || 8765;
  createServer().listen(port, () => console.log(`voice relay listening on :${port} (ws path /relay)`));
}
