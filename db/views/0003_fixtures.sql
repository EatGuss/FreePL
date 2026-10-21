-- 0003: fixtures views over the latest capture (ADR 0002, spec 0003 "Data").
-- Applied by hand in the Neon SQL editor, as the owner, AFTER db/views/0002_current.sql.
-- Safe to re-run: create-or-replace views and an idempotent grant.
--
-- Same rules as 0002: unlisted keys are ignored, removed keys become NULL, backfill rows
-- never feed a latest_* view. Field names verified on a 2026/27 capture (2026-10-21):
-- all 380 fixtures carry team_h, team_a, both difficulties, event, kickoff_time,
-- provisional_start_time and finished. event is NULL for an unscheduled fixture.

create or replace view latest_fixtures as
select captured_at, payload
from api_snapshots
where endpoint = 'fixtures'
  and capture_reason <> 'backfill'
order by captured_at desc
limit 1;

create or replace view current_fixtures as
select f.captured_at, x.*
from latest_fixtures f,
     jsonb_to_recordset(f.payload) as x(
       id int, code bigint, event int,
       team_h int, team_a int,
       team_h_difficulty int, team_a_difficulty int,
       kickoff_time timestamptz, provisional_start_time boolean,
       started boolean, finished boolean
     );

grant select on latest_fixtures, current_fixtures to freepl_reader;
