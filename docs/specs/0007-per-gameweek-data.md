# Spec 0007 — Per-gameweek data

Status: draft (2026-10-31, from the spec 0005 review) · after spec 0006
Depends on spec 0001 (`post_gw` captures), spec 0005 (pick rating), ADR 0002

## Goal

One view with a row per player per settled gameweek of the current season, built from the
`post_gw` `event/{gw}/live` captures spec 0001 already stores. It feeds two spec 0005
inputs that season totals get wrong:

1. **Nailedness since joining his current Club.** Starts for that Club ÷ that Club's
   finished matches since he joined, capped at 1. Today a player who arrived from abroad
   mid-season looks rotated, and one who moved between Premier League clubs is flattered.
2. **DefCon hit rate.** Share of appearances reaching the DefCon threshold (defenders 10,
   midfielders and forwards 12; `docs/fpl-domain.md`), replacing DefCon/90. DefCon pays
   per match on reaching the threshold, so a rate of hits fits it better than an average.

It is a browsing-aid input only: spec 0005's "What it is not" applies unchanged.

## Out of scope

- Per-gameweek history in the UI (`docs/roadmap.md`).
- Flattening into typed tables, and reads per player per day (price predictor, projection
  model). Those keep their own spec.
- `element-summary/{id}` fetching (spec 0001 leaves it out).

## Prerequisite checks (facts, not decisions)

Each is checked against a stored capture before anything is built; this draft has not
verified any of them.

- The `event/{gw}/live` payload carries `starts` per player.
- It carries the defensive fields (`defensive_contribution`, or `clearances_blocks_interceptions`,
  `tackles`, `recoveries`), and whether DefCon points show in `explain` per fixture. A
  double gameweek is two matches, so the hit rate must count per fixture, not per gameweek.
- Which gameweeks have a `post_gw` live capture this season (spec 0001's backfill covers
  every settled gameweek, but check the rows).
- How a player's Club in each gameweek can be known. Candidates: `elements[].team` in the
  latest `bootstrap-static` capture before that gameweek's deadline (point-in-time, but
  only from when routine captures began), or the fixture ids in `explain`.

## Open questions

- How the gameweek a player joined his Club is fixed, given the answer to the last check.
  If captures can't show it for early gameweeks, what then?
- Whether the new numbers ride on `/api/players` or a separate route; spec 0005 computes the
  rating in the browser (Q77).
- What a player with no appearances for his new Club yet gets for nailedness.

## ADR 0002

This is the first read across captures. Building it amends ADR 0002 ("When this decision
expires") in the same change: still a view, still no second writer.

## Acceptance criteria (sketch)

- [ ] The view has one row per player per settled gameweek with a `post_gw` live capture
      in the current season.
- [ ] A player who changed Club is judged on starts and matches since joining.
- [ ] The DefCon input is the hit rate, counted per fixture, a double counting twice.
- [ ] Spec 0005's two known limits are closed and its weights table notes the change.
