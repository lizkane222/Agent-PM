/** The chat endpoint's per-message cap (`AgentMessageInputSerializer.message`). Keep in step with the backend. */
export const CHAT_MESSAGE_MAX = 10_000;
/** Show the character count once a message is this close to the cap. */
export const CHAT_COUNT_SHOW_AT = 8_000;

export function tooLongMessage(length: number): string {
  return `This message is ${length.toLocaleString("en-US")} characters; the chat takes at most ${CHAT_MESSAGE_MAX.toLocaleString("en-US")}. Shorten it, or split it into parts. Nothing was sent.`;
}

/** A readable reason for a rejected /agents/sessions/send/ request, from its status and body text. */
export function sendFailureMessage(status: number, bodyText: string): string {
  let body: { message?: unknown; detail?: unknown } = {};
  try { body = JSON.parse(bodyText) as typeof body; } catch { /* not JSON */ }
  const first = Array.isArray(body.message) ? String(body.message[0] ?? "") : "";
  if (status === 400 && /no more than \d[\d,]* characters/i.test(first)) {
    return `This message is over the chat's ${CHAT_MESSAGE_MAX.toLocaleString("en-US")}-character limit. Shorten it, or split it into parts. Nothing was sent.`;
  }
  if (typeof body.detail === "string" && body.detail) return body.detail;
  if (first) return first;
  if (status === 401) return "Your session has expired. Sign in again, then resend.";
  if (status === 429) return "Too many requests. Wait a moment, then resend.";
  return `The message was not sent (server error ${status}).`;
}
