# Spec 0004 — Entry view

Status: draft · hardens once spec 0002 ships
Depends on spec 0002 (contract, API, patterns), spec 0003 (`difficultyFor`, fixture cells),
spec 0005 (row colours) and ADR 0003 (live entry reads). Called "My Team" in earlier
drafts; the UI tab is "My squad", the code and docs say **Entry**.

## The constraint, first

**The editable pre-deadline squad is not publicly available.** It lives behind
`my-team/{id}`, which requires an authenticated session. The project is read-only and
unauthenticated by settled decision, so that endpoint is out — permanently, not "until
auth is added".

What is publicly reachable:

| Wanted | Source | Public? |
| --- | --- | --- |
| Squad composition right now | latest `picks` + pending transfers from `entry/{id}/transfers` | Yes, reconstructable |
| Upcoming XI, bench order, captain | `my-team/{id}` only | **No** |
| Chip active for the upcoming gameweek | `my-team/{id}` only | **No** |
| XI, captain, auto-subs for a started gameweek | `entry/{id}/event/{gw}/picks` | Yes, from that gameweek's deadline |
| Bank, squad value, GW points, rank | `entry/{id}/history` | Yes |
| Chips already used | `entry/{id}/history.chips` | Yes |
| Transfers made, with in/out costs | `entry/{id}/transfers` | Yes |
| Purchase and selling prices | `my-team/{id}` directly; **reconstructable** otherwise | Yes, see "Selling prices" |

So the shape of this feature is: **the current Squad with sell prices, the latest started
gameweek's XI and captain, the money and transfer state, and a transfer what-if.** It is
not a live team editor: nothing is ever sent to FPL.

## Goal

A single page that answers the pre-deadline questions "what do I have, what is it worth,
and what can I afford" on a phone without opening the FPL site.

## Squad reconstruction

