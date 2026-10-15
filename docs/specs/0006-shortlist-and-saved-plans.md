# Spec 0006 — Shortlist and saved plans

Status: draft · after spec 0004
Depends on spec 0004 (Squad, sell prices, transfer what-if) and spec 0005 (pick rating)

## Goal

Two small planning aids that survive a refresh and move between devices, with **no login
and no server-side writes**:

1. **Shortlist** — players you've starred, grouped by position with rating, price and next
   3 fixtures, plus "affordable if I sell X".
2. **Saved plans** — the spec 0004 transfer what-if, kept instead of lost on refresh.

## Out of scope

- Any FreePL account or login. Any FPL login — permanently out (read-only, never
  authenticate), and it would not help: nothing is ever written to FPL.
- Storing shortlists or plans in Postgres. That would make the API a second writer and
  needs its own ADR and table (never `api_snapshots`). Revisit only if FreePL becomes
  multi-user.
- Sharing with other people, multiple named shortlists.

## Storage

- **The URL is the source of truth**: `?sl=12,345,…` for the shortlist (element ids) and
  `?plan=out:in,out:in` for a plan. Copying the link moves it to another device.
- **Browser storage mirrors it** so the app reopens where you left it. Every read and write
  is wrapped in try/catch; with storage unavailable, the URL alone still works.
- Element ids are per season. A shortlist or plan from another season (ids unknown to the
  latest bootstrap) is dropped with a visible notice, never silently remapped.
- A plan referring to a player no longer in the Squad (a real transfer happened since) is
  shown as stale, not applied.

## Shortlist

- Star from Picks, Players or a swap sheet. A star toggle on every player row.
- **Shortlist tab**: per-position tables like Picks — row colour by band (including Below OK
  and Not rated, since you chose these players), band word, Club, price, next 3 fixtures.
- **"Affordable if I sell…"**: pick a Squad player; each shortlisted player in that
  position shows bank after the swap, using spec 0004's sell price and what-if accounting.
  Negative is allowed and shown in red.

## Saved plans

- The planned-transfers box gains **Save** (writes the URL) and the URL restores it.
- One plan at a time in v1.

## Acceptance criteria

- [ ] A shortlist and a plan survive a refresh, and opening the copied URL on another
      device restores both.
- [ ] With browser storage blocked, the URL still restores both.
- [ ] No request writes anything to the server; no login prompt exists anywhere.
- [ ] Ids from another season are dropped with a notice.
- [ ] "Affordable if I sell X" matches spec 0004's swap sheet for the same pair.
