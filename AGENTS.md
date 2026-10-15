# AGENTS.md

FreePL — a solo Fantasy Premier League tool. Personal use + portfolio project.
Headline goal: an FPL account whose decisions are made by a projection model and an
optimiser, logged before each deadline, with a public scorecard.

## Current phase

**Task 0: the snapshot job.** Spec: `docs/specs/0001-snapshot-job.md`.
Task 0 is done when its rollout steps 5–7 pass (24 green hourly runs, healthchecks ping,
first deadline capture verified). The two-week compression check doesn't block.

Queued after it, in order — docs only until Task 0 is done:

| Spec | What | Status |
| --- | --- | --- |
| `0002-player-stats-table.md` | Stats table + injury watch; stands up contract, `server/`, `web/`, Vercel | queued |
| `0003-fixture-difficulty-ticker.md` | Club × gameweek difficulty grid | draft |
| `0004-entry-view.md` | Current Squad, sell prices, FTs, chips, transfer what-if (ADR 0003) | draft |
| `0005-pick-rating.md` | Best/Great/Good/OK band per player within position | draft |
| `0006-shortlist-and-saved-plans.md` | Starred players and transfer plans, kept in the URL | draft |

Until 0002 starts, do not scaffold `packages/`, `server/`, `api/` or `web/`. `model/` stays
out until its own spec. When 0002 starts, update the layout, stack and environment sections
below from spec 0002's "Files" and "Environment".

## Repo layout (only what exists now)

```
.github/workflows/snapshot.yml         hourly via external workflow_dispatch; cron backstop
scripts/snapshot.py                    single bare script, one main()
db/migrations/0001_api_snapshots.sql   applied by hand in Neon SQL editor
db/migrations/0002_api_snapshots_season.sql  adds api_snapshots.season; applied by hand
requirements.txt                       httpx, psycopg[binary], python-dotenv — nothing else without asking
docs/                                  human-facing docs; read on demand, not always
  specs/ decisions/ roadmap.md fpl-domain.md design.md design/mockup.html
.cursor/rules/data-integrity.mdc       always-on data rules (also imported by CLAUDE.md)
.env.example                           variable names, no values. Real values in .env (gitignored)
```

`_archive/` is the local archive output (gitignored). The real archive is a separate
**private** repo, `freepl-archive`: gzipped copy of every stored payload, pushed by the
workflow via a deploy key. This repo is public — raw FPL payloads never go in it.

## Stack

- Python 3.12 for ingestion. TypeScript (Node 22, pnpm, Hono, React) arrives with spec 0002 — not before.
- Postgres on Neon free tier (0.5 GB storage, 100 CU-hours/month). Pooled connection string via `DATABASE_URL`.
- GitHub Actions for scheduling. No Airflow, no ORMs, no migration runner yet.

## Environment

| Variable | Required | Purpose |
| --- | --- | --- |
| `DATABASE_URL` | yes | Neon pooled connection string |
| `FPL_ENTRY_ID` | yes | The FPL entry the account snapshots track |
| `FPL_CONTACT` | yes | Email for the User-Agent |
| `ARCHIVE_DIR` | no, default `./_archive` | Root directory archive files are written under (in CI: the checked-out `freepl-archive`) |
| `HEALTHCHECK_URL` | no | Dead-man's switch ping URL; skip pinging if unset |
| `FORCE` | no | `1` = store bootstrap, fixtures, set-piece-notes as `manual`, ignoring the decision table |

Locally, load `.env` with python-dotenv. In CI, values come from GitHub secrets / workflow inputs.
CI-only: secret `ARCHIVE_DEPLOY_KEY` and variable `ARCHIVE_REPO` — used by the workflow's checkout and push steps, never read by the script.

## Non-negotiables

1. **Read-only against the FPL API.** Never write, never authenticate.
2. **`api_snapshots` is append-only.** Never `UPDATE`, never `DELETE`, never truncate.
3. **Store raw payloads.** Do not filter, flatten or curate fields at ingest.
4. **Prices are integers in tenths** (`now_cost: 75` = £7.5m). Never floats.
5. **Timestamps are `timestamptz`, UTC.** Deadlines come from the API, never hardcoded.
6. **Fail loudly.** A run that should have stored data and didn't must exit non-zero.
7. **No new dependencies, directories or abstractions** beyond the current spec without asking.

Data-leakage rules live in `.cursor/rules/data-integrity.mdc` and apply always.

## FPL domain

You do not know how FPL works well enough to guess. Read `docs/fpl-domain.md` before
writing anything that touches squads, prices, chips, transfers, scoring or gameweeks.
If something isn't covered there, ask — don't invent a plausible rule.

## Vocabulary

Use the terms in `GLOSSARY.md` (Entry, Club, Capture, Settled gameweek, …) and avoid
the synonyms it lists. What the `gameweek` and `deadline_time` columns hold on each row
is defined in spec 0001, "`gameweek` and `deadline_time` per row".

## Working style

- Small, reviewable changes. One concern per commit.
- Before implementing, restate the acceptance criteria from the spec you're working to.
- Secrets only from environment variables. Never commit `.env`, never print `DATABASE_URL`.
- **Ask before:** `git push`, creating or modifying remote branches, triggering workflows, and any SQL against Neon other than `SELECT`.
- When the spec and this file disagree, stop and flag it.
