# Spec 0005 — Pick rating

Status: draft · built after spec 0003 ships (needs `difficultyFor`) · weights set with the
spec 0002 mockup in front of us
Depends on spec 0002 (table, contract), spec 0003 (`difficultyFor`), ADR 0002 (amended)

## Goal

A **Pick rating** column in the stats table: a band — Best, Great, Good, OK — saying how a
player compares with others **in the same position** on underlying stats, fixtures and
nailedness. It answers "who is a good player to pick", not "who should replace X".

It is a browsing aid. Every stat stays visible beside it so the reader can disagree.

## What it is not

- **Not a projection.** It does not predict points and is never compared with `ep_next`.
- **Never an input to the Entry's logged decisions**, the projection model or any backtest.
- **Not fitted.** Weights are fixed by hand and written down here. Fitting weights is the
  projection model's job; doing it here would be that model built badly.
- `ep_next` and `form` are not inputs: `ep_next` is the README's baseline to beat, and the
  rating stays independent of it. Price is not an input — every price tier has good
  players, and the price filter already exists.

All reads go through one function, `pickRatingFor(player, context)`, in the contract
package, so the projection model's output can replace it later — the `difficultyFor`
pattern.

## Inputs per position

Per-90 rates are season-to-date. "Fixtures" is the next 3 gameweeks from the upcoming
gameweek via `difficultyFor`. "Nailedness" is starts ÷ gameweeks played so far.

| Position | Inputs |
| --- | --- |
| GK | xGC/90 (lower is better), saves/90, fixtures, nailedness |
| DEF | xGC/90 (lower is better), (xG + xA)/90, CBIT/90, fixtures, nailedness |
| MID | xG/90, xA/90, CBIRT/90, G+A/90 (low weight), fixtures, nailedness |
| FWD | xG/90, xA/90, G+A/90 (low weight), fixtures, nailedness |

Notes on choices made in review:

- **xG, not npxG.** FPL publishes `expected_goals` including penalties and no count of
  penalties scored, so npxG can't be derived. For FPL it is arguably better anyway:
  penalty goals score points.
- **xA** is FPL's `expected_assists` (Opta xA), standing in for FBref's xAG.
- **G+A/90 is low weight**: at 10–20 games, goals above xG are mostly finishing variance,
  and xG/xA already carry the signal. Kept, not dropped, because some finishers and
  penalty takers outperform xG for years, and FPL pays out on actual goals.
- **xGC/90** stands in for clean-sheet odds; betting odds would be a new data source.
- **CBIT / CBIRT** match the DefCon definitions in `docs/fpl-domain.md` (defenders: 10;
  midfielders and forwards: 12). Because DefCon pays per match on reaching the threshold,
  the input is the **DefCon hit rate** (share of appearances reaching it) once per-gameweek
  data is available, falling back to the per-90 average.

Field names are unconfirmed until spec 0002's live-payload diff.

## Per-gameweek data

DefCon hit rate and last-6-gameweek rates need per-match numbers. Spec 0001 already
captures `event/{gw}/live` once per settled gameweek (`post_gw`). A view
`season_gameweek_live` expands every such row for the current season — one row per player
per settled gameweek. This is the first read across captures; ADR 0002 records it.

**Prerequisite:** confirm the `event/{gw}/live` payload carries the defensive fields
(`clearances_blocks_interceptions`, `tackles`, `recoveries` or `defensive_contribution`).
If not, DefCon falls back to the season per-90 average and this view is not built.

## Method

1. **Eligible:** at least 270 minutes, and `status` not in `i`/`s`/`u`/`n`. Doubtful (`d`)
   players are rated and keep their warning badge.
2. Each input → percentile within position among eligible players ("lower is better"
   inputs inverted).
3. Weighted mean of percentiles with the fixed weights below.
4. Band by rank within position:

   | Band | Rank within position |
   | --- | --- |
   | Best | top 5% |
   | Great | 5–15% |
   | Good | 15–25% |
   | OK | 25–40% |
   | — | everyone else (no label) |

Weights: **to be set** with the mockup. Constraints already agreed: G+A/90 low; price
absent; no weight fitted to data.

Fixtures input: proposed as the sum of ease (`6 − difficulty`) over all fixtures in the
next 3 gameweeks, so a blank contributes nothing and a double contributes twice — a blank
really is zero points. Settle with the weights.

## Rendering

- One sortable column. Each band shows **a colour and its word** — never colour alone.
- Tapping a rating shows how it was reached: each input's percentile and weight, e.g.
  "xG/90 92nd · xA/90 88th · fixtures 40th · nailed 100th".
- Unrated players (under 270 minutes) show "—", with the reason on tap.

## Testing

Synthetic fixtures only: a hand-built position group where the expected band of each
player can be worked out by hand, plus edge cases (exactly 270 minutes, a blank and a double
in the fixture window, a `d` player).

## Acceptance criteria

- [ ] Bands are computed within position; a goalkeeper is never compared with a forward.
- [ ] Band sizes match the table above for each position.
- [ ] Every rating's breakdown shows each input's percentile and weight.
- [ ] Players under 270 minutes or flagged `i`/`s`/`u`/`n` have no band.
- [ ] No code outside `pickRatingFor` computes or reads band thresholds.
- [ ] Nothing in the decision log, model or backtest imports `pickRatingFor`.
