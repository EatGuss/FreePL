# Spec 0008 — The scorecard

Status: draft (2026-11-07) · review with the owner before building
Depends on spec 0001 (deadline and `post_gw` captures), spec 0002 (contract, `server/`, `web/`),
ADR 0002 (read model over captures), ADR 0003 (the account is `FPL_ENTRY_ID`)

## Goal

A public page that scores, after every settled gameweek, the two things the README pre-commits
to:

1. **Projection accuracy.** Each projection's mean absolute error (MAE) against the points
   players actually scored, per gameweek and cumulative. The first and, for now, only
   projection is FPL's own `ep_next` as captured before each deadline: the README's baseline.
   The projection model joins later and is scored the same way, beside it.
2. **The account's results.** The Entry's (`FPL_ENTRY_ID`) gameweek rank as a percentile of all
   players, per gameweek, and its median, against the README's "under 40%".

It exists before any model so that the model has a number to beat on the day it ships, and so
that the scoring itself is checked on a baseline nobody here wrote.

## What it is not

- **Not the decision log.** Nothing here writes a decision; `ep_next` is already logged before
  each deadline, inside the deadline captures. A table of FreePL's own pre-deadline projections
  and picks belongs to the spec that first produces them (draft question Q1).
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

## Prerequisite checks (facts, not decisions)

None of these has been verified; each is checked against stored captures (a `SELECT` in Neon)
before anything is built, and `docs/fpl-domain.md` gains what they establish.

- In the deadline capture for GW n, `elements[].ep_next` is the projection **for GW n** (not
  n+1), and for a double gameweek it covers both fixtures.
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
  total players, percentile.

This is **the first read across captures** (one deadline and one `post_gw` capture per
gameweek). ADR 0002's note currently names spec 0007 as the first; whichever ships first
amends the ADR in the same change. Views over `jsonb` are expected to be fast enough at 38
gameweeks; if they are not, that is the trigger for the flattening spec (`docs/roadmap.md`).

## API and page

- `GET /api/scorecard` in `server/`, contract-typed like every other route, cached like
  `/api/players`.
- A **Scorecard** tab, last in the tab order, public like the rest of the site:
  - Headline: cumulative MAE per projection, gameweeks scored, and the Entry's median
    percentile against 40%.
  - Per-gameweek table: MAE, players scored, the Entry's points and percentile, and the
    deadline capture's time.
  - The success criteria quoted from the README, so the page states what it is judged on.

## Open questions for review

- **Q1.** Scorecard first, decision log later (this draft), or both in 0008?
- **Q2.** Which players count towards MAE: everyone in both captures (mostly zeros against
  zeros, which flatters every projection), only players who played, or only players FPL
  projected above zero? The README fixes the metric, not the population.
- **Q3.** Does the Entry's percentile use gameweek rank or overall rank? The README says
  "median gameweek rank percentile".
- **Q4.** Is the page public from day one, while it shows only the baseline?

## Acceptance criteria (sketch)

- [ ] Every scored gameweek's projection comes from a capture strictly before its deadline,
      and the page shows that capture's time.
- [ ] GW1–6 show "no capture", not a score.
- [ ] MAE for one gameweek matches a hand calculation on a synthetic pair of captures.
- [ ] The Entry's percentile for one gameweek matches the FPL site.
- [ ] No row is written anywhere; the views read only `api_snapshots`.
