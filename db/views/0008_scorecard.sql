-- 0008: the scorecard (spec 0008), views over captures; the first read across captures (ADR 0002).
-- Applied by hand in the Neon SQL editor, as the owner, AFTER db/views/0002_current.sql.
-- Safe to re-run: create-or-replace views and an idempotent grant. Writes nothing.
--
-- Point-in-time rules (.cursor/rules/data-integrity.mdc): a gameweek's projection is read from
-- the latest bootstrap-static capture strictly before its deadline, never a later one; backfill
-- rows never count; actual points come only from that gameweek's post_gw live capture.
-- Everything is scoped to the season of the latest capture: gameweek numbers repeat each season.
-- Field meanings verified on stored captures 2026-11-07 (docs/fpl-domain.md).

-- One row per gameweek of the current season: its deadline (from the latest schedule), the
-- capture its projection is read from, the player count in that capture, and its live capture.
create or replace view scorecard_gameweeks as
with season as (
  select season from api_snapshots
  where endpoint = 'bootstrap-static' and capture_reason <> 'backfill'
  order by captured_at desc limit 1
),
events as (
  select (e ->> 'id')::int as gameweek, (e ->> 'deadline_time')::timestamptz as deadline_time
  from latest_bootstrap b, jsonb_array_elements(b.payload -> 'events') e
)
select ev.gameweek, ev.deadline_time,
       pre.id as capture_id, pre.captured_at, pre.total_players,
       live.id as live_id
from events ev
cross join season
left join lateral (
  select s.id, s.captured_at, (s.payload ->> 'total_players')::bigint as total_players
  from api_snapshots s
  where s.endpoint = 'bootstrap-static' and s.capture_reason <> 'backfill'
    and s.season = season.season and s.captured_at < ev.deadline_time
  order by s.captured_at desc limit 1
) pre on true
left join lateral (
  select s.id
  from api_snapshots s
  where s.endpoint = 'event/' || ev.gameweek || '/live' and s.capture_reason = 'post_gw'
    and s.season = season.season
  order by s.captured_at desc limit 1
) live on true;

-- One row per gameweek with both sides: FPL's ep_next scored against settled points.
-- Counted (spec 0008 Q96, Q102): players in the deadline capture with a projection, projected
-- above zero or who scored. Players added after the deadline, and players with no ep_next,
-- are counted apart, never scored. explain_mismatches > 0 means a player's total_points is not
-- the sum of his explain points: the API shows that gameweek as flagged, not scored.
create or replace view scorecard_projection_gw as
with g as (
  select * from scorecard_gameweeks where capture_id is not null and live_id is not null
),
projected as (
  select g.gameweek, (e ->> 'id')::int as id, (e ->> 'ep_next')::numeric as ep
  from g join api_snapshots s on s.id = g.capture_id,
       jsonb_array_elements(s.payload -> 'elements') e
),
actual as (
  select g.gameweek, (e ->> 'id')::int as id, (e -> 'stats' ->> 'total_points')::int as points,
         (select coalesce(sum((st ->> 'points')::int), 0)
          from jsonb_array_elements(e -> 'explain') x, jsonb_array_elements(x -> 'stats') st) as explain_points
  from g join api_snapshots s on s.id = g.live_id,
       jsonb_array_elements(s.payload -> 'elements') e
),
joined as (
  select a.gameweek, a.points, a.explain_points, p.id is not null as in_capture, p.ep
  from actual a left join projected p on p.gameweek = a.gameweek and p.id = a.id
)
select g.gameweek, 'fpl_ep_next'::text as source, g.deadline_time, g.captured_at,
       count(*) filter (where in_capture and ep is not null and (ep > 0 or points <> 0)) as players_counted,
       round(avg(abs(ep - points)) filter (where in_capture and ep is not null and (ep > 0 or points <> 0)), 3) as mae,
       count(*) filter (where not in_capture) as added_after_deadline,
       count(*) filter (where in_capture and ep is null) as no_projection,
       count(*) filter (where points <> explain_points) as explain_mismatches
from g join joined j using (gameweek)
group by g.gameweek, g.deadline_time, g.captured_at;

-- One row per gameweek in the Entry's latest settled history: its points and ranks, and the exact
-- gameweek percentile (spec 0008 Q101): rank / total_players of that gameweek's deadline capture,
-- beside FPL's own percentile_rank band. No deadline capture (GW1-6 of 2026/27): percentile NULL.
create or replace view scorecard_entry_gw as
with season as (
  select season from api_snapshots
  where endpoint = 'bootstrap-static' and capture_reason <> 'backfill'
  order by captured_at desc limit 1
),
h as (
  select s.resource_id, s.payload
  from api_snapshots s, season
  where s.endpoint like 'entry/%/history' and s.capture_reason = 'post_gw' and s.season = season.season
  order by s.captured_at desc limit 1
)
select (c ->> 'event')::int as gameweek, h.resource_id as entry_id,
       (c ->> 'points')::int as points,
       (c ->> 'rank')::bigint as gw_rank,
       (c ->> 'overall_rank')::bigint as overall_rank,
       (c ->> 'percentile_rank')::int as fpl_percentile_band,
       g.total_players,
       round(100.0 * (c ->> 'rank')::bigint / nullif(g.total_players, 0), 1) as gw_percentile
from h, jsonb_array_elements(h.payload -> 'current') c
left join scorecard_gameweeks g on g.gameweek = (c ->> 'event')::int;

grant select on scorecard_gameweeks, scorecard_projection_gw, scorecard_entry_gw to freepl_reader;
