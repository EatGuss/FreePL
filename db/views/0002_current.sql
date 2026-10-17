-- 0002: read views over the latest capture (ADR 0002, spec 0002 "Database").
-- Applied by hand in the Neon SQL editor, AFTER db/roles/0002_reader.sql.
-- Safe to re-run: every statement is create-or-replace or an idempotent grant.
--
-- Rules: FPL numerics that arrive as strings stay text and are parsed in the contract.
-- Unlisted keys are ignored; keys FPL removes become NULL. now_cost stays int tenths.
-- Backfill rows never feed a latest_* view. FPL's "team"/"teams" appear only here;
-- everything above the views says Club.

create or replace view latest_bootstrap as
select captured_at, payload
from api_snapshots
where endpoint = 'bootstrap-static'
  and capture_reason <> 'backfill'
order by captured_at desc
limit 1;

create or replace view current_players as
select b.captured_at, e.*
from latest_bootstrap b,
     jsonb_to_recordset(b.payload -> 'elements') as e(
       id int, code bigint, web_name text, first_name text, second_name text,
       team int, element_type int, now_cost int,
       cost_change_start int, cost_change_event int,
       status text, news text, news_added text,
       chance_of_playing_this_round int, chance_of_playing_next_round int,
       total_points int, points_per_game text, form text, minutes int, starts int,
       goals_scored int, assists int, clean_sheets int, goals_conceded int,
       saves int, bonus int, bps int, yellow_cards int, red_cards int,
       expected_goals text, expected_assists text, expected_goal_involvements text,
       expected_goals_conceded text,
       expected_goals_per_90 text, expected_assists_per_90 text,
       expected_goal_involvements_per_90 text, expected_goals_conceded_per_90 text,
       goals_conceded_per_90 text, saves_per_90 text, starts_per_90 text,
       clean_sheets_per_90 text,
       clearances_blocks_interceptions int, tackles int, recoveries int,
       defensive_contribution int, defensive_contribution_per_90 text,
       penalties_order int, corners_and_indirect_freekicks_order int,
       direct_freekicks_order int,
       influence text, creativity text, threat text, ict_index text,
       ep_this text, ep_next text,
       selected_by_percent text, transfers_in_event int, transfers_out_event int,
       value_form text, value_season text
     );

create or replace view current_clubs as
select b.captured_at, t.*
from latest_bootstrap b,
     jsonb_to_recordset(b.payload -> 'teams') as t(
       id int, code int, name text, short_name text, strength int,
       strength_overall_home int, strength_overall_away int,
       strength_attack_home int, strength_attack_away int,
       strength_defence_home int, strength_defence_away int
     );

create or replace view current_gameweeks as
select b.captured_at, g.*
from latest_bootstrap b,
     jsonb_to_recordset(b.payload -> 'events') as g(
       id int, name text, deadline_time timestamptz,
       finished boolean, data_checked boolean, is_current boolean, is_next boolean
     );

create or replace view current_positions as
select b.captured_at, p.*
from latest_bootstrap b,
     jsonb_to_recordset(b.payload -> 'element_types') as p(
       id int, singular_name text, singular_name_short text,
       plural_name text, plural_name_short text,
       squad_select int, squad_min_play int, squad_max_play int
     );

grant select on latest_bootstrap, current_players, current_clubs,
                current_gameweeks, current_positions to freepl_reader;
