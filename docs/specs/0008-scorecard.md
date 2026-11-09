# Spec 0008 — The scorecard

Status: **shipped** 2026-11-09 (views applied 2026-11-07): live at `?tab=scorecard`, unlisted;
checked by the owner against the FPL site · reviewed 2026-11-07 (Q95–Q102) · prerequisites checked 2026-11-07
Depends on spec 0001 (deadline and `post_gw` captures), spec 0002 (contract, `server/`, `web/`),
ADR 0002 (read model over captures), ADR 0003 (the account is `FPL_ENTRY_ID`)

## Decisions from review (2026-11-07)

- **Q95:** scorecard only; the decision log arrives with the first thing that makes decisions.
- **Q96:** MAE counts players the projection put above zero, plus anyone who scored.
- **Q97:** the Entry is judged on **gameweek** rank percentile (README), overall rank beside it
  for context only.
- **Q98:** not public until there is a full season of the model's results.
- **Q99:** each gameweek is labelled **managed by hand** or by the model; only the model's
  gameweeks count towards the README's median. The Entry is the owner's own account, managed
  by hand since before FreePL existed.
- **Q100:** until then the page is **unlisted**: no tab, but `?tab=scorecard` opens it.
- **Q101:** the Entry's percentile is exact: gameweek rank ÷ `total_players` from that
  gameweek's deadline capture, to one decimal, with FPL's `percentile_rank` band beside it.
  FPL's band rounds up to the next multiple of 5 (`docs/fpl-domain.md`), too coarse for a median.
- **Q102:** a player not in a gameweek's deadline capture (added to FPL after it) is left out of
  that gameweek's MAE and counted on the page. From the next deadline capture on he has a
  projection and is scored like everyone else.

## Goal

A public page that scores, after every settled gameweek, the two things the README pre-commits
to:

1. **Projection accuracy.** Each projection's mean absolute error (MAE) against the points
   players actually scored, per gameweek and cumulative. The first and, for now, only
   projection is FPL's own `ep_next` as captured before each deadline: the README's baseline.
   The projection model joins later and is scored the same way, beside it.
2. **The account's results.** The Entry's (`FPL_ENTRY_ID`) gameweek rank as a percentile of all
   players, per gameweek, and the median over the gameweeks **the model managed**, against the
   README's "under 40%" (Q97, Q99). Gameweeks managed by hand are shown, labelled, and left out
   of that median; until the model takes over the median reads "no model gameweeks yet".

It exists before any model so that the model has a number to beat on the day it ships, and so
that the scoring itself is checked on a baseline nobody here wrote.

## What it is not

- **Not the decision log** (Q95). Nothing here writes a decision; `ep_next` is already logged
  before each deadline, inside the deadline captures. A table of FreePL's own pre-deadline
  projections and picks belongs to the spec that first produces them.
- Not a backtest. Only gameweeks with a real deadline capture are scored: GW7 onwards in
  2026/27 (spec 0001). Earlier gameweeks have no pre-deadline capture and are shown as "no
  capture", never filled from later data.
- No pick rating, ever (spec 0005 "What it is not").

## Point-in-time rules (from `.cursor/rules/data-integrity.mdc`)

- A projection for GW n is read from **the latest `bootstrap-static` capture with
  `captured_at < deadline_time` of GW n**; never the nearest, never a later one.
- Rows with `capture_reason = 'backfill'` are excluded.
- Actual points come only from GW n's `post_gw` `event/{gw}/live` capture, which spec 0001
  stores once the gameweek is finished **and** data-checked (bonus final).
- A gameweek with either side missing is shown as missing, never estimated.

## Who counts (Q96, Q99)

- **MAE population:** for each gameweek, every player **in its deadline capture** the projection
  put above zero, plus every such player who scored any points (positive or negative); players
  added after the deadline are listed apart (Q102). A player projected 0 who scored 0 is left
  out; one projected 0 who scored is counted, so a projection is still punished for missing a
  starter. The page states the population and how many players it held.
