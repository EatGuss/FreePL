# Spec 0001 — Snapshot job

Status: ready to build · Supersedes the "Snapshot job" schema and cadence in the project brief.

## Goal

Capture FPL API payloads that are overwritten and never archived, so that every future
backtest has true point-in-time data. Above all: **a `bootstrap-static` capture before
every deadline, every gameweek, for the whole season.**

Two copies of every write: a row in Neon, and a gzipped file on a git branch. The
deadline captures are the only irrecoverable asset in the project; one free-tier
database is not enough redundancy. See `docs/decisions/0001-neon-plus-git-archive.md`.

## Out of scope

Do not build any of these in this task:

- `element-summary/{id}/` fetching (re-fetchable any time; backfill later)
- Backfill from `vaastav/Fantasy-Premier-League`
- Flattening payloads into typed tables
- Telegram alerts, CLI subcommands, config files, logging frameworks
- `model/`, `api/`, `web/` directories

## Files

```
db/migrations/0001_api_snapshots.sql
scripts/snapshot.py
requirements.txt                  httpx, psycopg[binary]
.github/workflows/snapshot.yml
```

## Schema

```sql
create table api_snapshots (
  id             bigserial primary key,
  endpoint       text        not null,  -- path as requested, e.g. 'bootstrap-static', 'event/7/live'
  resource_id    text,                  -- entry id for entry/* endpoints; null otherwise
  gameweek       int,                   -- see AGENTS.md "gameweek" definition
  captured_at    timestamptz not null default now(),
  capture_reason text        not null
                 check (capture_reason in ('routine','deadline','post_gw','manual','backfill')),
  deadline_time  timestamptz,           -- the deadline this capture was aimed at (deadline rows); else the next deadline at capture time
  payload        jsonb       not null
);

create index on api_snapshots (endpoint, captured_at desc);
create index on api_snapshots (gameweek) where capture_reason = 'deadline';
```

Applied by hand in the Neon SQL editor. No migration runner.

## Run model

The workflow runs **hourly**. Every run:

1. Fetch `bootstrap-static` (always — it carries `events[].deadline_time`, needed for every decision).
2. Evaluate the decision table below against the clock and the latest existing rows.
3. Fetch any other endpoints that are due.
4. For each payload to store: write the archive file locally, insert the DB row, then push the archive. A failure in one sink must not skip the other.
5. Ping the dead-man's switch. Exit non-zero if any sink failed or the deadline assertion failed.

All "is it due" rules read from `api_snapshots`, not from the schedule. Consequences the
implementation must preserve: a missed run self-heals next hour; two runs in one hour do
not double-store routine rows; a manual run is always safe.

### Decision table

`now` is UTC. `next_deadline` = earliest `events[].deadline_time` > `now`.

| Endpoint | Store when | `capture_reason` |
| --- | --- | --- |
| `bootstrap-static` | `next_deadline − 2h ≤ now < next_deadline` | `deadline` |
| `bootstrap-static` | otherwise, if latest row for this endpoint is > 11h old | `routine` |
| `fixtures` | latest row > 23h old | `routine` |
| `team/set-piece-notes` | latest row > 6 days old | `routine` |
| `event/{gw}/live` | event `gw` has `finished` and `data_checked` true, and no row exists for this endpoint+gw | `post_gw` |
| `entry/{FPL_ENTRY_ID}/history` | same trigger as live, per gw | `post_gw` |
| `entry/{FPL_ENTRY_ID}/event/{gw}/picks` | same trigger as live, per gw | `post_gw` |

