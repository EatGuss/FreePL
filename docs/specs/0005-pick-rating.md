# Spec 0005 — Pick rating

Status: **shipped 2026-10-26** (PRs #21–#23) · decisions from review 2026-10-22 (Q70–Q78) recorded below ·
revised 2026-10-31 after a second review (ruled-out players, Unavailable, known limits)
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
gameweek via `difficultyFor`. "Nailedness" is starts ÷ the player's Club's **finished
matches** so far, capped at 1 (not gameweeks: a blank or double would skew it).

**Known limit (2026-10-31):** a player who joined his Club mid-season is judged on season
starts against his current Club's matches. One arriving from abroad looks rotated; one moving
between Premier League clubs is flattered (the cap hides it). Nailedness since joining needs
per-gameweek starts and is spec 0007's job.

| Position | Inputs |
| --- | --- |
| GKP | xGC/90 (lower is better), saves/90, fixtures, nailedness |
| DEF | xGC/90 (lower is better), (xG + xA)/90, G+A/90 (low weight), CBIT/90, fixtures, nailedness |
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
  midfielders and forwards: 12). DefCon pays per match on reaching the threshold, so the
  **DefCon hit rate** (share of appearances reaching it) would fit better; it needs
  per-gameweek data and waits for spec 0007. v1 uses the per-90 average (Q71).

Field names are verified (spec 0002, "Database"). `defensive_contribution` **is** the DefCon action count
(confirmed on a defender: CBIT = `clearances_blocks_interceptions` + `tackles`), so use it
and `defensive_contribution_per_90` directly. Confirmed on a midfielder as CBIRT (adds
`recoveries`). `penalties_order` is available too. A penalty-taker badge beside xG (rather
than trying to derive npxG) was planned but **not built**; it is in `docs/roadmap.md`.

## Per-gameweek data

**v1 decision (Q71):** v1 uses the season per-90 average (`defensive_contribution_per_90`,
which is CBIT for defenders and CBIRT for midfielders) and does **not** build
`season_gameweek_live`. The hit rate below is a later improvement, with its own prerequisite
check.

DefCon hit rate and nailedness since joining a Club need per-match numbers. Both moved to
spec 0007 (draft, 2026-10-31), which owns the per-gameweek view, its prerequisite check on
the `event/{gw}/live` payload, and the ADR 0002 amendment for the first read across
captures.

## Method

1. **Eligible:** at least 270 minutes, and `status` not in `i`/`s`/`u`/`n`. Doubtful (`d`)
   players are rated and keep their warning badge.
   **Ruled-out players (owner, 2026-10-28; revised 2026-10-31):** an Injured, Suspended or
   Not eligible (`i`/`s`/`n`) player with 270+ minutes is rated too, but placed *against*
   the eligible pool without joining it: each input's percentile is where his value would
   sit among the eligible values, sharing the average rank of any he equals, on the same
   scale as theirs (so equal numbers give an equal score). His band is the best one whose
   last member's score he matches or beats. So injured players never push fit ones down a
   band. He shows his band in My squad and Players (with his flag), never in Picks.
   **His fixtures input counts zero**: being out costs him the games in the window. FPL
   gives no return date, so he is assumed to miss all 3 gameweeks; a short ban is treated
   the same as an injury. The breakdown shows "Fixtures 0 (ruled out)".
   **Unavailable (`u`) players are not rated** (reason "Unavailable"): they may have left
   the Club or the league, so a band would mean nothing.
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

Percentiles (Q73): rank within position among eligible players, ties share the average rank,
"lower is better" inputs inverted. The score is the weighted mean of those percentiles.

Band cutoffs (Q74) round **up**: Best = the top ⌈5% × n⌉ players by score, Great up to
⌈15% × n⌉, Good up to ⌈25% × n⌉, OK up to ⌈40% × n⌉. So every position has at least one Best
(20 eligible keepers → Best 1, Great 2, Good 2, OK 3).

**Weights (Q70, set 2026-10-22)**, each position summing to 100. They live in one table in
the contract package beside `pickRatingFor`; changing one is that table plus a note here (Q78).

| Input | GKP | DEF | MID | FWD |
| --- | --- | --- | --- | --- |
| xGC/90 (lower is better) | 35 | 20 | – | – |
| Saves/90 | 15 | – | – | – |
| xG/90 | – | – | 20 | 35 |
| xA/90 | – | – | 15 | 15 |
| (xG + xA)/90 | – | 25 | – | – |
| DefCon/90 (CBIT or CBIRT) | – | 10 | 15 | – |
| G+A/90 | – | 5 | 10 | 5 |
| Fixtures, next 3 GWs | 25 | 20 | 20 | 25 |
| Nailedness | 25 | 20 | 20 | 20 |

