/**
 * Minimal TwiML endpoint: says "Hello AGENT PM" and hangs up.
 * Standalone smoke test — separate from the real voice pipeline
 * (../voice-twiml.protected.js) and does not touch the existing TwiML App.
 */
exports.handler = function (context, event, callback) {
  const twiml = new Twilio.twiml.VoiceResponse();
  twiml.say("Hello AGENT PM");
  twiml.hangup();
  callback(null, twiml);
};
