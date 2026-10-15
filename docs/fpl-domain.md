# FPL domain reference

What an agent needs to know about Fantasy Premier League to avoid writing plausible,
wrong code. Season: **2026/27**. Where a value can be read from the API, the API wins
over this file — verify against a live payload before hardcoding anything.

## Squad

- 15 players: **2 GK, 5 DEF, 5 MID, 3 FWD**.
- Initial budget £100.0m (`1000` in tenths).
- **Max 3 players from any one Premier League club.**
- Starting XI: exactly 1 GK, at least 3 DEF, at least 1 FWD (which forces at least 2 MID). 4 on the bench, ordered; the bench GK is separate.
- Squad rules are in `bootstrap-static.element_types` (`squad_select`, `squad_min_play`, `squad_max_play`). Read them; don't hardcode.

## Money

- All prices are **integers in tenths of £1m**: `now_cost: 75` = £7.5m. Store and compute as integers.
- Prices change overnight (roughly once a day, early UK morning). `now_cost` is current only — past prices exist only in our snapshots.
- **Sell price** = purchase price + floor((current price − purchase price) / 2), in tenths.
  - Buy 70, rises to 75 → sell 72. Buy 70, rises to 71 → sell 70. Buy 70, falls to 66 → sell 66 (losses are taken in full).
  - So a price must rise £0.2m above purchase before the sell price rises £0.1m: buy 50 → at 51 sells 50, at 52 sells 51, at 53 sells 51. Buy 60, falls to 59 → sells 59 immediately.
  - Purchase price = what you paid when the player joined your squad: the transfer-in cost, or the launch price for players in your original squad.
  - Never assume a player sells for `now_cost`. Purchase price per player must be tracked.

## Gameweeks and deadlines

- 38 gameweeks (`events` in `bootstrap-static`). Each has `deadline_time` (UTC ISO string), `finished`, `data_checked`, `is_current`, `is_next`.
- Deadlines **move** — international breaks, midweek rounds, reschedules. Always read `deadline_time`; never assume a weekday or time.
- A GW is fully settled (bonus confirmed) when `finished` **and** `data_checked` are both true.
- Blank gameweek: a team has no fixture. Double gameweek: a team has two. Detectable from `fixtures/` grouped by `event`; fixtures can also have `event: null` while unscheduled.

## Transfers

- Transfers made before the GW1 deadline are unlimited and free.
- **1 free transfer per GW** from GW2 (GW2 starts with 1); unused FTs bank, **up to a maximum of 5**.
- Each transfer beyond available FTs costs **−4 points** (a "hit").
- Transfers made before a deadline apply to that GW.

## Chips (2026/27)

- **Eight chips in two sets of four**: Wildcard, Free Hit, Bench Boost, Triple Captain — once per set.
- **Set 1 covers GW1–GW19** and expires at the GW19 deadline (read it from `events[]`, never hardcode). No carry-over: unused set-1 chips are lost.
- **Set 2 covers GW20–GW38.** A chip played in gameweek `event ≤ 19` is from set 1; `event ≥ 20` is from set 2.
- **One chip per gameweek.** **No Free Hit in GW1.**
- **Wildcard and Free Hit preserve banked free transfers, and the chip gameweek earns none.** The count carries over unchanged: 3 banked before a Wildcard or Free Hit GW → 3 available for the following GW (not 4, not 1).
- Wildcard: unlimited free transfers, permanent. Free Hit: unlimited free transfers for one GW, squad reverts afterwards. Bench Boost: bench players score too. Triple Captain: captain scores ×3 instead of ×2.

## Captaincy and auto-subs

- Captain scores ×2. If the captain plays 0 minutes, the vice-captain gets the multiplier.
- Auto-subs: after the GW, starters with 0 minutes are replaced by bench players **in bench order**, skipping any sub that would break formation rules. Bench GK only replaces the starting GK.

## Scoring

- **Don't hardcode the scoring table.** Read it from `bootstrap-static` (`game_settings` / `game_config` — inspect the payload; key names change between seasons).
- Structural facts that matter for modelling:
  - Appearance points depend on minutes (under 60 vs 60+).
  - Clean sheets require 60+ minutes; worth different amounts by position.
  - Goals conceded: −1 per **two** conceded (GK/DEF). Saves: +1 per **three** (GK). These are floor functions.
  - **Bonus**: top 3 by BPS in each match get 3/2/1; ties share. Provisional until `data_checked`.
  - **Defensive contributions (DefCon)**, since 2025/26: points for reaching a threshold of defensive actions — 10 for defenders, 12 for midfielders and forwards.
- `event/{gw}/live` includes an `explain` breakdown per player showing exactly how points were awarded. Use it as ground truth for tests.

## Player status (`elements[].status`)

| Code | Meaning |
| --- | --- |
| `a` | Available |
| `d` | Doubtful — see `chance_of_playing_this_round` / `_next_round` (25/50/75) |
| `i` | Injured |
| `s` | Suspended |
| `u` | Unavailable (left the club, long-term out) |
| `n` | Not eligible (e.g. loanee facing parent club) |

`status`, `news`, `news_added`, `chance_of_playing_*` are **current state only**. There is no historical archive outside our snapshots.

## API facts

- Base: `https://fantasy.premierleague.com/api/`. Public, unauthenticated, undocumented.
- While a GW is being updated the API may return 503 or an HTML/text body ("The game is being updated"). A 200 is not proof of a valid payload — check JSON shape.
- Element IDs are **per season**: the same player has different IDs in different seasons, and there is no shared key with FBref/Understat.
- `ep_this` / `ep_next` are FPL's own projections. Only valid as a baseline if captured **before** the deadline.
