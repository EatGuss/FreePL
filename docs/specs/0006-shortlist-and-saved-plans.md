# Spec 0006 — Shortlist and saved plans

Status: **built** 2026-11-03 (both parts), checked in a browser on a synthetic season; a check on
live data with the owner's Entry is pending · reviewed 2026-11-02 (Q85–Q92) and 2026-11-03 (Q93–Q94)
Depends on spec 0004 (Squad, sell prices, transfer what-if) and spec 0005 (pick rating)

## Decisions from review (2026-11-02)

- **Q85:** links and storage carry the season; ids alone can't tell seasons apart (see
  "Storage").
- **Q86:** a Plan belongs to one Entry and one gameweek, and ends at that gameweek's deadline.
- **Q87:** when a link and this device disagree, the owner chooses; nothing is replaced
  automatically.
- **Q88:** Plans save on every change; there is no Save button.
- **Q89:** the Shortlist works with no Entry loaded; "Affordable if I sell…" needs one and
  uses the bank after the Plan, as the Replace sheet does.
- **Q90:** wording follows spec 0004 and `GLOSSARY.md` (Plan, Shortlist, Replace sheet).
- **Q91:** the Shortlist tab sits after My squad, with a count badge.
- **Q92:** "Clear plan" can be undone once with "Load previous plan".
- **Q93 (2026-11-03):** the link records the Plan's Entry in its own parameter, `pe=`,
  separate from `entry=` (the team on screen). Any team can be viewed; the Plan is applied
  only on its own Entry and waits there.
- **Q94 (2026-11-03):** two PRs. **Part 1:** the Shortlist, with the shared season tag and
  link-vs-device handling. **Part 2:** the saved Plan.
- *Part 1 as built (2026-11-03):* when a link differs from this device, the address bar
  shows this device's Shortlist while the choice is open, so a refresh before choosing
  drops the link's offer. "Bank after" sits next to the player, before the fixtures, so
  it stays on screen at phone width. Checked in a browser on a synthetic season: star,
  refresh, badge, link choice both ways, last-season link, blocked storage, no writes,
  and the bank-after figure equal to the Replace sheet's for the same pair.
