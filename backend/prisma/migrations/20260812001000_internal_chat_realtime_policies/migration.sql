-- Realtime Authorization policies for internal chat's "thread:" topic
-- namespace, mirroring the existing "case:" policies (see
-- 20260716220000_restore_realtime_case_chat_policies) exactly, scoped by
-- thread_id instead of case_id.
DO $$
BEGIN
  IF to_regclass('realtime.messages') IS NULL THEN
    RAISE EXCEPTION 'realtime.messages is unavailable; enable Supabase Realtime before applying this migration';
  END IF;
END $$;

DROP POLICY IF EXISTS "casedesk_internal_chat_read" ON realtime.messages;
DROP POLICY IF EXISTS "casedesk_internal_chat_write" ON realtime.messages;

CREATE POLICY "casedesk_internal_chat_read"
ON realtime.messages
FOR SELECT
TO authenticated
USING (
  realtime.topic() =
    'thread:' ||
    (SELECT auth.jwt() ->> 'agency_id') ||
    ':' ||
    (SELECT auth.jwt() ->> 'thread_id')
);

CREATE POLICY "casedesk_internal_chat_write"
ON realtime.messages
FOR INSERT
TO authenticated
WITH CHECK (
  realtime.topic() =
    'thread:' ||
    (SELECT auth.jwt() ->> 'agency_id') ||
    ':' ||
    (SELECT auth.jwt() ->> 'thread_id')
);
