-- Per-agency voice greetings: what a caller hears while connecting, and
-- while being offered voicemail, plus the Amazon Polly neural voice used
-- to render both.
ALTER TABLE "agency_twilio_settings"
  ADD COLUMN "voice_greeting_text" TEXT,
  ADD COLUMN "voicemail_greeting_text" TEXT,
  ADD COLUMN "tts_voice" TEXT NOT NULL DEFAULT 'Polly.Joanna-Neural';