- *Part 2 as built (2026-11-03):* while another Entry is on screen, its what-if still works
  but stays on the page unsaved, so the owner's own Plan is never overwritten (Q93). Clear
  plan on a Plan whose deadline passed, or that went stale, removes it for good (no "Load
  previous plan": there is nothing to go back to). A lineup-only Plan (no transfers) gets
  its Clear plan link in the lineup note. One `s` tag covers the Shortlist and the Plan, and
  is written while either exists. Checked in a browser on a synthetic season: save at once,
  refresh, Shortlist bank after the Plan, another team and back, Clear and Load previous,
  link choice both ways, deadline passed, stale, illegal lineup fallback, last-season link,
  blocked storage, no writes.

## Goal

Two small planning aids that survive a refresh and move between devices, with **no login
and no server-side writes**:

1. **Shortlist**: players starred on this device, grouped by position with rating, price
   and next 3 fixtures, plus "Affordable if I sell…".
2. **Saved Plan**: the spec 0004 planned transfers **and planned lineup** (XI, bench order,
   captain, vice), kept instead of lost on refresh.

## Out of scope

- Any FreePL account or login. Any FPL login: permanently out (read-only, never
  authenticate), and it would not help, since nothing is ever written to FPL.
- Storing shortlists or Plans in Postgres. That would make the API a second writer and
  needs its own ADR and table (never `api_snapshots`). Revisit only if FreePL becomes
  multi-user (`docs/roadmap.md`).
- Sharing with other people, multiple named shortlists, more than one Plan at a time.

## Storage

- **The URL carries both**: `?sl=12,345,…` for the Shortlist (element ids) and
  `?pe=…&plan=out:in,out:in&pgw=…&xi=…&bench=…&c=…&v=…` for a Plan (its Entry, transfers,
  gameweek and lineup, by element id). `pe` is the Plan's Entry and stays put when
  `entry` (the team on screen) changes (Q93). Copying the link moves them to another device.
- **The season (Q85):** both carry `s=` the year of GW1's deadline (e.g. `s=2026`), in the
  URL and in storage. FPL reuses element ids every season, so an old link's ids would
  name different players this season; checking ids against the latest bootstrap cannot catch
  that. A season mismatch drops the Shortlist or Plan with a visible notice ("This link is
  from the 2025/26 season, so its players can't be matched"), never remapped.
- **Browser storage mirrors the URL** so the app reopens where you left it. Every read and
  write is wrapped in try/catch; with storage unavailable, the URL alone still works.
- **Link and device disagree (Q87):** when a link carries a Shortlist or Plan and this
  device has a different one stored, nothing is replaced: the stored one stays on screen
  under a bar "This link has a different plan · **Use link's plan** · **Keep mine**" (or
  "…shortlist · Use link's shortlist · Keep mine"). If only one of the two exists, it loads
  without asking. A bare URL restores from storage and writes it into the address bar.
- **Saving (Q88):** every change to the Shortlist or Plan is written to the URL and storage
  at once, as filters already are. There is no Save button.

## Shortlist

- Star from Picks, Players or the Replace sheet. A star toggle on every player row.
- **Shortlist tab (Q91)**, after My squad: My squad · Shortlist · Picks · Players · Fixtures ·
  Injury watch, with a count badge like Injury watch's. Not tied to an Entry: it works with no
  team id loaded (Q89).
- Per-position tables like Picks: row colour by band (including Below OK and Not rated,
  since you chose these players), band word, Club, price, next 3 fixtures. Flagged players
  keep their badge.
- **"Affordable if I sell…"**, shown only when an Entry is loaded (Q89): pick a Squad player;
  each shortlisted player in that position shows bank after the swap, using spec 0004's sell
  price and the bank **after the Plan**, the same figure the Replace sheet shows. Negative is
  allowed and shown in red.

## Saved Plan

- **Scope (Q86, Q93):** a Plan stores its Entry's team id (`pe`) and its gameweek. While
  another Entry is on screen it is not applied, and it is back when its own Entry is. Once its gameweek's deadline passes it shows "Plan for GW n:
  deadline passed" with Clear plan, and is not applied. (FPL keeps the Entry's real
  transfers private until the deadline, spec 0004, so before then the app cannot tell they
  were made.) A Plan naming a player no longer in the Squad stays a backstop: shown as
  stale, not applied.
- The URL restores transfers and lineup together. A restored lineup that breaks the
  formation rules falls back to the XI from the last deadline, with a notice.
- **Clear plan (Q92)** leaves a bar "Plan cleared · **Load previous plan**" until the next
  change; one press restores it. Only the one most recent Plan is kept for this.

## Acceptance criteria

Ticked 2026-11-03 on a synthetic season: pure parts by `web/test/shortlist.test.ts` and
`web/test/savedPlan.test.ts`, the rest by a browser check (see "as built" above).

- [x] A Shortlist and a Plan survive a refresh, and opening the copied URL on another
      device restores both.
- [x] With browser storage blocked, the URL still restores both.
- [x] No request writes anything to the server; no login prompt exists anywhere.
- [x] A link or stored item from another season is dropped with a notice, even when its ids
      exist in this season's bootstrap.
- [x] A Plan is not applied to another Entry, nor after its gameweek's deadline.
- [x] A link that differs from this device's stored Shortlist or Plan changes nothing until
      "Use link's…" is chosen; "Keep mine" leaves storage as it was.
- [x] Every Plan change is in the URL without pressing anything; "Load previous plan" undoes
      Clear plan.
- [x] The Shortlist tab works with no Entry loaded; "Affordable if I sell X" matches the
      Replace sheet's bank after for the same pair.