- **Who managed the Entry:** one constant in the contract, `MODEL_MANAGES_FROM` (season and first
  gameweek), `null` today. Changing it is a commit, so the takeover gameweek has a public,
  dated record that can't be moved quietly afterwards.

## Prerequisite checks (facts, not decisions)

Checked 2026-11-07 by the owner in Neon with the queries under "How to check"; recorded in
`docs/fpl-domain.md`.

- [x] In the deadline capture for GW n, `elements[].ep_next` is the projection **for GW n**
      (`is_next` = n on every GW9 and GW10 deadline row). Doubles: unchecked until one exists.
- [x] `event/{gw}/live` `elements` is a list; `stats.total_points` equals the sum of the
      `explain` points per fixture. Bonus inclusion is asserted in the build across every
      player of a settled gameweek, not assumed from one row.
- [x] Every bootstrap player appears in the live payload, including non-players; one added
      after a deadline appears in live but not in that deadline capture (Q102).
- [x] `history.current[]` has `rank` (gameweek), `overall_rank`, `percentile_rank` (a 5-point
      band) and `overall_rank_percentage`; `bootstrap-static.total_players` is in every capture
      (Q101).

## Read model

Views only, no new writer, in the ADR 0002 pattern: `db/views/0008_scorecard.sql`, applied by
hand, readable by `freepl_reader`.

- `scorecard_projection_gw`: one row per scored gameweek: projection source (`fpl_ep_next`),
  gameweek, players scored, MAE, and the deadline capture's `captured_at` (so anyone can see it
  was before the deadline).
- `scorecard_entry_gw`: one row per settled gameweek of the Entry: points, gameweek rank,
  overall rank, total players, percentile. Who managed it comes from `MODEL_MANAGES_FROM` in the
  API, not the view.

*Applied in Neon 2026-11-07* (`db/views/0008_scorecard.sql`, tested first on a local Postgres 16
with synthetic captures). First real numbers: `ep_next` MAE 2.282 / 2.398 / 1.818 for GW7–9
over 375 / 361 / 373 players, one player added after each deadline, no missing projection, **0
explain mismatches** across all players (so `total_points` includes bonus). The Entry's GW7–9
percentiles 14.2 / 48.2 / 10.0 against FPL's bands 15 / 50 / 15. `explain analyze` on
`scorecard_projection_gw`: 71 ms for 3 gameweeks, growing per gameweek, so the API caches it
until a new `post_gw` capture lands.

This is **the first read across captures** (one deadline and one `post_gw` capture per
gameweek). ADR 0002's note currently names spec 0007 as the first; whichever ships first
amends the ADR in the same change. Views over `jsonb` are expected to be fast enough at 38
gameweeks; if they are not, that is the trigger for the flattening spec (`docs/roadmap.md`).

## API and page

- `GET /api/scorecard` in `server/`, contract-typed like every other route, cached like
  `/api/players`.
- A **Scorecard** page, **unlisted** (Q100): not in the tab bar; `?tab=scorecard` opens it.
  Going public (Q98) is listing the tab last in the tab order, after a full season of the
  model's results, by the owner's decision.
  - Headline: cumulative MAE per projection, gameweeks scored, and the Entry's median
    gameweek percentile over model-managed gameweeks against 40%.
  - Per-gameweek table: MAE and players counted, the Entry's points, gameweek and overall
    percentile, **managed by hand / by the model**, and the deadline capture's time.
  - The success criteria quoted from the README, so the page states what it is judged on.

## How to check (SELECT only, in the Neon SQL editor)

1. `ep_next` is for the gameweek of the deadline: `is_next` should equal `gameweek` on each row.

   ```sql
   select s.gameweek, s.captured_at,
     (select e->>'id' from jsonb_array_elements(s.payload->'events') e
      where (e->>'is_next')::boolean) as is_next
   from api_snapshots s
   where s.endpoint = 'bootstrap-static' and s.capture_reason = 'deadline'
   order by s.captured_at desc limit 5;
   ```

