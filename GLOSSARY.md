# FreePL

A solo Fantasy Premier League tool: capture FPL data point-in-time, project points,
optimise decisions, and score them in public.

## FPL

**Entry**:
The FPL fantasy team this project manages, identified by its entry id.
_Avoid_: Account, team, manager

**Club**:
A Premier League side. The FPL API calls these `teams`.
_Avoid_: Team

**Gameweek (GW)**:
One of the 38 rounds of the season, each with its own deadline.
_Avoid_: Round, event (except when naming the API field)

**Deadline**:
The moment after which an Entry's squad, transfers and chip for a gameweek are locked. Always taken from the API.

**Settled gameweek**:
A gameweek that is both finished and data-checked, so its points (including bonus) are final.
_Avoid_: Finished gameweek, completed gameweek

**Upcoming gameweek**:
The gameweek that owns the next deadline.
_Avoid_: Current gameweek (the API's `is_current` is the gameweek whose deadline most recently passed), next gameweek

**Squad**:
The 15 players an Entry holds.
_Avoid_: Team

**Pending transfer**:
A transfer made for the upcoming gameweek, not yet locked by its deadline.

**Free transfer (FT)**:
A transfer that costs no points. One is earned per gameweek and unused ones bank, up to five.

**Hit**:
The 4-point deduction for each transfer beyond the free transfers available.

**Chip**:
One of Wildcard, Free Hit, Bench Boost or Triple Captain, played for a single gameweek.

**Chip set**:
The four chips usable in one half of the season: set 1 covers GW1–19, set 2 covers GW20–38.

**Blank gameweek**:
A gameweek in which a Club has no fixture.

**Double gameweek**:
A gameweek in which a Club has two or more fixtures.

**Unscheduled fixture**:
A fixture not yet assigned to any gameweek.
_Avoid_: Postponed fixture (a postponed fixture may already be rescheduled)

**Pick rating**:
A band (Best, Great, Good, OK) ranking a player against others in the same position on underlying stats, fixtures and nailedness. A browsing aid only: not a projection, and never an input to the Entry's logged decisions.
_Avoid_: Score, projection, prediction

## Capture

**Capture**:
One raw API payload stored by the snapshot job, held both as a database row and as an archive file.
_Avoid_: Snapshot (that names the job), record

**Deadline capture**:
A `bootstrap-static` capture taken in the window shortly before a deadline, aimed at that deadline.

**Point-in-time**:
Describes data as it was known at a given moment, before later overwrites. For a gameweek, the latest capture strictly before its deadline.
_Avoid_: Historical, as-of (unqualified)

**Archive**:
The private `freepl-archive` repo holding a gzipped, byte-exact copy of every capture.
_Avoid_: Backup