Let **n** = the gameweek whose deadline passed most recently (the API's `is_current`), not
the last *settled* gameweek: picks are public from the deadline, and pending transfers for
n+1 can be made while n is still being played.

```
base(n)  = picks(n−1).elements   if picks(n).active_chip is the Free Hit
         = picks(n).elements     otherwise
squad    = base(n)
           − pending transfers .element_out
           + pending transfers .element_in
pending transfers = transfers where event = n+1   (the upcoming gameweek)
```

Edge cases, handled explicitly rather than discovered:

- **Before the GW1 deadline** there is no `picks` to build from. Empty state, not an error.
- **Wildcard or Free Hit** in the upcoming gameweek produces many pending transfers; the
  arithmetic is unchanged but the count is not 1 or 2.
  *Verified (2026-10-16, real Entry):* `entry/{id}/transfers` lists every Wildcard transfer
  individually — one gameweek showed 15 rows in two batches (12, then 3) minutes apart, including a
  player bought in the first batch and sold in the second. The reconstruction must apply
  them in `time` order, and the free-transfer function must not count a chip gameweek's
  transfers. The endpoint's fields are exactly `element_in`, `element_in_cost`,
  `element_out`, `element_out_cost`, `entry`, `event`, `time`.
- **Free Hit in gameweek n**: `picks(n)` is the temporary Squad and the real one is
  `picks(n−1)`. Transfers with `event = n` are ignored. To verify against live data at
  build time: whether `entry/{id}/transfers` lists Free Hit transfers at all.
- A transfer whose `event` is n or earlier is history, not pending. Filter on n+1 exactly.
- Reconstruct one gameweek ahead only. Do not generalise to arbitrary N.

## Selling prices

The rule is in `docs/fpl-domain.md` ("Money"). The only per-player input is the
**purchase price**:

1. If the player arrived by transfer: the `element_in_cost` of the **latest** transfer that
   brought them in. (Free Hit transfers excluded, per the reconstruction above.)
2. Otherwise the player has been held since the original squad: the **launch price**,
   `now_cost − cost_change_start` from the latest `bootstrap-static`.

Then `sell = purchase + floor((now_cost − purchase) / 2)` if `now_cost > purchase`, else
`now_cost`. Integer tenths throughout. One pure function, tested with the worked examples
in `docs/fpl-domain.md`.

**Verify before shipping** (rollout step 2):

- `cost_change_start` is the change since launch, in tenths, and FPL prices do not move
  before the GW1 deadline. Cross-check against `element-summary/{id}` GW1 `value` for a few
  players held since GW1 (fetched locally; not stored).
- All 15 computed sell prices match the FPL site's transfers page for the Entry.

**All or nothing.** If any Squad player's purchase price cannot be determined, show no sell
prices and no selling value — a figure that is right for some players and wrong for others
is the quiet budget inflation that makes FPL backtests cheat.

## Derived financial state

- **Bank** = `history.current[n].bank + Σ element_out_cost − Σ element_in_cost` over
  pending transfers, all in tenths. Verify at build time that `element_out_cost` is the
  selling price received; if it is not, bank is not shown.
- **Selling value** = Σ sell prices of the 15 + bank: what could actually be spent. Live:
  it updates with the what-if below.
- **Squad value (FPL)** = `history.current[n].value`, labelled "as reported for GW n".
  Observed: `value` 1000 at GW1 with `bank` 0, rising with price changes to 1014 by GW6
  (bank 6) — still to settle whether it includes the bank and whether it is market or
  selling value.
  Verify at build time whether it equals selling value or Σ `now_cost` + bank, and label
  it accordingly; never call either one bare "team value".
- **Free transfers available**, per `docs/fpl-domain.md`, as a pure tested function over
  `history.current[]` and `history.chips`:
  - Transfers before the GW1 deadline are unlimited and free; GW2 starts with 1.
  - After a gameweek with a Wildcard or Free Hit: unchanged (banked FTs kept, none earned).
  - Otherwise: `min(5, max(ft − transfers_made, 0) + 1)`.
  *Verified on a real Entry (2026-10-16):* `history.current[].event_transfers` is **0 in a
  Wildcard gameweek** even with 15 transfers listed, so it already excludes chip transfers;
  `event_transfers_cost` is the hit in points. `history.chips[].name` values seen:
  `bboost`, `wildcard`, `3xc` (Free Hit presumably `freehit` — confirm when one appears).
  Worked through that Entry (BB GW1, 0 transfers GW2, WC GW3, 2 transfers GW4, 0 in GW5–6)
  the rules give 1 → 2 → 2 → 1 → 2 → 3 free transfers for GW2…GW7.
  Any extra FTs FPL grants mid-season only show up through the acceptance check against
  the FPL site — if one appears, add the rule to `fpl-domain.md`, don't patch the function.
- **Chips**: chip set 1 is GW1–19, set 2 is GW20–38; a used chip's set is decided by its
  `event`. The set 1 expiry shown is GW19's `deadlineTime` from `gameweeks`, never a
  hardcoded date.

## Transfer what-if

Tap **Swap** on a Squad player → a sheet listing same-position replacements ordered by pick
rating, each showing **bank after** = bank + sell(out) − `now_cost`(in). Choosing one adds
it to a **planned transfers** box; the Squad, bank, selling value and free transfers update
live.

- **Soft limits.** Bank may go negative and a Club may exceed 3: a plan is a draft. Both
  show as explicit warnings ("Over budget by £0.4m", "More than 3 from KST — FPL won't
  allow this"). Position is a hard limit (only same-position replacements are offered).
- **Hits:** each planned transfer beyond free transfers available shows −4 points.
- Incoming players are valued at `now_cost` (their sell price if sold straight back).
  Prices can change overnight; the plan says so.
- **Client-side only.** Never stored on the server, never sent to FPL. Lost on refresh in
  this spec; saving plans is spec 0006.
- The accounting (bank, hits, club counts) is one pure tested function — the backtest
  simulator needs the same arithmetic.

## Layout

Visual details (dashboard strip, view bar, pitch, shirt cards, sheets) are in
`docs/design.md`; this section says what is on the screen and how it behaves.

Tab **My squad** — the **landing tab** once this spec ships (spec 0002 "Table" has the
order and the fallback if FPL blocks Vercel). Top to bottom:

0. **Needs attention** line — tappable chips for: each flagged Squad player (amber % for
   doubtful, red for `i`/`s`/`u`/`n`), starters blanking in each of the next 3 gameweeks,
   and "No captain set". Tapping a flagged player opens Picks focused on that position
   with budget = bank + their selling price (spec 0005). Nothing flagged → "Nothing needs
   attention".
1. **Lineup note** — "Planned lineup 4-4-2 · starts from your GW n XI. A what-if only: set
   your real XI, bench and captain on the FPL site." Plus warnings: no captain, no vice,
   and the move prompt while moving.
2. **Planned transfers** box, when a plan exists: out (sell price) → in (buy price) per
   line, Undo per line, Clear plan, warnings (over budget, more than 3 from a Club, hits).
3. **Pitch / List toggle**, pitch by default — two separate views of the same 15.
4. **Dashboard strip**, one compact band (attached to the top of the pitch in Pitch view,
   standalone above the list in List view), not separate cards: bank (now, or after the plan), free transfers (left, or the hit), selling value
   (live), squad value (FPL, as of GW n); second line: chips of the current chip set, used
   ones struck through, with the set's expiry.
5. **Pitch view** — the planned XI by position (GK, DEF, MID, FWD rows) on a pitch drawn
   with a goal, net, penalty box and six-yard box at the top so the goalkeeper's position
   reads at a glance. The turf is drawn in perspective (tilted back, mown stripes) for a 3D
   feel; player cards stay upright and flat so they remain legible and tappable; bench below (GK, then 1st, 2nd, 3rd sub). Each player is a small Club shirt
   (goalkeepers in a distinct keeper kit) above a compact card (~66px wide): rating colour
   strip, short name, band word, next gameweek's fixture(s) (doubles stacked, blank
   marked), sell price; C/V badge and amber % or OUT flag on the shirt. A planned player
   takes the slot of the player they replace, marked NEW.
6. **List view** — the same 15 grouped by position: row colour by rating; player cell
   (name, flags, C/V and Bench-order tags; band word · Club · now price); sell price with
   "bought £x"; next 3 fixtures.
7. **Colour legend** and a one-line explanation of the sell-price rule.

**Shirt colours** come from a small hand-kept table in the contract: Club short name → body
and trim colour, for the 20 Clubs of the season. FPL's API has no Club colours, and its
shirt images are on FPL's servers, which the app never requests (spec 0002) — nor are
official kit images used. Re-check the table each summer for promoted Clubs; a Club missing
from it gets a neutral grey shirt, never an error.

### Player sheet

Tapping a player — on the pitch or a list row — opens a sheet, never the transfer list
directly:

- Club, position, band word, now price, sell price (or buy price if planned), injury news.
- Eight brief stats: xP next, form, points, minutes, then by position — GK: clean sheets,
  xGC/90, saves/90, bonus; DEF: clean sheets, xGC/90, xG/90, xA/90; MID/FWD: goals,
  assists, xG/90, xA/90.
- Next 3 fixtures.
- **Captain** and **Vice-captain** tick boxes, FPL-style. Ticking Captain on the current
  vice swaps the two. Disabled for bench players, with the reason.
- **Move** — highlights every player this one can legally swap with and dims the rest; tap
  one to swap, or Cancel. **Replace** — opens the same-position replacement list (transfer
  what-if above). **Why this rating?** — the spec 0005 breakdown.

### Planned lineup rules

From `docs/fpl-domain.md`; one pure tested function, shared with the backtest simulator:

- Starts from GW n's XI, bench order, captain and vice (the upcoming ones are not public).
- A swap is legal only if the XI stays at 1 GK, 3–5 DEF, 2–5 MID, 1–3 FWD. Two bench
  outfield players can swap to reorder the subs. The bench GK only swaps with the starting
  GK. Two starters never swap (it would change nothing).
- Captain and vice-captain must both be starters. Moving either to the bench clears it and
  shows the warning.
- A planned transfer in keeps the slot, role and armband of the player it replaces.
- Client-side only, like the transfer what-if; saved with the plan in spec 0006.

Row and card colours (spec 0005 bands, plus two Squad-only states):

| State | Look |
| --- | --- |
| Best / Great / Good / OK | as spec 0005 |
| Below OK — rated, outside the top 40% | muted red tint and stripe |
| Not rated — under 270 minutes or `i`/`s`/`u`/`n` | no tint, dashed grey stripe, "Not rated · 180 min" / "· injured" |

Not rated is never coloured as Below OK: a new signing or a returning player is not a bad
pick. Availability badges show whatever the status — this is your own Squad.

On the **Picks** tab (spec 0005), players in the Squad carry an "In squad" tag.

## API

`GET /api/entry/me` → `{ meta, squad, state }`.

Entry id from env (`FPL_ENTRY_ID`), one Entry. The route is `/entry/me` rather than
`/entry/{id}` deliberately — an id parameter invites the caching and rate-limiting work
that multi-user drags in.

`squad[]` carries, per player: id, GW n slot (XI/bench order, C/V), purchase price and its
source (`transfer` | `launch`), and whether it is a pending transfer in. Sell price is
computed in the contract, not stored.

Live reads per ADR 0003: `history`, `transfers`, `picks` fetched from FPL by the client in
`server/` (User-Agent `FreePL-api/0.1`), 5 minute in-process cache, **never written to
Postgres**. Player and Club detail joined from the snapshot views.

`meta.sources` = `{ bootstrap: { capturedAt }, entry: { fetchedAt, stale } }`. The
freshness line shows the oldest source.

Upstream failure degrades: if FPL is down, serve the cached entry data with `stale: true`
and a visible notice. If there is no cache, show the State section as unavailable and
still render nothing false.

Additional Vercel env: `FPL_ENTRY_ID`, `FPL_CONTACT`. Server-only, never `VITE_`.

## Testing

Synthetic fixtures only: a hand-written history/transfers/picks/bootstrap set covering a
normal week, a hit, a Wildcard week, a Free Hit week (Squad reverts), a bank-up to 5, a
player bought twice, and sell prices for a rise of +1, +2, +3 and a fall. Real-data checks
are local and commit nothing.

## Acceptance criteria

- [ ] Immediately after making a transfer on the FPL site, the Squad reflects it within
      the cache TTL — including while gameweek n is still being played.
- [ ] A Wildcard week (many transfers in one event) reconstructs to exactly 15 players.
- [ ] The week after a Free Hit, the Squad is the pre-Free-Hit Squad.
- [ ] All 15 sell prices match the FPL site's transfers page. If any purchase price is
      unknown, no sell price or selling value is shown at all.
- [ ] Sell-price function passes the `fpl-domain.md` worked examples (5.0→5.1 sells 5.0,
      5.0→5.2 sells 5.1, 5.0→5.3 sells 5.1, 6.0→5.9 sells 5.9).
- [ ] Free transfers available matches the FPL site's figure across a bank-up week, a
      spend week, a hit week and a chip week.
- [ ] The what-if allows a negative bank and a 4th player from a Club, and warns on both;
      hits show at −4 each beyond free transfers.
- [ ] Pitch and List views show the same 15 players; a planned player takes the replaced
      player's slot.
- [ ] Tapping a player opens the player sheet; Replace, not the tap, opens the transfer list.
- [ ] Move only offers swaps that keep a legal formation; a benched captain or vice loses
      the armband and the warning shows; captain and vice can't be ticked on the bench.
- [ ] Chips remaining shows both chip sets and the set 1 expiry from GW19's deadline.
- [ ] Nothing from `entry/*` is written to `api_snapshots` — verify by row count.
- [ ] With the FPL API unreachable, the page renders the Squad from cache and labels it
      stale; with no cache, it degrades without rendering wrong numbers.
- [ ] Before the GW1 deadline, the page shows an empty state.
- [ ] Leak check passes (Rollout step 5).

## Rollout

1. **Before building anything on live reads:** from a Vercel preview deployment, make one
   request to `entry/{FPL_ENTRY_ID}/history` and confirm FPL answers datacenter IPs with
   JSON, not a block page. If it doesn't, stop and revisit ADR 0003.
2. Locally (nothing committed): dump one real `transfers`, `history` and a few
   `element-summary` responses. Confirm the `element_out_cost` meaning, Free Hit transfer
   listing, `cost_change_start` semantics and the meaning of `history.value`.
3. Build, with the synthetic tests above.
4. Compare all 15 sell prices and the FT figure with the FPL site before enabling them.
5. **Leak check**, on the deployed build:
   - grep the built web bundle for `FPL_CONTACT`'s value, `DATABASE_URL`'s value and any
     Neon hostname — none present;
   - force an upstream error and a DB error; the responses carry a generic message only;
   - row count of `api_snapshots` for `entry/%` endpoints is unchanged by page loads;
   - accept consciously that anyone with the URL sees this Entry's (already public) data.
