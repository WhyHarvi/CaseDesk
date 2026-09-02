// Amazon Polly neural voices, exposed through Twilio's <Say voice="...">.
// Picked specifically for natural, "smooth" call-greeting speech instead of
// Twilio's classic/robotic voices (alice, man, woman). Shared between the
// settings controller (which validates a saved choice and lists the
// options) and the TwiML builder (which renders the chosen voice into the
// actual greeting/voicemail <Say>).
// gender is metadata for the settings UI's browser-based preview — it picks
// a same-gender browser voice to approximate the selected Polly voice with
// (the Web Speech API has no direct equivalent to Twilio's Polly voices).
export const TTS_VOICES = [
  { id: "Polly.Joanna-Neural", label: "Joanna — warm (female, US English)", gender: "female" },
  { id: "Polly.Matthew-Neural", label: "Matthew — confident (male, US English)", gender: "male" },
  { id: "Polly.Salli-Neural", label: "Salli — friendly (female, US English)", gender: "female" },
  { id: "Polly.Joey-Neural", label: "Joey — approachable (male, US English)", gender: "male" },
  { id: "Polly.Kendra-Neural", label: "Kendra — professional (female, US English)", gender: "female" },
  { id: "Polly.Stephen-Neural", label: "Stephen — calm (male, US English)", gender: "male" },
];

export const DEFAULT_TTS_VOICE = "Polly.Joanna-Neural";

export const TTS_VOICE_IDS = new Set(TTS_VOICES.map((voice) => voice.id));

export const DEFAULT_VOICE_GREETING_TEXT =
  "Thank you for calling. Please hold while we connect you with our team.";

export const DEFAULT_VOICEMAIL_GREETING_TEXT =
  "We're unable to take your call right now. Please leave your name, number, and a brief message after the tone, and we'll get back to you.";