- Inside the deadline window, **store on every run** (several shots per deadline is intended — cron drift is 10–30 min). Backtests use the latest capture strictly before `deadline_time`.
- A deadline row also satisfies the routine check (it's a newer `bootstrap-static` row).
- `post_gw` should backfill any settled GW with no row yet, not only the most recent — covers a missed weekend. Cap at 3 GWs per run to bound requests.
- `workflow_dispatch` with input `force: true` stores all of: bootstrap, fixtures, set-piece-notes, with `capture_reason = 'manual'`. Used for verification.

### `gameweek` and `deadline_time` per row

- Pre-deadline endpoints: `gameweek` = id of the event owning `next_deadline`; `deadline_time` = `next_deadline`. Both `NULL` after the final deadline of the season.
- Post-GW endpoints: `gameweek` = the finished GW; `deadline_time` = that GW's deadline.
- `entry/{id}/history`: `gameweek` = the GW whose settlement triggered it.

## Fetching

- `User-Agent: FreePL-snapshot/0.1 (+contact: <email from env FPL_CONTACT>)`.
- Timeout 30s. Retry on network error, 429 and 5xx: up to 3 attempts, exponential backoff with jitter (≈2s, 4s, 8s).
- **Validate shape, not just status.** A 200 with a non-JSON body (FPL returns text while "the game is being updated") is a failure. Minimum checks:
  - `bootstrap-static`: dict containing `events`, `elements`, `teams`.
  - `fixtures`: non-empty list.
  - `event/{gw}/live`: dict containing `elements`.
  - `entry/*/history`: dict containing `current`.
  - `entry/*/event/*/picks`: dict containing `picks`.
  - `team/set-piece-notes`: valid JSON (shape unknown — inspect and tighten later).
- Pace sequential requests ≥1s apart.

## Git archive

- Branch: **`snapshots-archive`**, an orphan branch (no shared history with `main`, keeps the main tree clean).
- Path: `archive/2026-27/{endpoint_slug}/{captured_at:%Y%m%dT%H%M%SZ}_{capture_reason}[_{resource_id}].json.gz`
  - `endpoint_slug`: endpoint with `/` replaced by `_` (e.g. `event_7_live`).
- Content: the exact response body bytes, gzipped. Not re-serialised.
- Workflow checks out `snapshots-archive` into a separate directory (`actions/checkout` with `ref` + `path`), the script writes files there, a final step commits and pushes them. Workflow needs `permissions: contents: write`.
- If the branch doesn't exist, create it once by hand before enabling the schedule (see Rollout).
- Commit message: `snapshot {captured_at} {reasons}`.

## Database

- Connect via `DATABASE_URL` (Neon **pooled** connection string), one connection per run.
- One `INSERT` per payload, each its own transaction — a failure on one doesn't roll back others.
- Never `UPDATE`/`DELETE`.

## Failure handling

The dangerous failure is a green run that stored nothing. Guards:

1. **Deadline assertion.** If `now` was inside a deadline window and no `deadline` row was successfully inserted *and* archived in this run → exit non-zero.
2. **Any sink failure** (fetch exhausted retries, validation failed, DB insert failed, archive push failed) → continue the rest of the run, then exit non-zero.
3. **Dead-man's switch.** If `HEALTHCHECK_URL` is set: on success `GET {url}`, on failure `GET {url}/fail`. Configure in healthchecks.io: period 1h, grace 2h. Catches the workflow not running at all.
4. Log one line per endpoint: decision, reason, bytes, outcome. Plain `print` is fine.

## Workflow

- Triggers: `schedule: cron: '7 * * * *'` and `workflow_dispatch` (input `force`, boolean, default false).
- `timeout-minutes: 10`.
- `concurrency: { group: snapshot, cancel-in-progress: false }` — prevents two runs racing the archive push.
- Python 3.12, pip cache. Path filter is irrelevant for schedule triggers; don't add `push` triggers.
- Secrets: `DATABASE_URL`, `FPL_ENTRY_ID`, `FPL_CONTACT`, `HEALTHCHECK_URL` (optional).

## Neon settings (manual, before go-live)

- Compute autoscaling **min = max = 0.25 CU**. Each hourly wake costs ~5 min of compute before suspend; at 0.25 CU that's ~16 of 100 CU-hours/month. Unpinned autoscaling can approach the cap.
- Scale-to-zero on (default).

## Rollout

Each step must pass before the next.

1. Apply migration in Neon SQL editor.
2. Run script locally with env vars and `--force` equivalent (env `FORCE=1` is fine); confirm 3 rows in Neon and 3 files in a local archive dir.
3. Create the orphan branch by hand, push it.
4. Add secrets. Run the workflow via `workflow_dispatch` with `force: true`. Confirm rows **and** a commit on `snapshots-archive`.
5. Add the cron. Confirm at least two scheduled runs land rows within 24h.
6. Set up healthchecks.io; confirm a ping arrives.
7. Confirm the first real deadline capture (query below) after the next deadline.

## Acceptance criteria

- [ ] Hourly scheduled runs complete in < 2 min under normal conditions.
- [ ] Every deadline has ≥1 `bootstrap-static` row with `capture_reason = 'deadline'` and `captured_at < deadline_time`, in both Neon and the archive branch.
- [ ] Routine rows: ~2/day bootstrap, ~1/day fixtures, ~1/week set-piece notes. No duplicates from double runs.
- [ ] Each settled GW has exactly one `post_gw` row per post-GW endpoint.
- [ ] A forced validation failure (e.g. point the base URL at a non-JSON page) produces a red run and a healthchecks `/fail` ping.
- [ ] Killing the DB (bad `DATABASE_URL`) still produces archive files, and a red run.
- [ ] No `UPDATE` or `DELETE` statements anywhere in the code.

## Verification queries

Weekly, first month — every GW present, every capture before its deadline:

```sql
select gameweek, max(captured_at) as last_capture, max(deadline_time) as deadline,
       max(captured_at) < max(deadline_time) as ok
from api_snapshots
where capture_reason = 'deadline' and endpoint = 'bootstrap-static'
group by gameweek order by gameweek desc limit 5;
```

Two weeks after go-live — measure compression and project the season:

```sql
select endpoint,
       count(*) as rows,
       pg_size_pretty(sum(pg_column_size(payload)))       as stored,
       pg_size_pretty(sum(length(payload::text))::bigint) as raw,
       round(sum(length(payload::text))::numeric
             / nullif(sum(pg_column_size(payload)), 0), 1) as ratio
from api_snapshots group by endpoint;
```

Also check Neon's dashboard storage figure, which includes more than logical rows.

**If projected season storage > ~350 MB** (cap is 500 MB), first lever: change routine
`bootstrap-static` from >11h to >23h, timed after the overnight price change. Deadline
captures stay untouched. Second lever (later, only if needed): gzip payloads into `bytea`.
The archive branch is unaffected by either.
