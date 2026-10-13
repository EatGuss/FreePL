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
