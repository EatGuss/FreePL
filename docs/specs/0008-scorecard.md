# Spec 0008 — The scorecard

Status: draft (2026-11-07) · reviewed 2026-11-07 (Q95–Q100) · prerequisite checks next, then build
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

- **MAE population:** for each gameweek, every player the projection put above zero, plus every
  player who scored any points (positive or negative). A player projected 0 who scored 0 is left
  out; one projected 0 who scored is counted, so a projection is still punished for missing a
  starter. The page states the population and how many players it held.
- **Who managed the Entry:** one constant in the contract, `MODEL_MANAGES_FROM` (season and first
  gameweek), `null` today. Changing it is a commit, so the takeover gameweek has a public,
  dated record that can't be moved quietly afterwards.

## Prerequisite checks (facts, not decisions)

None of these has been verified; each is checked against stored captures (a `SELECT` in Neon)
before anything is built, and `docs/fpl-domain.md` gains what they establish. The queries are in
"How to check" below.

- In the deadline capture for GW n, `elements[].ep_next` is the projection **for GW n** (not
  n+1). Whether it covers both fixtures of a double gameweek waits for the first one.
- In `event/{gw}/live`, `elements[].stats.total_points` is the player's points for that
  gameweek, bonus included, both fixtures of a double summed.
- `entry/{id}/history.current[n]` carries the Entry's gameweek rank (field name to confirm),
  and `bootstrap-static` carries the total number of players (`total_players`?) as at that
  gameweek, so a percentile can be formed. Which capture's total is "as at" a gameweek is part
  of the check.
- A player absent from GW n's live payload (no minutes, no row?) is a 0, or is missing: confirm
  which before scoring.

## Read model

Views only, no new writer, in the ADR 0002 pattern: `db/views/0008_scorecard.sql`, applied by
hand, readable by `freepl_reader`.

- `scorecard_projection_gw`: one row per scored gameweek: projection source (`fpl_ep_next`),
  gameweek, players scored, MAE, and the deadline capture's `captured_at` (so anyone can see it
  was before the deadline).
- `scorecard_entry_gw`: one row per settled gameweek of the Entry: points, gameweek rank,
  overall rank, total players, percentile. Who managed it comes from `MODEL_MANAGES_FROM` in the
  API, not the view.

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

## Acceptance criteria (sketch)

- [ ] Every scored gameweek's projection comes from a capture strictly before its deadline,
      and the page shows that capture's time.
- [ ] GW1–6 show "no capture", not a score.
- [ ] MAE for one gameweek matches a hand calculation on a synthetic pair of captures.
- [ ] The Entry's percentile for one gameweek matches the FPL site.
- [ ] Gameweeks before `MODEL_MANAGES_FROM` are labelled "managed by hand" and left out of the
      median; with it `null`, the median reads "no model gameweeks yet".
- [ ] A projected-0, scored-0 player is not counted; a projected-0 player who scored is.
- [ ] The page opens at `?tab=scorecard` and is in no tab bar.
- [ ] No row is written anywhere; the views read only `api_snapshots`.
