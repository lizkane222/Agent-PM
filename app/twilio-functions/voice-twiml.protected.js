/**
 * Twilio Function port of VoiceTwiMLView (app/backend/realtime/views.py).
 *
 * Deploy as a *protected* Function (the `.protected.js` suffix) so Twilio rejects
 * any request whose X-Twilio-Signature does not validate — the same job
 * TwilioSignatureRequiredMixin does in Django.
 *
 * Returns <Connect><ConversationRelay> pointing at the Django consumer's public
 * WebSocket, plus the signed, call-bound <Parameter name="identity_token"> that
 * realtime/voice_identity.py::read_identity_token verifies.
 *
 * Environment variables (Function service -> Environment variables):
 *   RELAY_HOST            public host of the Django/Daphne backend, e.g. agentpm.example.com
 *                         (no scheme, no path). The relay URL is wss://<RELAY_HOST>/ws/voice-relay/
 *   VOICE_RELAY_TOKEN     same value as Django's VOICE_RELAY_TOKEN (optional if unset there)
 *   IDENTITY_SIGNING_KEY  the key Django signs with (settings.SECRET_KEY today — see README)
 *   Optional, mirroring the Django VOICE_* settings: VOICE_TTS_PROVIDER, VOICE_TTS_VOICE,
 *   VOICE_STT_PROVIDER, VOICE_STT_MODEL
 */
const crypto = require("crypto");

// Must match realtime/voice_identity.py.
const IDENTITY_SALT = "realtime.voice.identity.v1";
const IDENTITY_PARAM = "identity_token";

// Must match _FIXED_HINTS in realtime/views.py. Per-user account names are NOT
// included: they come from the Django DB, which a Function cannot reach.
const FIXED_HINTS = [
  "Agent PM", "action item", "Airtable", "Salesforce", "Zendesk",
  "Jira", "Confluence", "Gong", "QBR", "ARR",
];

// Django's order (upper before lower) — the timestamp is rejected as "expired" otherwise.
const BASE62 = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";

function b62(n) {
  if (n === 0) return "0";
  let out = "";
  while (n > 0) {
    out = BASE62[n % 62] + out;
    n = Math.floor(n / 62);
  }
  return out;
}

const b64url = (buf) =>
  Buffer.from(buf).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

/**
 * Reproduces django.core.signing.dumps({"u": pk, "c": callSid}, salt=IDENTITY_SALT)
 * (TimestampSigner, sha256, compact JSON, no compression).
 */
function mintIdentityToken(userPk, callSid, secret, nowSeconds = Math.floor(Date.now() / 1000)) {
  const payload = b64url(JSON.stringify({ u: userPk, c: callSid }));
  const value = `${payload}:${b62(nowSeconds)}`;
  // salted_hmac: derived key = sha256(key_salt + secret); key_salt = salt + "signer"
  const key = crypto.createHash("sha256").update(IDENTITY_SALT + "signer" + secret).digest();
  const sig = b64url(crypto.createHmac("sha256", key).update(value).digest());
  return `${value}:${sig}`;
}

// Mirrors user_pk_from_twilio_from: only "client:<digits>" resolves.
function userPkFromFrom(from) {
  if (!from || !from.startsWith("client:")) return null;
  const raw = from.slice("client:".length).trim();
  return /^\d+$/.test(raw) ? parseInt(raw, 10) : null;
}

function relayAttrs(env) {
  const attrs = {
    welcomeGreeting: "Hello, I'm Agent PM. How can I help you today?",
    interruptible: "speech",
    interruptSensitivity: "medium",
    reportInputDuringAgentSpeech: "true",
    dtmfDetection: "true",
    welcomeGreetingInterruptible: "speech",
    preemptible: "true",
    hints: FIXED_HINTS.join(","),
  };
  if (env.VOICE_TTS_PROVIDER) attrs.ttsProvider = env.VOICE_TTS_PROVIDER;
  if (env.VOICE_TTS_VOICE) attrs.voice = env.VOICE_TTS_VOICE;
  if (env.VOICE_STT_PROVIDER) attrs.transcriptionProvider = env.VOICE_STT_PROVIDER;
  if (env.VOICE_STT_MODEL) attrs.speechModel = env.VOICE_STT_MODEL;
  return attrs;
}

exports.mintIdentityToken = mintIdentityToken;
exports.userPkFromFrom = userPkFromFrom;

exports.handler = function (context, event, callback) {
  let relayUrl = `wss://${context.RELAY_HOST}/ws/voice-relay/`;
  if (context.VOICE_RELAY_TOKEN) {
    relayUrl += `?relay_token=${encodeURIComponent(context.VOICE_RELAY_TOKEN)}`;
  }

  const callSid = event.CallSid || "";
  const userPk = userPkFromFrom(event.From || "");

  const twiml = new Twilio.twiml.VoiceResponse();
  const connect = twiml.connect();
  const relay = connect.conversationRelay({ url: relayUrl, ...relayAttrs(context) });

  if (userPk !== null && callSid && context.IDENTITY_SIGNING_KEY) {
    relay.parameter({
      name: IDENTITY_PARAM,
      value: mintIdentityToken(userPk, callSid, context.IDENTITY_SIGNING_KEY),
    });
  } else {
    // Valid TwiML regardless; the consumer ends the call with a spoken explanation.
    console.warn(`VoiceTwiML: unresolved identity for From=${event.From} callSid=${callSid}`);
  }

  callback(null, twiml);
};
