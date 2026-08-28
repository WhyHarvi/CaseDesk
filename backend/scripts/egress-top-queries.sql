-- Top egress contributors, by feature
-- ------------------------------------
-- Run this in the Supabase SQL Editor (Database > SQL Editor) on the
-- WhyHarvi's Project database.
--
-- IMPORTANT CAVEAT: Postgres' pg_stat_statements (the table backing
-- Supabase's own Query Performance page) does not track HTTP routes or raw
-- network bytes per query -- Postgres only sees SQL text, not which API
-- endpoint issued it. "rows processed" is the closest available proxy for
-- how much data a query pushes back over the wire, so that's what this is
-- ranked by. Treat the numbers as directional, not exact billed bytes.
--
-- This groups CaseDesk's many near-duplicate Prisma-generated query
-- variants (e.g. three different shapes of "SELECT ... FROM notifications
-- WHERE ...") into one feature bucket per table touched, so you get one
-- ranked list of "what part of the app is generating this traffic" instead
-- of dozens of near-identical raw query rows.

with tagged as (
  select
    calls,
    rows,
    total_exec_time,
    mean_exec_time,
    query,
    case
      when query ilike '%"notifications"%'                then 'Notifications'
      when query ilike '%"notification_preferences"%'      then 'Notifications'
      when query ilike '%"notification_deliveries"%'       then 'Notifications'
      when query ilike '%"lead_follow_ups"%'                then 'Lead follow-ups'
      when query ilike '%"leads"%'                          then 'Leads'
      when query ilike '%"lead_intake%'                     then 'Lead intake'
      when query ilike '%"appointment_meeting_job%'         then 'Appointments / Zoom sync'
      when query ilike '%"appointments"%'                   then 'Appointments'
      when query ilike '%"booking_payment_holds"%'          then 'Online booking payments'
      when query ilike '%"booking_message_deliveries"%'     then 'Booking messages'
      when query ilike '%"user_mailbox_connections"%'       then 'Mailbox sync'
      when query ilike '%"agency_mail_settings"%'           then 'Mailbox sync'
      when query ilike '%"agency_members"%'                 then 'Auth / permission checks'
      when query ilike '%"users"%'                          then 'Auth / permission checks'
      when query ilike '%"case_workflow_step%'              then 'Case tasks'
      when query ilike '%"follow_ups"%'                     then 'Follow-ups'
      when query ilike '%"agency_lead_sequence%'             then 'Lead numbering'
      when query ilike '%pg_timezone_names%'                then 'Timezone lookup'
      when query ilike '%pgbouncer.get_auth%'               then 'Pooler connection auth'
      when query in ('BEGIN', 'COMMIT', 'DISCARD ALL', 'DEALLOCATE ALL')
                                                             then 'Prisma transaction/pool overhead'
      else 'Other'
    end as feature
  from extensions.pg_stat_statements
  where query not ilike '%pg_stat_statements%'  -- exclude this query itself
)
select
  feature,
  count(*)                                  as distinct_query_shapes,
  sum(calls)                                as total_calls,
  sum(rows)                                 as total_rows_returned,
  round(sum(total_exec_time)::numeric, 0)   as total_exec_time_ms,
  round(avg(mean_exec_time)::numeric, 2)    as avg_mean_time_ms
from tagged
group by feature
order by total_rows_returned desc
limit 10;

-- Want the raw, ungrouped query text instead of feature buckets? Run this:
--
-- select query, calls, rows, total_exec_time, mean_exec_time
-- from extensions.pg_stat_statements
-- where query not ilike '%pg_stat_statements%'
-- order by rows desc
-- limit 10;
--
-- Or rank by call volume instead of rows (call count drives the
-- BEGIN/COMMIT connection overhead regardless of how much data comes back):
--
-- ... order by calls desc limit 10;

-- Note: if you get "relation extensions.pg_stat_statements does not exist",
-- your project has it installed on the default search_path instead --
-- drop the "extensions." prefix and use pg_stat_statements directly.
