import { execFile } from "node:child_process";
import Anthropic from "@anthropic-ai/sdk";

const REFRESH_MARGIN_S = 120;
let cached = null; // { token, expiresAt }

function jwtExpiry(token) {
  try {
    const payload = JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString());
    return payload.exp ? Number(payload.exp) : null;
  } catch {
    return null;
  }
}

function runHelper(command, timeoutMs) {
  return new Promise((resolve, reject) => {
    const [cmd, ...args] = command.split(/\s+/);
    execFile(cmd, args, { timeout: timeoutMs }, (err, stdout, stderr) => {
      if (err) {
        // Helper falls back to an interactive browser login when its cache is stale;
        // the timeout turns that hang into an actionable error.
        const why = err.killed ? "timed out (cached token expired? run it once in a terminal)" : (stderr || err.message).trim().slice(0, 200);
        return reject(new Error(`${command}: ${why}`));
      }
      const token = stdout.trim();
      token ? resolve(token) : reject(new Error(`${command} produced no token`));
    });
  });
}

/** A currently-valid gateway credential: static key wins, else the cached helper token. */
export async function gatewayToken(env = process.env, now = () => Date.now() / 1000) {
  if (env.GATEWAY_API_KEY) return env.GATEWAY_API_KEY;
  if (cached && now() < cached.expiresAt - REFRESH_MARGIN_S) return cached.token;
  const token = await runHelper(env.GATEWAY_TOKEN_COMMAND || "/usr/local/bin/claude-litellm-token", 20000);
  cached = { token, expiresAt: jwtExpiry(token) ?? now() + 300 };
  return token;
}

export function resetTokenCache() {
  cached = null;
}

const NOT_ANTHROPIC = /^(?!.*claude)/i;

/** Refuse any non-Claude model id: the gateway's routers pool third-party models. */
export function assertAnthropicModel(model) {
  if (!model || NOT_ANTHROPIC.test(model) || /router/i.test(model)) {
    throw new Error(`MODEL must be an Anthropic Claude model id, got "${model}"`);
  }
  return model;
}

export async function buildClient(env = process.env) {
  return new Anthropic({
    baseURL: env.GATEWAY_BASE_URL || "https://litellm.ai-services.corp.twilio.com",
    // The gateway authenticates with a bearer token, not an x-api-key header.
    authToken: await gatewayToken(env),
    apiKey: null,
  });
}
