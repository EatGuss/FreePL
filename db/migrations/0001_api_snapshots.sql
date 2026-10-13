-- 0001: raw API snapshot store. Append-only: never UPDATE, DELETE or TRUNCATE.
-- Applied by hand in the Neon SQL editor (no migration runner).

create table api_snapshots (
  id             bigserial primary key,
  endpoint       text        not null,  -- path as requested, e.g. 'bootstrap-static', 'event/7/live'
  resource_id    text,                  -- entry id for entry/* endpoints; null otherwise
  gameweek       int,                   -- see spec 0001 "gameweek and deadline_time per row"
  captured_at    timestamptz not null default now(),
  capture_reason text        not null
                 check (capture_reason in ('routine','deadline','post_gw','manual','backfill')),
  deadline_time  timestamptz,           -- the deadline this capture was aimed at (deadline rows); else the next deadline at capture time
  payload        jsonb       not null
);

create index on api_snapshots (endpoint, captured_at desc);
create index on api_snapshots (gameweek) where capture_reason = 'deadline';
