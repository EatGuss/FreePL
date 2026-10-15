# Spec 0004 — Entry view

Status: draft · hardens once spec 0002 ships
Depends on spec 0002 (contract, API, patterns), spec 0003 (`difficultyFor`) and ADR 0003
(live entry reads). Called "My Team" in earlier drafts; the UI label is free, the code and
docs say **Entry**.

## The constraint, first

**The editable pre-deadline squad is not publicly available.** It lives behind
`my-team/{id}`, which requires an authenticated session. The project is read-only and
unauthenticated by settled decision, so that endpoint is out.

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
| Purchase and selling prices | `my-team/{id}` | **No** — see `docs/roadmap.md` |

So the honest shape of this feature is: **the current Squad, with the latest started
gameweek's XI and captain, plus the money and transfer state.** It is not a live team
editor and cannot become one without authentication. The README should say so.

## Goal

A single page showing the current Squad with the stats-table columns attached, the
financial state, and the transfer/chip state — so the pre-deadline question "what do I
have and what can I afford" is answered on a phone without opening the FPL site.

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
- **Free Hit in gameweek n**: `picks(n)` is the temporary Squad and the real one is
  `picks(n−1)`. Transfers with `event = n` are ignored. To verify against live data at
  build time: whether `entry/{id}/transfers` lists Free Hit transfers at all.
- A transfer whose `event` is n or earlier is history, not pending. Filter on n+1 exactly.
- Reconstruct one gameweek ahead only. Do not generalise to arbitrary N.

## Derived financial state

- **Bank** = `history.current[n].bank + Σ element_out_cost − Σ element_in_cost` over
  pending transfers, all in tenths. **Verify at build time** that `element_out_cost` is
  the amount received when selling (the selling price), not `now_cost`. If it is not, bank
  is not shown.
- **Squad value** = `history.current[n].value`, labelled "as of GW n". Not adjusted:
  price changes since cannot be turned into selling value from public data.
- **Selling prices are not shown anywhere.** Public data gives purchase cost at each
  transfer but not the original Squad's purchase prices, so a sell-price figure would be
  right for transferred-in players and wrong for everyone held since GW1. A wrong sell
  price is the quiet budget inflation that makes FPL backtests cheat. Reconstruction is
  noted in `docs/roadmap.md`.
- **Free transfers available**, per `docs/fpl-domain.md`, as a pure tested function over
  `history.current[]` and `history.chips`:
  - Transfers before the GW1 deadline are unlimited and free; GW2 starts with 1.
  - After a gameweek with a Wildcard or Free Hit: unchanged (banked FTs kept, none earned).
  - Otherwise: `min(5, max(ft − transfers_made, 0) + 1)`.
  The same accounting the backtest simulator needs. Any extra FTs FPL grants mid-season
  only show up through the acceptance check against the FPL site — if one appears, add the
  rule to `fpl-domain.md`, don't patch the function.
- **Chips**: chip set 1 is GW1–19, set 2 is GW20–38; a used chip's set is decided by its
  `event`. The set 1 expiry shown is GW19's `deadlineTime` from `gameweeks`, never a
  hardcoded date.

## Layout

Two sections on one page:

1. **Squad** — pitch layout by position, 11 plus 4 from gameweek n's picks, with that
   gameweek's captain and vice marked and labelled "GW n", and auto-subs indicated.
   Players brought in by pending transfers appear with no XI position, flagged as such.
   Each player card carries price, form, `ep_next`, availability badge (shown whatever the
   status — this is your own Squad) and next fixture via `difficultyFor`.
2. **State** — bank, squad value (as of GW n), total points, overall rank, GW points and
   rank, free transfers available, chips used and remaining per chip set with the set 1
   expiry.

A list/table toggle for the Squad is worth it on mobile; the pitch graphic is the thing
most likely to be fiddly at 390px and least likely to matter.

## API

`GET /api/entry/me` → `{ meta, squad, state }`.

Entry id from env (`FPL_ENTRY_ID`), one Entry. The route is `/entry/me` rather than
`/entry/{id}` deliberately — an id parameter invites the caching and rate-limiting work
that multi-user drags in.

Live reads per ADR 0003: `history`, `transfers`, `picks` fetched from FPL by the client in
`server/` (User-Agent `FreePL-api/0.1`), 5 minute in-process cache, **never written to
Postgres**. Player and Club detail joined from the snapshot views, so the columns match the
stats table exactly.

`meta.sources` = `{ bootstrap: { capturedAt }, entry: { fetchedAt, stale } }`. The
freshness line shows the oldest source.

Upstream failure degrades: if FPL is down, serve the cached entry data with `stale: true`
and a visible notice. If there is no cache, show the State section as unavailable and
still render nothing false.

Additional Vercel env: `FPL_ENTRY_ID`, `FPL_CONTACT`. Server-only, never `VITE_`.

## Testing

Synthetic fixtures only: a hand-written history/transfers/picks set covering a normal week,
a hit, a Wildcard week, a Free Hit week (Squad reverts) and a bank-up to 5. Real-data
checks are local and commit nothing.

## Acceptance criteria

- [ ] Immediately after making a transfer on the FPL site, the Squad reflects it within
      the cache TTL — including while gameweek n is still being played.
- [ ] A Wildcard week (many transfers in one event) reconstructs to exactly 15 players.
- [ ] The week after a Free Hit, the Squad is the pre-Free-Hit Squad.
- [ ] Free transfers available matches the FPL site's figure across a bank-up week, a
      spend week, a hit week and a chip week.
- [ ] Chips remaining shows both chip sets and the set 1 expiry from GW19's deadline.
- [ ] No selling price is displayed anywhere.
- [ ] Nothing from `entry/*` is written to `api_snapshots` — verify by row count.
- [ ] With the FPL API unreachable, the page renders the Squad from cache and labels it
      stale; with no cache, it degrades without rendering wrong numbers.
- [ ] Before the GW1 deadline, the page shows an empty state.
- [ ] Leak check passes (Rollout step 4).

## Rollout

1. **Before building anything on live reads:** from a Vercel preview deployment, make one
   request to `entry/{FPL_ENTRY_ID}/history` and confirm FPL answers datacenter IPs with
   JSON, not a block page. If it doesn't, stop and revisit ADR 0003.
2. Dump one real `transfers` and `history` response locally (not committed) and confirm
   the `element_out_cost` meaning and Free Hit transfer listing.
3. Build, with the synthetic tests above.
4. **Leak check**, on the deployed build:
   - grep the built web bundle for `FPL_CONTACT`'s value, `DATABASE_URL`'s value and any
     Neon hostname — none present;
   - force an upstream error and a DB error; the responses carry a generic message only;
   - row count of `api_snapshots` for `entry/%` endpoints is unchanged by page loads;
   - accept consciously that anyone with the URL sees this Entry's (already public) data.
5. Check the FT figure against the FPL site after the next gameweek.

## Open, to settle when this is built

- Whether to show the next-fixture column here or rely on the ticker. Duplication across
  views is cheap; duplication of the *difficulty logic* is not — reuse `difficultyFor`.
