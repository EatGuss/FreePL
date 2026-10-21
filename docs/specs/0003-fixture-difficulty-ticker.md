# Spec 0003 — Fixture difficulty ticker

Status: **current** · spec 0002 shipped 2026-10-21; decisions from review 2026-10-21 (Q62–Q69) below
Depends on spec 0002 (contract package, API shape, table/mobile patterns)

## Goal

A grid of Clubs × the next N gameweeks. Each cell shows the opponent, home or away, and a
difficulty colour. Sortable by aggregate difficulty over the window, so "which Club has the
best run of fixtures" is answered by a single sort.

The whole feature is one API route and a grid component. Nearly all of its difficulty is
in the three cases people forget: blank gameweeks, double gameweeks and unscheduled fixtures.

## Out of scope

- Per-player fixture runs inside the stats table (integration, after both ship)
- Any difficulty source other than FPL's own ratings (see below)
- Blank/double *forecasting* — the ticker renders the published schedule, it does not
  predict postponements
- Attack/defence split tickers
- Past gameweeks and results — the grid is clipped to the future

## Data

`fixtures` and clubs from the latest captures, via views following ADR 0002:

```sql
create or replace view latest_fixtures as
select captured_at, payload
from api_snapshots
where endpoint = 'fixtures'
  and capture_reason <> 'backfill'
order by captured_at desc
limit 1;
```

Expanded with `jsonb_to_recordset` over the payload array: `id`, `event`, `team_h`,
`team_a`, `team_h_difficulty`, `team_a_difficulty`, `kickoff_time`, `finished`,
`provisional_start_time`. Granted to `freepl_reader` like the 0002 views.

## Cell model

This is the part to get right before writing any component.

```ts
type TickerFixture = {
  opponentClubId: number
  isHome: boolean
  difficulty: number        // 1–5, from this Club's perspective, via difficultyFor
  kickoffTime: string | null
  provisional: boolean
}

type TickerCell = {
  gameweek: number
  fixtures: TickerFixture[]  // length 0 = blank, 1 = normal, 2+ = double
}
```

A cell is a **list**, never a single fixture. Every blank-and-double bug in every ticker
ever built comes from a model that assumed one fixture per Club per gameweek.

Rules:

- `difficulty` comes from `difficultyFor(fixture, clubId)` — `team_h_difficulty` when the
  Club is `team_h`, else `team_a_difficulty`. Two fixtures in a cell each carry their own.
- `provisional` is true when `kickoff_time` is null **or** `provisional_start_time` is
  true. Rendered visibly differently — a ticker that silently presents a TBC fixture as
  confirmed is worse than one that omits it.
- An **unscheduled fixture** (`event: null`) is excluded from the grid and surfaced as a
  separate count: "3 fixtures not yet scheduled". It must not be dropped silently and must
  not be guessed into a column.

## Window

Starts at the **upcoming gameweek** — the one owning the first `gameweeks[].deadlineTime`
after now, computed in the browser from the response's `gameweeks` list (spec 0002).
During a gameweek in progress this is the next one: the ticker is a planning tool. Past
gameweeks are not shown.

6 gameweeks default, adjustable 3–10. Window state in the URL, as in spec 0002.

## Aggregates

Per Club, over the visible window:

- `fixtureCount` — number of fixtures, which is not N
- `difficultySum` — sum over all fixtures in the window
- `difficultyMean` — `difficultySum / fixtureCount`, null when count is 0

Sort options: mean ascending, sum ascending, count descending. **Default: mean ascending**
(easiest run first, so the tab answers "who has the best run" on open); ties by more
fixtures first, then Club name. Clubs with no fixture in the window (mean null) sort last. **No blank penalty, no
imputation.** A blank is a missing observation, not a hard fixture; inventing a number for
it makes the sort lie. Showing count alongside mean is what lets the reader weigh it.

## Difficulty source

v1 uses FPL's own `team_h_difficulty` / `team_a_difficulty`.

They are crude — integers 1–5, set pre-season, barely responsive to form. That is a known
and accepted v1 limitation, not an oversight: the point of the ticker in v1 is the grid,
and a better difficulty number is a modelling output that does not exist yet.

**Therefore:** all difficulty reads go through one function, `difficultyFor(fixture, clubId)`,
in the contract package. Spec 0005's pick rating and spec 0004's next-fixture column use it
too. Replacing FPL's ratings later must be a change to that function and the colour scale,
and nothing else.

## API

`GET /api/fixtures` → `{ meta, clubs, gameweeks, fixtures }`, normalised, whole season.

`meta.sources` carries both captures: `{ bootstrap: { capturedAt }, fixtures: { capturedAt } }`.
The `ETag` is built from both. The freshness line shows the **oldest** source against that
source's thresholds (`fixtures` routine interval is 23h: amber > 25h, red > 46h).

The grid is computed client-side. The full fixture list is ~380 rows and the grid shape
is presentational — pushing window and sort into the API would mean a round trip per
window change for no benefit.

## Rendering

- Its own **Fixtures** tab, between Players and Injury watch (tab order in spec 0002).
- Rows are Clubs, pinned left as the stats table pins player name. Next to it a narrow
  **Avg** column showing the mean with the fixture count beneath ("2.4 / 6 fx"), so the sort
  value sits beside the name on a phone; then the gameweek columns.
- Gameweek headers: "GW9" with the deadline day beneath ("Sat 25"), local time, from the
  response's `gameweeks`.
- Colours and the cell component are the existing `--fdr1`…`--fdr5` tokens and fixture cell
  in `docs/design.md`, shared with spec 0005's Picks.
- Provisional fixtures: same fill, dotted border, small "TBC" (`docs/design.md`).
- Cells are not tappable in v1; a kick-off-time sheet can come later.
- Five-band colour scale over difficulty 1–5, legible in both themes, and **not** carrying
  meaning by colour alone — the cell shows the opponent's short name and a home/away
  indicator as text.
- Double gameweek cells split, showing both opponents.
- Blank cells are explicitly marked blank, not left empty — empty reads as a render bug.
- Freshness line as above.
- Mobile: Club column pinned, gameweek columns scroll horizontally. Six columns of
  three-letter opponents fits 390px.

## Rollout

1. Confirm the 2026/27 `fixtures` field names against a real capture (read-only query).
2. `db/views/0003_fixtures.sql`: `latest_fixtures`, `current_fixtures`, `select` granted to
   `freepl_reader`. Applied by hand in the Neon SQL editor, like 0002.
3. Contract (`difficultyFor`, cell model, aggregates), `GET /api/fixtures`, the Fixtures tab.
4. Local check against real data (doubles/blanks against the official schedule), then
   deploy; one PR.

## Testing

Synthetic fixtures only (spec 0002 "Testing"): two or three invented Clubs with a
deliberate double, a deliberate blank, a provisional kickoff and an `event: null` fixture.
Checking a real double/blank against the official schedule is a local script against
`latest_fixtures`; nothing it reads is committed.

## Acceptance criteria

- [ ] A known double gameweek renders both fixtures in one cell; a known blank renders as
      blank, and both are correct against the official schedule.
- [ ] `difficultyMean` for a Club with a blank in the window divides by the real fixture
      count, and that count is visible in the row.
- [ ] Fixtures with `event: null` appear in the unscheduled count and in no column.
- [ ] Provisional fixtures are distinguishable from confirmed ones without hovering.
- [ ] Sorting by mean, sum and count each produce different, correct orderings.
- [ ] The window starts at the upcoming gameweek, adjusts 3–10 and survives refresh via the URL.
- [ ] No component references `team_h_difficulty` or `team_a_difficulty` directly.
