# Spec 0002 — Player stats table

Status: **current** — spec 0001 done 2026-10-17 · Decisions in ADR 0002

## Goal

The thin vertical slice: Postgres → Node/TS API → React, deployed, genuinely usable on a
phone, with nothing clever in the middle so every bug is a plumbing bug you can locate.

The feature is a dense, sortable table of every player in the game, answering one question
fastest: **"who are good players to pick at this position and price?"** It ships with an
`ep_next` column, which quietly establishes the projection baseline before a line of
modelling code exists. Next to it, an **injury watch** tab lists every flagged player.

This spec also stands up the directory layout, the shared contract and the deployment that
specs 0003–0005 bolt onto. Conventions set here are binding on those.

## Out of scope

- Any flattened/typed player table (ADR 0002)
- Any FPL API call from `server/` (ADR 0003 — entry endpoints only, and not in this spec)
- The pick rating (spec 0005). The table design leaves room for its column; it is not built here.
- Player detail pages, player comparison, per-player fixture runs, charts
- Per-gameweek breakdowns, price history, past seasons (`docs/roadmap.md`)
- Saved filters, user preferences, accounts
- `model/`, Python, anything on Fly.io

## Files

```
pnpm-workspace.yaml, package.json, .nvmrc   pnpm workspaces, Node 22 LTS
packages/contract/         zod schemas + inferred TS types; the single column list
server/                    Hono app, platform-agnostic
api/[[...route]].ts        the only file in api/: mounts server/ as one Vercel Node function
web/                       Vite + React + Tailwind + shadcn + TanStack Table + TanStack Query
db/views/0002_current.sql  hand-applied in the Neon SQL editor, like the migrations
db/roles/0002_reader.sql   hand-applied; creates freepl_reader (no password in the file)
.github/workflows/ci.yml   on pull_request: install, typecheck, test, build
```

**Why `server/` and not `api/`:** Vercel turns every file under a top-level `api/` into a
separate function. The Hono app lives in `server/`; `api/` holds one adapter file. Moving to
Fly.io later means deleting `api/`.

Hosting: **Vercel Hobby**, one project serving `web/` and mounting the API at `/api`.
On serverless the in-process cache is best effort; `ETag`/`304` and the edge cache carry
the real weight.

Dependencies (approved): hono, zod, postgres (postgres.js), vite, react, tailwind, shadcn
(Radix), @tanstack/react-table, @tanstack/react-query, typescript, vitest. Anything else:
ask.

## Environment (Vercel)

| Variable | Purpose |
| --- | --- |
| `DATABASE_URL` | Neon **pooled** connection string for the `freepl_reader` role — not the snapshot job's |

Never prefix a server variable with `VITE_` — Vite inlines those into the browser bundle.

## Database

Hand-applied, two files.

**`db/roles/0002_reader.sql`** — role `freepl_reader`, `LOGIN`, `SELECT` on the views
below and nothing else. Views run with their owner's privileges, so the role needs no grant
on `api_snapshots`. Set the password in the Neon console, never in the file.

**`db/views/0002_current.sql`** — pick the newest row, expand it.

```sql
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
       status text, news text, news_added text,
       chance_of_playing_this_round int, chance_of_playing_next_round int,
       total_points int, points_per_game text, form text, minutes int, starts int,
       goals_scored int, assists int, clean_sheets int, goals_conceded int,
       saves int, bonus int, bps int, yellow_cards int, red_cards int,
       expected_goals text, expected_assists text, expected_goal_involvements text,
       expected_goals_conceded text,
       influence text, creativity text, threat text, ict_index text,
       ep_this text, ep_next text,
       selected_by_percent text, transfers_in_event int, transfers_out_event int,
       value_form text, value_season text
     );
```

`current_clubs` (`payload -> 'teams'`), `current_gameweeks` (`payload -> 'events'`: `id`,
`deadline_time`, `finished`, `data_checked`) and `current_positions`
(`payload -> 'element_types'`: `id`, `singular_name_short`, `plural_name_short`) follow the
same shape. The FPL names `team` and `teams` appear only in these column lists; everything
above the views says **Club**.

Rules, all from ADR 0002:

- Every FPL numeric that arrives as a string stays `text` here and is parsed in the contract.
  Do not "fix" these to `numeric` — a mid-season representation change then takes the whole
  view down.
- An unlisted key is ignored; a key FPL removes becomes `NULL`. Both are survivable.
- `now_cost` is `int` in tenths and stays an integer the whole way to the render call.
- Backfill rows never feed a `latest_*` view.

**Verified against a live 2026/27 `elements[]` object (2026-10-16)** — add to the column list:

- Per-90, as **JSON numbers** (not strings, unlike `expected_goals`): `expected_goals_per_90`,
  `expected_assists_per_90`, `expected_goal_involvements_per_90`,
  `expected_goals_conceded_per_90`, `goals_conceded_per_90`, `saves_per_90`,
  `starts_per_90`, `clean_sheets_per_90`, `defensive_contribution_per_90`. Declare them
  `text` in the view anyway (a JSON number reads fine as text) and parse with `fplDecimal`,
  so a later switch to strings — or back — changes nothing.
