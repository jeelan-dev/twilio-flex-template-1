/**
 * Returns TwiML <Say> announcement for conference participants
 * when an agent disconnects non-gracefully.
 *
 * Called via Conference announceUrl parameter.
 */
exports.handler = function (context, event, callback) {
  const twiml = new Twilio.twiml.VoiceResponse();
  twiml.say(
    { voice: 'Polly.Amy', language: 'en-GB' },
    "We've lost connection with your agent. Please hold while we connect you back. Your call is important to us and we'll have someone with you shortly."
  );
  twiml.pause({ length: 2 });

  callback(null, twiml);
};
