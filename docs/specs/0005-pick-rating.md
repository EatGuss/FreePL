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

Field names are verified (spec 0002, "Database"). `defensive_contribution` **is** the DefCon action count
(confirmed on a defender: CBIT = `clearances_blocks_interceptions` + `tackles`), so use it
and `defensive_contribution_per_90` directly. For midfielders it should equal CBIRT (adds
`recoveries`) — spot-check one when building; if it doesn't, sum the components instead. `penalties_order` is available too:
show a penalty-taker badge beside xG rather than trying to derive npxG.

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

**Fixtures input (settled):** the sum of ease (`6 − difficulty`) over every fixture in the
next 3 gameweeks. A blank contributes nothing and a double contributes twice: two games
are two chances to score, and a blank really is zero points. Example: two difficulty-3
games (6) beat one difficulty-1 game (5). Per-90 inputs and nailedness are unaffected by
the schedule. Rotation risk within a double gameweek is not modelled — that is projection
work.

## Rendering

Colours and component looks: `docs/design.md`.

### Picks tab

Becomes the **landing tab** when this spec ships, until spec 0004's My squad takes over
(order and fallback in spec 0002 "Table").

**Focused view:** opened from My squad's attention line for a flagged player, Picks shows
only that position with the budget set to bank + that player's selling price, under a bar
"Replacements for {player}: {POS} within £x · Show all".

- **One table per position**: Goalkeepers, Defenders, Midfielders, Forwards. Rows are rated
  players (OK or better) ordered by rating score. Best, Great and Good show by default;
  "Show N OK" expands the rest.
- **A budget slider** above the tables filters all four by max price.
- **No rating or `ep_next` column.** The band colours the whole row; the band word sits on
  the player's second line ("Great · KST · £6.5m") so the band never relies on colour
  alone.
- **Columns, in order:** player cell (name, availability badge; band · club · price), the
  next 3 gameweeks' fixtures, then that position's remaining rating inputs as raw values
  (e.g. xGC/90 and saves/90 for goalkeepers). The fixtures replace a numeric fixtures
  column.
- **Fixture cells** follow spec 0003's cell model: opponent short name plus H/A, coloured
  by `difficultyFor` on a green (easy) → red (hard) scale. A double shows both opponents
  stacked; a blank shows an explicit "Blank".
- Doubtful players keep their amber % badge. `i`/`s`/`u`/`n` players are never rated, so
  never appear.
- Tapping a row opens the breakdown.

### Band colours

Row tint plus a left stripe, all at the same saturation and lightness so the ladder reads
evenly. The fixture scale (green → red) and the band scale are deliberately different hues,
so a hard fixture never reads as a bad pick.

| Band | Row |
| --- | --- |
| Best | muted steel blue tint and stripe |
| Great | teal tint and stripe |
| Good | lighter teal tint and stripe |
| OK | no tint, grey stripe |

Exact values live in the web theme tokens, light and dark.

### Players tab and breakdown

- In the Players tab the rating is one sortable column, shown as a band chip with its word.
- Tapping a rating (Players) or a row (Picks) shows how it was reached: for each input, the
  player's **rank among rated players in that position** — "1st", "2nd", "3rd"… (ties share
  a rank) — with a bar and the input's weight, plus the overall rank ("3rd of 22 rated
  MIDs").
- Unrated players (under 270 minutes) show "—", with the reason on tap.
- Rated players outside the top 40% show **Below OK** in the Players tab and the Squad
  (spec 0004), never in Picks. Not rated is never shown as Below OK.
- On Picks, players already in the Entry's Squad carry an "In squad" tag (spec 0004 data).

## Testing

Synthetic fixtures only: a hand-built position group where the expected band of each
player can be worked out by hand, plus edge cases (exactly 270 minutes, a blank and a double
in the fixture window, a `d` player).

## Acceptance criteria

- [ ] Bands are computed within position; a goalkeeper is never compared with a forward.
- [ ] Band sizes match the table above for each position.
- [ ] Every rating's breakdown shows each input's rank within position and its weight.
- [ ] Picks is the landing tab until My squad ships: four position tables, rows coloured by band with the band
      word visible, next 3 fixtures shown with doubles stacked and blanks marked.
- [ ] A player with a double gameweek in the window gets both fixtures counted in the
      fixtures input; a blank counts zero.
- [ ] Players under 270 minutes or flagged `i`/`s`/`u`/`n` have no band.
- [ ] No code outside `pickRatingFor` computes or reads band thresholds.
- [ ] Nothing in the decision log, model or backtest imports `pickRatingFor`.