- Defensive counts, integers: `clearances_blocks_interceptions`, `tackles`, `recoveries`,
  `defensive_contribution` (labelled "Defensive Contribution" in `element_stats`). A
  goalkeeper shows 0 despite 79 such actions — expected, since DefCon is outfield-only.
  **Confirmed on a defender: it is the action count** — `clearances_blocks_interceptions` +
  `tackles` (25 + 8 = 33; recoveries not included). Confirmed on midfielders and a forward too:
  it adds `recoveries` (e.g. 4 + 25 + 6 = 35), i.e. CBIRT. Checked on seven players across
  all four positions.
- `cost_change_start` (tenths since launch; launch price = `now_cost − cost_change_start`),
  `cost_change_event`, and `_fall` mirrors of both.
- Set pieces: `penalties_order`, `corners_and_indirect_freekicks_order`,
  `direct_freekicks_order` (nullable ints) — useful for a "penalty taker" badge.
- New this season, not used in v1: `price_change_percent`, `price_change_hourly_rate`,
  `price_change_projections[]`, `price_change_locked_until`, `price_change_calibrating`
  (see `docs/roadmap.md`); also `can_transact`, `can_select`, `removed`, `scout_risks`.

Still to confirm before finalising: `element_types[]` (four positions or a fifth), and a
defender's `defensive_contribution`.

## Contract

`packages/contract` owns the column list once, and both sides import it. It holds no
outbound HTTP client — it ships to the browser.

```ts
PlayerRow      // camelCase, numerics parsed, nowCost still int tenths, clubId, positionId
ClubRow
PositionRow    // { id, short, plural } from element_types — never hardcoded
GameweekRow    // { id, deadlineTime, finished, dataChecked }
MetaBlock      // { sources: { bootstrap: { capturedAt } } }  — specs 0003/0004 add keys
PlayersResponse = {
  meta: MetaBlock; clubs: ClubRow[]; positions: PositionRow[];
  gameweeks: GameweekRow[]; players: PlayerRow[]
}
```

- **No `z.coerce`.** It turns `null` and `""` into `0`, so a field FPL removes would show
  every player at 0.0 with no error. String numerics go through one helper, `fplDecimal`:
  nullable string matching `^-?\d+(\.\d+)?$` → number. `null` stays `null`; anything else
  fails loudly in the API log. Parsed once per cache miss, never per request.
- **Positions** come from `element_types`. The contract maps by id at parse time; an
  `element_type` with no matching position fails loudly.
- **Upcoming gameweek** and its deadline are computed in the browser: the first
  `gameweeks[].deadlineTime` after now. Not stored in `MetaBlock`, which is cached.
- **Data age** is computed in the browser: `Date.now() − Date.parse(capturedAt)`. Two
  instants subtracted; no timezone handling. Not stored in the cached body.
- **Freshness thresholds** are constants derived from spec 0001's routine interval for
  each source: amber above interval + 2h, red above 2 × interval. For `bootstrap-static`
  (11h): amber > 13h, red > 22h. Pulling spec 0001's storage lever changes one constant.
- **Availability** mapping lives here, keyed on the `status` table in `docs/fpl-domain.md`:

  | `status` | Default table | Badge |
  | --- | --- | --- |
  | `a` | shown | none |
  | `d` | shown | amber warning with `chance_of_playing_next_round` % |
  | `i`, `s`, `u`, `n` | hidden; "show unavailable" reveals | red, with the fpl-domain label |

## API

| Route | Returns |
| --- | --- |
| `GET /api/players` | `PlayersResponse` |
| `GET /api/health` | `{ ok, latestSnapshotAt, dataAgeHours }` — never cached |

One route for the table. ~700 players over the v1 columns is roughly 250–350 KB raw and
well under 100 KB gzipped; a second round trip costs more than the bytes save.

Caching, per ADR 0002:

1. `select captured_at from latest_bootstrap` — the same view that serves the data, so
   key and body cannot drift apart.
2. If it matches the in-process cache key, serve the memoised serialised body.
3. `ETag` is that timestamp. Matching `If-None-Match` → `304`.
4. `Cache-Control: public, max-age=60, stale-while-revalidate=600`.

Errors return a generic message. Connection strings, SQL and stack traces go to the log only.

No pagination, no server-side sorting, no server-side filtering. Sorting and filtering are
client concerns; keeping them there is what makes the table feel instant.

## Table

**Designed fresh, not ported**, from a 390px mockup with synthetic data. Visual language
(colours, type, components): `docs/design.md`; clickable reference:
`docs/design/mockup.html`. Final tab order, left to right:

| Tab | What | Ships in |
| --- | --- | --- |
| **My squad** | The Entry's Squad, pitch and list views, what-if | spec 0004 — the landing tab from then on |
| **Picks** | One table per position of rated players, rows coloured by band, next 3 fixtures | spec 0005 |
| **Players** | The full sortable table below | this spec |
| **Injury watch** | Every flagged player, newest news first | this spec |

