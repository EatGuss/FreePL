# ADR 0004 — The projection job is a second writer, to an append-only `projections` table

Date: 2026-11-10 · Status: accepted (spec 0009 Q107)

## Context

Until now the snapshot job has been the only writer, and `api_snapshots` the only table that
grows (ADR 0001, ADR 0002, ADR 0003 point 2). Spec 0009 needs FreePL's own projections recorded
**before each deadline** and scored after it: the decision log that spec 0008 deferred (Q95).

A projection can't be recomputed honestly later. Re-running the model after a deadline, even
on the same captures, can't prove that the numbers were the ones it held at the time, and a
model changed since would give different ones. So projections must be stored when they are
made, by whatever makes them, with the time they were made.

## Decision

1. A second writer is allowed: the projection job (`model/`), run by `snapshot.yml` as a job of
   its own (spec 0009 Q108). It writes only to `projections`; it never writes `api_snapshots`.
2. `projections` is **append-only**, like `api_snapshots`: never `UPDATE`, never `DELETE`, never
   truncate. A trigger refuses all three, so undoing it is a deliberate, visible act.
3. **The database enforces "before the deadline":** `check (created_at < deadline_time)`, with
   `created_at` defaulting to the transaction's start. A run that ends up past its deadline is
   rejected whole, never stored as if it were on time.
4. Every row names the capture its inputs came from (`input_capture_id`), so a projection can be
   traced to exactly what was known when it was made.
5. One run = one transaction = one `created_at`. Several runs per deadline window are expected
   (3–4); the scorecard reads the latest run before the deadline per gameweek, model and
   version.
6. The API and `freepl_reader` still never write. `freepl_reader` reads projections only
   through the scorecard views.

## Consequences

- ADR 0002's "no second writer" no longer holds. Its views stay views; this table is the
  first one FreePL writes from its own computation.
- Storage: about 700 rows per run, 3–4 runs per deadline, 38 deadlines: roughly 100k small rows a
  season, a few MB beside `api_snapshots`' ≈180 MB.
- A projection logged late is lost, not fixed. That is the point: the scorecard can only show
  what was known in time.
