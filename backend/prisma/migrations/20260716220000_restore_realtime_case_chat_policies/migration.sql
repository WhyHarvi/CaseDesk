-- Private CaseDesk chat channels require explicit Realtime Authorization
-- policies. This migration is intentionally fail-fast: silently skipping the
-- policies leaves every private channel unable to subscribe.
DO $$
BEGIN
  IF to_regclass('realtime.messages') IS NULL THEN
    RAISE EXCEPTION 'realtime.messages is unavailable; enable Supabase Realtime before applying this migration';
  END IF;
END $$;

DROP POLICY IF EXISTS "casedesk_private_case_chat_read" ON realtime.messages;
DROP POLICY IF EXISTS "casedesk_private_case_chat_write" ON realtime.messages;

CREATE POLICY "casedesk_private_case_chat_read"
ON realtime.messages
FOR SELECT
TO authenticated
USING (
  realtime.topic() =
    'case:' ||
    (SELECT auth.jwt() ->> 'agency_id') ||
    ':' ||
    (SELECT auth.jwt() ->> 'case_id')
);

CREATE POLICY "casedesk_private_case_chat_write"
ON realtime.messages
FOR INSERT
TO authenticated
WITH CHECK (
  realtime.topic() =
    'case:' ||
    (SELECT auth.jwt() ->> 'agency_id') ||
    ':' ||
    (SELECT auth.jwt() ->> 'case_id')
);