**Landing tab** follows the build order: Players (this spec) → Picks (when spec 0005
ships) → My squad (when spec 0004 ships). If spec 0004's rollout finds FPL blocks requests
from Vercel, Picks stays the landing tab. This spec builds the tab bar with Players and
Injury watch.

**Players tab:**

- **Landing view:** position and max price are the most prominent controls; default sort
  `ep_next` descending. Ownership and transfer counts are available but not in the default
  view — popularity is not the question.
- **All stats stay visible.** The pick rating (spec 0005) will be one sortable column among
  them, never a replacement. Leave room for it.
- **One pinned cell**, not four pinned columns (four would fill a 390px screen): player
  name and availability badge on the first line, "club · position · price" on the second.
  After it, in order: pick rating (once spec 0005 ships), `ep_next` (labelled "xP next"),
  price, then the chosen column group, which scrolls sideways.
- **Filters:** position, club (multi), price range, minimum minutes, text search on name,
  "show unavailable". Filter state lives in the URL query string.
- **Availability** badge per the contract table, with `news` on tap.
- **Freshness line** above the table: "Data as of {capturedAt}, {n} hours ago", amber/red
  per the contract thresholds. This is the stats table's share of the dead-man's switch.
- **Injury watch** tab: every player with `status ≠ 'a'`, showing status badge, `news`,
  time since `news_added`, and `chance_of_playing_next_round`. Newest news first.
- **Mobile, 390px:** name column pinned, other columns scroll horizontally, no card layout —
  the density is the product.
- Price renders from integer tenths without float division: `75` → `£7.5m`.

Column groups, picked with chips above the table: Overview (total points, form, PPG,
minutes, starts), Attack (goals, assists, xG, xA, xG/90, xA/90), Defence (clean sheets,
goals conceded, xGC/90, saves, defensive contributions/90), Expected (`ep_next`, `ep_this`,
form, fixture ease once spec 0003 ships), Value (selected by %, transfers in/out, bonus).
Tapping a column header sorts it; tapping again reverses.

## Testing

- Committed tests use **small hand-written synthetic fixtures** only — invented players and
  clubs (e.g. "Test Keeper", clubs `AAA`/`BBB`), including a player with `ep_next: null`.
  Never a real FPL payload: this repo is public.
- Real-payload checks are a local script reading `latest_bootstrap` through the reader role
  (or a file under the gitignored `_archive/`). It prints counts only ("712 players, 0
  parse failures") and writes nothing tracked.

## Acceptance criteria

- [ ] Every numeric column sorts both directions, nulls last, and sorting 700 rows is
      visually instant.
- [ ] A string-numeric field set to `null` renders as empty and sorts last — never as `0`.
- [ ] `now_cost: 75` renders as `£7.5m`. No float appears anywhere between Postgres and
      the render call.
- [ ] `ep_next` is present and sortable.
- [ ] Positions render from `element_types`; no position name is hardcoded.
- [ ] A fresh browser load transfers under 100 KB gzipped for `/api/players`.
- [ ] A reload with an unchanged snapshot returns `304`, and the freshness line still
      shows the correct, increasing age.
- [ ] A `backfill` `bootstrap-static` row newer than every other row changes nothing.
- [ ] `freepl_reader` cannot `INSERT` into `api_snapshots` (verify once, by hand).
- [ ] Taking the snapshot job offline leaves the table working and the freshness line
      visibly amber then red. No fallback fetch to the FPL API occurs — verify by network log.
- [ ] `server/`, `api/` and `web/` make zero requests to `fantasy.premierleague.com`.
- [ ] The built web bundle contains neither `DATABASE_URL`'s value nor any Neon hostname.
- [ ] Doubtful players show with a warning; `i`/`s`/`u`/`n` are hidden until "show
      unavailable"; injury watch lists all of them, newest news first.
- [ ] Usable one-handed at 390px: name column stays pinned through horizontal scroll.
- [ ] Filter state survives a page refresh via the URL.
- [ ] After the next scheduled snapshot lands, the page reflects it within 60s of a reload.

## Rollout

1. Apply `0002_reader.sql`, set its password, then `0002_current.sql`, in the Neon editor.
   As `freepl_reader`: `select count(*) from current_players` returns ~700 and
   `select captured_at from latest_bootstrap` matches the newest non-backfill row.
2. Build `packages/contract`. Run the real-payload check script; confirm zero parse failures.
3. `server/` locally against Neon as `freepl_reader`. Verify `304` and the cache-key query cost.
4. `web/` locally. Build the table against the live local API, not fixtures.
5. Add `ci.yml`; confirm it passes on the PR.
6. Deploy to Vercel. Grep the built bundle for secrets. Check on an actual phone, at a
   deadline-ish hour, on mobile data.
7. Confirm the morning after a scheduled snapshot that the new `capturedAt` appears.

Ship this fully — deployed and usable — before starting spec 0003.
