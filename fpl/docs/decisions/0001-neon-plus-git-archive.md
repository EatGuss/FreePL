# ADR 0001 — Neon free tier as primary store, git branch as archive copy

Date: 2026-10-10 · Status: accepted

## Context

The snapshot job captures data that exists nowhere else once overwritten — above all,
pre-deadline `bootstrap-static` payloads. Every backtest claim in the project depends on them.

Options considered for storage:

- **Neon free** — real Postgres, scale-to-zero, zero ops. Limits: 0.5 GB storage per project, 100 CU-hours/month. Free-tier terms are the vendor's to change.
- **Supabase free** — similar ~500 MB ceiling, no advantage for this workload.
- **Local Postgres** — disqualified. The job must run when the laptop is off.
- **Self-hosted on a free VPS** — more storage, but we'd own backups and uptime for the one irrecoverable dataset.

Projected season size (~200 MB) is uncertain: it depends on a jsonb compression ratio not yet measured.

## Decision

1. Neon free tier is the primary, queryable store. Compute pinned at 0.25 CU.
2. Every stored payload is also written, gzipped and byte-for-byte, to an orphan git branch `snapshots-archive` in the same repo.
3. Compression is measured two weeks after go-live; if the season projection exceeds ~350 MB, routine bootstrap captures drop to once daily before anything else changes.

## Consequences

- A Neon outage, quota suspension, accidental drop or pricing change costs no data — the archive can rebuild the table.
- Snapshot script has two sinks and must not let one failure skip the other.
- Repo grows by an estimated <100 MB over the season, isolated on a branch nobody checks out by default.
- If storage overruns, the paid tier is roughly $1–2/month at this usage — an acceptable escape hatch, not a crisis.
