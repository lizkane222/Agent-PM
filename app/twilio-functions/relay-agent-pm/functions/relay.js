/**
 * TwiML for a ConversationRelay call handled by app/voice-relay-server.
 *
 * Environment variables (set on the Functions service):
 *   RELAY_WS_URL   full wss URL of the relay server, e.g. wss://relay.example.com/relay
 *   RELAY_TOKEN    shared secret; appended as ?relay_token= (must match the server's RELAY_TOKEN)
 *
 * Deepgram + Flux for transcription. TTS is left to Twilio's default.
 */
exports.handler = function (context, event, callback) {
  const twiml = new Twilio.twiml.VoiceResponse();

  if (!context.RELAY_WS_URL || !context.RELAY_TOKEN) {
    console.error("RELAY_WS_URL / RELAY_TOKEN not configured");
    twiml.say("The Agent PM voice relay is not configured.");
    twiml.hangup();
    return callback(null, twiml);
  }

  const url = `${context.RELAY_WS_URL}?relay_token=${encodeURIComponent(context.RELAY_TOKEN)}`;
  const connect = twiml.connect();
  connect.conversationRelay({
    url,
    transcriptionProvider: "Deepgram",
    speechModel: "flux",
    welcomeGreeting: "Hello, I'm Agent PM. How can I help you today?",
    interruptible: "speech",
  });

  callback(null, twiml);
};