2. What one player looks like in a live capture (shape of `stats`, and whether `elements` is a
   list):

   ```sql
   select gameweek, jsonb_pretty(payload->'elements'->0)
   from api_snapshots
   where endpoint like 'event/%/live' and capture_reason = 'post_gw'
   order by captured_at desc limit 1;
   ```

3. Whether every player appears in a live capture (compare with the bootstrap count):

   ```sql
   select gameweek, jsonb_array_length(payload->'elements') as players
   from api_snapshots
   where (endpoint like 'event/%/live' and capture_reason = 'post_gw')
      or (endpoint = 'bootstrap-static' and capture_reason = 'deadline')
   order by gameweek, endpoint;
   ```

4. The Entry's gameweek row (rank field names) and the total player count:

   ```sql
   select jsonb_pretty(payload->'current'->-1)
   from api_snapshots
   where endpoint like 'entry/%/history' and capture_reason = 'post_gw'
   order by captured_at desc limit 1;

   select captured_at, payload->'total_players' as total_players
   from api_snapshots
   where endpoint = 'bootstrap-static'
   order by captured_at desc limit 1;
   ```

## As built (2026-11-09)

- Contract `packages/contract/src/scorecard.ts`: raw view rows → `ScorecardResponse`;
  `MODEL_MANAGES_FROM = null`; season named from GW1's deadline year (spec 0001's label).
  Cumulative MAE pools every counted player-gameweek over unflagged gameweeks (GW7–9:
  2.164). A flagged gameweek keeps its counts but has no MAE.
- `GET /api/scorecard`: rebuilt only when its key changes, the views' choice of deadline and
  live capture per settled gameweek plus the length of the Entry's history (`freepl_reader`
  reads only views, so the key comes from them). Future gameweeks are left out of the key:
  their latest capture moves hourly. 503 before any gameweek settles.
- Rows shown: gameweeks that settled or that the Entry's history holds, so GW10 appears once
  settled.
- Page `web/src/ScorecardTab.tsx`, opened only by `?tab=scorecard`; the GW rank percentile is
  the second column so it stays on screen at phone width.
- Checked: the real repo code against a local Postgres 16 as `freepl_reader` with the synthetic
  captures; a browser check at 390px on the owner's GW1–9 numbers (no tab, fetched only when
  opened, 2.16 MAE, "no model gameweeks yet", GW3 "no capture" with band 75, GW9 10.0% (top 15%),
  1.82 over 373 players, captured 53 min before the deadline, no writes).

## Acceptance criteria

- [x] Every scored gameweek's projection comes from a capture strictly before its deadline,
      and the page shows that capture's time.
- [x] GW1–6 show "no capture", not a score.
- [x] MAE for one gameweek matches a hand calculation on a synthetic pair of captures.
- [x] For every scored gameweek, each player's `total_points` equals the sum of his `explain`
      points (bonus included), or the gameweek is flagged, not scored.
- [x] A player missing from the deadline capture is not scored that gameweek and is counted on
      the page.
- [x] The Entry's percentile is rank ÷ the deadline capture's `total_players` (GW9: 10.0%), with
      FPL's band (15) beside it.
- [x] The Entry's percentile for one gameweek matches the FPL site. *(Owner, live page,
      2026-11-09: no Scorecard tab, 2.16, "no model gameweeks yet", figures as on FPL. GW10 not
      settled yet, so not shown.)*
- [x] Gameweeks before `MODEL_MANAGES_FROM` are labelled "managed by hand" and left out of the
      median; with it `null`, the median reads "no model gameweeks yet".
- [x] A projected-0, scored-0 player is not counted; a projected-0 player who scored is.
- [x] The page opens at `?tab=scorecard` and is in no tab bar.
- [x] No row is written anywhere; the views read only `api_snapshots`.
