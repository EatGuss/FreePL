-- 0009: the scorecard reads the decision log (spec 0009 part 1, Q112, Q113; ADR 0004).
-- Applied by hand in the Neon SQL editor, as the owner, AFTER db/migrations/0003_projections.sql
-- and db/views/0008_scorecard.sql. Safe to re-run. Replaces scorecard_projection_gw only; the
-- columns of 0008 keep their names and order, and model_version is added at the end.
--
-- Sources per gameweek: FPL's ep_next from the deadline capture, plus each (model, version)'s
-- latest run in `projections` created before the deadline. All of them are scored over ONE set
-- of players (Q113): those in the deadline capture whom any source put above zero or who scored.
-- With ep_next alone this is spec 0008's Q96 exactly, so GW7-9 keep their numbers.

create or replace view scorecard_projection_gw as
with season as (
  select season from api_snapshots
  where endpoint = 'bootstrap-static' and capture_reason <> 'backfill'
  order by captured_at desc limit 1
),
g as (
  select * from scorecard_gameweeks where capture_id is not null and live_id is not null
),
captured as (
  select g.gameweek, (e ->> 'id')::int as id, (e ->> 'ep_next')::numeric as ep
  from g join api_snapshots s on s.id = g.capture_id,
       jsonb_array_elements(s.payload -> 'elements') e
),
runs as (
  select distinct on (p.gameweek, p.model, p.model_version) p.gameweek, p.model, p.model_version, p.created_at
  from projections p join g on g.gameweek = p.gameweek cross join season
  where p.season = season.season and p.created_at < g.deadline_time
  order by p.gameweek, p.model, p.model_version, p.created_at desc
),
projected as (
  select gameweek, 'fpl_ep_next'::text as source, null::text as model_version, id, ep from captured
  union all
  select p.gameweek, p.model, p.model_version, p.element_id, p.expected_points
  from projections p
  join runs r on r.gameweek = p.gameweek and r.model = p.model
             and r.model_version = p.model_version and r.created_at = p.created_at
  cross join season
  where p.season = season.season
),
sources as (
  select distinct gameweek, source, model_version from projected
),
actual as (
  select g.gameweek, (e ->> 'id')::int as id, (e -> 'stats' ->> 'total_points')::int as points,
         (select coalesce(sum((st ->> 'points')::int), 0)
          from jsonb_array_elements(e -> 'explain') x, jsonb_array_elements(x -> 'stats') st) as explain_points
  from g join api_snapshots s on s.id = g.live_id,
       jsonb_array_elements(s.payload -> 'elements') e
),
counted as (
  select a.gameweek, a.id, a.points
  from actual a join captured c on c.gameweek = a.gameweek and c.id = a.id
  where a.points <> 0
     or exists (select 1 from projected p where p.gameweek = a.gameweek and p.id = a.id and p.ep > 0)
),
per_gw as (
  select a.gameweek,
         count(*) filter (where c.id is null) as added_after_deadline,
         count(*) filter (where a.points <> a.explain_points) as explain_mismatches,
         (select count(*) from captured c2 where c2.gameweek = a.gameweek) as in_capture
  from actual a left join captured c on c.gameweek = a.gameweek and c.id = a.id
  group by a.gameweek
)
select s.gameweek, s.source, g.deadline_time, g.captured_at,
       count(c.id) as players_counted,
       round(avg(abs(p.ep - c.points)) filter (where c.id is not null), 3) as mae,
       pg.added_after_deadline,
       pg.in_capture - count(distinct p.id) filter (where c2.id is not null) as no_projection,
       pg.explain_mismatches,
       s.model_version
from sources s
join g on g.gameweek = s.gameweek
join per_gw pg on pg.gameweek = s.gameweek
left join projected p on p.gameweek = s.gameweek and p.source = s.source
                     and p.model_version is not distinct from s.model_version and p.ep is not null
left join captured c2 on c2.gameweek = p.gameweek and c2.id = p.id
left join counted c on c.gameweek = p.gameweek and c.id = p.id
group by s.gameweek, s.source, s.model_version, g.deadline_time, g.captured_at,
         pg.added_after_deadline, pg.explain_mismatches, pg.in_capture;

grant select on scorecard_projection_gw to freepl_reader;
