# Spec 0001 — Snapshot job

Status: ready to build · Supersedes the "Snapshot job" schema and cadence in the project brief.

## Goal

Capture FPL API payloads that are overwritten and never archived, so that every future
backtest has true point-in-time data. Above all: **a `bootstrap-static` capture before
every deadline, every gameweek, for the whole season.**

Two copies of every write: a row in Neon, and a gzipped file in a private archive repo. The
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
requirements.txt                  httpx, psycopg[binary], python-dotenv
.github/workflows/snapshot.yml
.gitignore, .env.example          already present; don't change without asking
```

Environment variables are defined in `AGENTS.md`.

## Schema

```sql
create table api_snapshots (
  id             bigserial primary key,
  endpoint       text        not null,  -- path as requested, e.g. 'bootstrap-static', 'event/7/live'
  resource_id    text,                  -- entry id for entry/* endpoints; null otherwise
  gameweek       int,                   -- see spec 0001 "gameweek and deadline_time per row"
  captured_at    timestamptz not null default now(),
  capture_reason text        not null
                 check (capture_reason in ('routine','deadline','post_gw','manual','backfill')),
  deadline_time  timestamptz,           -- the deadline this capture was aimed at (deadline rows); else the next deadline at capture time
  payload        jsonb       not null,
  season         text        not null   -- e.g. '2026-27'; see "Season". Added by migration 0002
);

create index on api_snapshots (endpoint, captured_at desc);
create index on api_snapshots (gameweek) where capture_reason = 'deadline';
```

Applied by hand in the Neon SQL editor. No migration runner. `season` was added by
`0002_api_snapshots_season.sql`; rows before it are all 2026/27.

## Run model

The workflow runs **hourly**. Every run:

1. Fetch `bootstrap-static` (always — it carries `events[].deadline_time`, needed for every decision).
2. Evaluate the decision table below against the clock and the latest existing rows.
3. Fetch any other endpoints that are due.
4. For each payload to store: write the archive file, then insert the DB row. A failure in one sink must not skip the other. (The workflow pushes archive files after the script exits.)
5. Ping the dead-man's switch. Exit non-zero if any sink failed or the deadline assertion failed.

All "is it due" rules read from `api_snapshots`, not from the schedule. Consequences the
implementation must preserve: a missed run self-heals next hour; two runs in one hour do
not double-store routine rows; a manual run is always safe.

### Decision table

`now` is UTC. `next_deadline` = earliest `events[].deadline_time` > `now`.

| Endpoint | Store when | `capture_reason` |
| --- | --- | --- |
| `bootstrap-static` | `next_deadline − 3h ≤ now < next_deadline` | `deadline` |
| `bootstrap-static` | otherwise, if latest row for this endpoint is > 11h old | `routine` |
| `fixtures` | latest row > 23h old | `routine` |
| `team/set-piece-notes` | latest row > 6 days old | `routine` |
| `event/{gw}/live` | event `gw` has `finished` and `data_checked` true, and no row exists for this endpoint+gw in the current season | `post_gw` |
| `entry/{FPL_ENTRY_ID}/history` | same trigger as live, per gw | `post_gw` |
| `entry/{FPL_ENTRY_ID}/event/{gw}/picks` | same trigger as live, per gw | `post_gw` |

- Inside the deadline window, **store on every run** (several shots per deadline is intended — cron drift is 10–30 min). Backtests use the latest capture strictly before `deadline_time`.
- A deadline row also satisfies the routine check (it's a newer `bootstrap-static` row).
- `post_gw` should backfill any settled GW with no row yet, not only the most recent — covers a missed weekend. Cap at 3 GWs per run to bound requests.
- Env `FORCE=1` (locally) or `workflow_dispatch` input `force: true` (CI, passed through as `FORCE=1`) stores all of: bootstrap, fixtures, set-piece-notes, with `capture_reason = 'manual'`. Used for verification.

### Season

- `season` = `"{Y}-{Y+1 mod 100:02}"` where `Y` is the year of GW1's `deadline_time` in the
  fetched `bootstrap-static` (2026 → `2026-27`). Read from the API, never from the clock.
- Written on every row and used as the top-level archive directory.
- Over the summer, captures keep the old season's label until FPL resets bootstrap.
- The `post_gw` "no row exists" check is scoped to the current season: gameweek numbers
  repeat every season, so an unscoped check would treat every new-season GW as captured.
- No GW1 `deadline_time` in bootstrap → exit non-zero before deciding anything.

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

## Archive repo

The code repo (`FreePL`) is public. Raw FPL payloads must not be redistributed, so the
archive lives in a **separate private repo**, `freepl-archive`, written to by this
workflow with a deploy key scoped to that repo only.

- Repo: `<owner>/freepl-archive`, private, default branch `main`. Created by hand (see Rollout).
- The script writes under `$ARCHIVE_DIR` (default `./_archive`, gitignored in `FreePL`). In CI, `ARCHIVE_DIR` points at the checked-out archive repo.
- Path within it: `{season}/{endpoint_slug}/{captured_at:%Y%m%dT%H%M%SZ}_{capture_reason}[_{resource_id}].json.gz`
  - `endpoint_slug`: endpoint with `/` replaced by `_` (e.g. `event_7_live`).
- Content: the exact response body bytes, gzipped. Not re-serialised.
- The script only writes files. Committing and pushing is a workflow step after the script, run with `if: always()` so archive files are pushed even when the DB insert failed.
- Workflow checks out the archive repo with `actions/checkout`: `repository: ${{ vars.ARCHIVE_REPO }}`, `ssh-key: ${{ secrets.ARCHIVE_DEPLOY_KEY }}`, `path: archive-repo`.
- Commit as `github-actions[bot]`. Message: `snapshot {captured_at} {reasons}`. Skip the commit if nothing changed. A failed push fails the job.
- Nothing from the archive repo is ever copied into `FreePL`.

## Database

- Connect via `DATABASE_URL` (Neon **pooled** connection string), one connection per run.
- One `INSERT` per payload, each its own transaction — a failure on one doesn't roll back others.
- Never `UPDATE`/`DELETE`.

## Failure handling

The dangerous failure is a green run that stored nothing. Guards:

1. **Deadline assertion.** If `now` was inside a deadline window and no `deadline` row was successfully inserted *and* its archive file written in this run → exit non-zero.
2. **Any sink failure** (fetch exhausted retries, validation failed, DB insert failed, archive file write failed) → continue the rest of the run, then exit non-zero. A failed archive push fails the push step, which fails the job.
3. **Dead-man's switch.** If `HEALTHCHECK_URL` is set: on success `GET {url}`, on failure `GET {url}/fail`. Configure in healthchecks.io: period 1h, grace 2h. Catches the workflow not running at all.
4. Log one line per endpoint: decision, reason, bytes, outcome. Plain `print` is fine.

## Workflow

- Triggers: `workflow_dispatch` (input `force`, boolean, default false) and `schedule: cron: '7 * * * *'`.
- `timeout-minutes: 10`.
- `concurrency: { group: snapshot, cancel-in-progress: false }` — prevents two runs racing the archive push.
- `permissions: contents: read` — the workflow never writes to `FreePL` itself.
- Steps: checkout `FreePL` → checkout archive repo → set up Python → run script (`ARCHIVE_DIR=archive-repo`) → commit + push archive repo (`if: always()`) → healthcheck ping. The ping reflects overall job status, so it runs last with `if: always()` and pings `/fail` if any earlier step failed.
- Python 3.12, pip cache. Path filter is irrelevant for schedule triggers; don't add `push` triggers.
- Secrets: `DATABASE_URL`, `FPL_ENTRY_ID`, `FPL_CONTACT`, `ARCHIVE_DEPLOY_KEY`, `HEALTHCHECK_URL` (optional).
- Repository variable: `ARCHIVE_REPO` (e.g. `egus/freepl-archive`).
- `ARCHIVE_DIR` and `FORCE` are set in the workflow, not secrets.

### Hourly trigger

GitHub's `schedule` is best-effort: on this repo it fired every 4–8h, not hourly, which
misses most 3h deadline windows. So the hourly driver is external, and the cron is a
backstop.

- **Primary:** a cron-job.org job, every hour at minute 7 UTC, sends
  `POST https://api.github.com/repos/EatGuss/FreePL/actions/workflows/snapshot.yml/dispatches`
  with body `{"ref":"main"}` (no `force`, so the decision table applies). Headers:
  `Authorization: Bearer <token>`, `Accept: application/vnd.github+json`,
  `X-GitHub-Api-Version: 2022-11-28`, `Content-Type: application/json`. Success is `204`.
  Failure emails on.
- **Token:** fine-grained PAT `freepl-snapshot-dispatch`, repository `FreePL` only,
  permission Actions: read and write, nothing else. Stored only in cron-job.org — not a
  GitHub secret, never read by the workflow or script.
- **Backstop:** the `schedule` cron stays. Overlapping runs are safe: the decision table
  dedupes routine rows and `concurrency` serialises the archive push.
- Don't remove `workflow_dispatch`: it is the production trigger, not only for manual runs.
- The dead-man's switch covers this trigger failing (token expired, job disabled).

## Neon settings (manual, before go-live)

- Compute autoscaling **min = max = 0.25 CU**. Each hourly wake costs ~5 min of compute before suspend; at 0.25 CU that's ~16 of 100 CU-hours/month. Unpinned autoscaling can approach the cap.
- Scale-to-zero on (default).

## Rollout

Each step must pass before the next.

1. Apply migration in Neon SQL editor.
2. Run script locally with `.env` loaded and `FORCE=1`; confirm 3 `manual` rows in Neon and 3 `.json.gz` files under `_archive/`. Then remove `FORCE` from `.env`.
3. Create the archive repo by hand:
   - New **private** repo `freepl-archive`, initialised with a README.
   - `ssh-keygen -t ed25519 -f freepl_archive_deploy -N "" -C freepl-archive`
   - In `freepl-archive` → Settings → Deploy keys: add `freepl_archive_deploy.pub`, **tick Allow write access**.
   - In `FreePL` → Settings → Secrets and variables → Actions: secret `ARCHIVE_DEPLOY_KEY` = contents of `freepl_archive_deploy` (private key); variable `ARCHIVE_REPO` = `<owner>/freepl-archive`.
   - Delete both key files locally. Never commit them.
4. Add the remaining secrets. Run the workflow via `workflow_dispatch` with `force: true`. Confirm rows in Neon **and** a new commit in `freepl-archive`.
5. Add the cron and the external hourly trigger (see "Hourly trigger"). Confirm a test
   call returns `204` and starts a `workflow_dispatch` run, then ~24 green runs within 24h.
6. Set up healthchecks.io; confirm a ping arrives.
7. Confirm the first real deadline capture (query below) after the next deadline.

## Known limits

Not handled in this task. Revisit before the end of the 2026/27 season.

- **Post-GW corrections.** `post_gw` rows are the payload at first settlement, stored
  once. Any correction FPL makes afterwards is not captured. Before the summer reset,
  re-capture every GW's `event/{gw}/live` and `entry/{FPL_ENTRY_ID}/history` once as
  `manual`; after the reset these payloads are not re-fetchable.
- **Dispatch token expiry.** The `freepl-snapshot-dispatch` PAT expires (max 1 year).
  When it does, runs fall back to the unreliable cron and healthchecks alerts. Renew it
  and update the cron-job.org header before the expiry date.

## Acceptance criteria

- [ ] Hourly scheduled runs complete in < 2 min under normal conditions.
- [ ] Every deadline has ≥1 `bootstrap-static` row with `capture_reason = 'deadline'` and `captured_at < deadline_time`, in both Neon and `freepl-archive`.
- [ ] Routine rows: ~2/day bootstrap, ~1/day fixtures, ~1/week set-piece notes. No duplicates from double runs.
- [ ] Each settled GW has exactly one `post_gw` row per post-GW endpoint.
- [ ] A forced validation failure (e.g. point the base URL at a non-JSON page) produces a red run and a healthchecks `/fail` ping.
- [ ] Killing the DB (bad `DATABASE_URL`) still pushes archive files to `freepl-archive`, and the run is red.
- [ ] The workflow has no write access to `FreePL`, and the deploy key has access to `freepl-archive` only.
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
The archive repo is unaffected by either.