Constraints kept: G+A/90 low; price absent; no weight fitted to data.

**Weight changes:**

- *2026-10-22, DEF:* xGC/90 25 → 20, (xG + xA)/90 20 → 25, G+A/90 added at 5, DefCon/90
  15 → 10. Reason (from first look at live ratings): wing-backs and attacking full-backs
  playing high up (e.g. De Cuyper) earn most of their points going forward, and a
  defender's goal is worth 6 against a midfielder's 5 (2026/27 scoring, `fpl-domain.md`).
  Attacking share 20 → 30; G+A kept low for the same reason as MID/FWD.
- *2026-10-22, MID (owner's call):* xG/90 25 → 20, xA/90 20 → 15, DefCon/90 10 → 15, G+A/90
  5 → 10. Reason: DefCon pays midfielders 2 points per threshold reached, so holding and
  box-to-box midfielders were under-rated; attacking share 50 → 45. G+A/90 at 10 is a
  deliberate exception to "G+A low", accepting more weight on actual returns.

**Fixtures input (settled):** the sum of ease (`6 − difficulty`) over every fixture in the
next 3 gameweeks. A blank contributes nothing and a double contributes twice: two games
are two chances to score, and a blank really is zero points. Example: two difficulty-3
games (6) beat one difficulty-1 game (5). Per-90 inputs and nailedness are unaffected by
the schedule. Rotation risk within a double gameweek is not modelled — that is projection
work.

## Rendering

Colours and component looks: `docs/design.md`.

### Picks tab

Becomes the **landing tab** when this spec ships (Q75; tab order Picks · Players · Fixtures ·
Injury watch), until spec 0004's My squad takes over
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
- Doubtful players keep their amber % badge. Ruled-out players never appear (`i`/`s`/`n`
  are rated against the pool, `u` not at all, but none can be picked for next week).
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
- Not rated players (under 270 minutes, or Unavailable) show "—", with the reason on tap.
- Rated players outside the top 40% show **Below OK** in the Players tab and the Squad
  (spec 0004), never in Picks. Not rated is never shown as Below OK.
- On Picks, players already in the Entry's Squad carry an "In squad" tag (spec 0004 data).

## v1 scope and where it runs

- **Out of v1 (Q76):** the "In squad" tag and the focused "Replacements for {player}" view;
  both need spec 0004's Squad data. Everything else ships: Picks tables, budget slider,
  rating column with Below OK on Players, the breakdown sheet. The "In squad" tag shipped
  with spec 0004 (2026-10-28), for the team My squad last showed; the Replace list in My
  squad covers the focused view.
- **Computed in the browser (Q77)** from `/api/players` and `/api/fixtures`; no new route.
  Memoised per data load, never per tap.

## Testing

Synthetic fixtures only: a hand-built position group where the expected band of each
player can be worked out by hand, plus edge cases (exactly 270 minutes, a blank and a double
in the fixture window, a `d` player).

## Acceptance criteria

Ticked 2026-10-26. Band logic, eligibility, the fixtures input and weights are covered by
`packages/contract/test/pickRating.test.ts`; the Picks tab, breakdown and Players column by a
browser check on a synthetic season; the weights by the owner on live data (DEF and MID
revised, all positions accepted 2026-10-26). `pickRatingFor` has no importers outside `web/`.

- [x] Bands are computed within position; a goalkeeper is never compared with a forward.
- [x] Band sizes match the table above for each position.
- [x] Every rating's breakdown shows each input's rank within position and its weight.
- [x] Picks is the landing tab until My squad ships: four position tables, rows coloured by band with the band
      word visible, next 3 fixtures shown with doubles stacked and blanks marked.
- [x] A player with a double gameweek in the window gets both fixtures counted in the
      fixtures input; a blank counts zero.
- [x] Players under 270 minutes have no band. Ruled-out `i`/`s`/`n` players with the
  minutes get a band without changing anyone else's (revised 2026-10-28), and never show on Picks.
- [x] A ruled-out player level with an available player on every input except fixtures
  scores the same on those inputs; his fixtures input is zero (2026-10-31).
- [x] Unavailable (`u`) players are not rated (2026-10-31).
- [x] No code outside `pickRatingFor` computes or reads band thresholds.
- [x] Nothing in the decision log, model or backtest imports `pickRatingFor`.
