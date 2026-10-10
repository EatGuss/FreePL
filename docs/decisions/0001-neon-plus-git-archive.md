# ADR 0001 — Neon free tier as primary store, private git repo as archive copy

Date: 2026-10-10 · Status: accepted (revised same day: archive moved from a branch to a separate private repo)

## Context

The snapshot job captures data that exists nowhere else once overwritten — above all,
pre-deadline `bootstrap-static` payloads. Every backtest claim in the project depends on them.

Options considered for storage:

- **Neon free** — real Postgres, scale-to-zero, zero ops. Limits: 0.5 GB storage per project, 100 CU-hours/month. Free-tier terms are the vendor's to change.
- **Supabase free** — similar ~500 MB ceiling, no advantage for this workload.
- **Local Postgres** — disqualified. The job must run when the laptop is off.
- **Self-hosted on a free VPS** — more storage, but we'd own backups and uptime for the one irrecoverable dataset.

Projected season size (~200 MB) is uncertain: it depends on a jsonb compression ratio not yet measured.

For the second copy, an orphan branch in the code repo was the first choice. But the code
repo is public (it's the portfolio artefact), and a branch there would publicly
redistribute raw FPL payloads — which the project has committed not to do.

Archive placement options: orphan branch in the public repo (redistributes data), make
the code repo private (hides the portfolio, and flipping it public later would expose the
archive), or a separate private repo (one extra secret).

## Decision

1. Neon free tier is the primary, queryable store. Compute pinned at 0.25 CU.
2. Every stored payload is also written, gzipped and byte-for-byte, to a separate **private** repo, `freepl-archive`.
3. The workflow in the public `FreePL` repo pushes to it with an SSH **deploy key** with write access to that repo only. The workflow's own `GITHUB_TOKEN` is read-only.
4. Compression is measured two weeks after go-live; if the season projection exceeds ~350 MB, routine bootstrap captures drop to once daily before anything else changes.

Deploy key over a fine-grained personal access token: scoped to exactly one repo by construction, and doesn't expire mid-season.

## Consequences

- A Neon outage, quota suspension, accidental drop or pricing change costs no data — the archive can rebuild the table.
- No scraped data in the public repo; the code repo can stay public from day one.
- Public repo means unlimited free Actions minutes for the hourly cron.
- Archive commits no longer count as activity in `FreePL`. GitHub disables scheduled workflows in public repos after 60 days without activity, so a quiet stretch of development could stop the cron. The healthchecks.io dead-man's switch is what catches this; re-enable from the Actions tab if it happens.
- The snapshot script only writes files; the workflow does the push, with `if: always()` so a DB failure still archives.
- If storage overruns, the paid tier is roughly $1–2/month at this usage — an acceptable escape hatch, not a crisis.
