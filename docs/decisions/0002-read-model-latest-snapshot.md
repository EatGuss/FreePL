# ADR 0002 — Serve v1 from views over the latest snapshot, no flattening layer

Date: 2026-10-14 · Status: accepted · Amended 2026-10-15 (backfill exclusion, cache key, cross-capture views)

## Context

Spec 0001 produces one table: `api_snapshots`, append-only, raw `jsonb`, deliberately
uncurated. It is the only writer in the system and flattening is explicitly out of its scope.

All three v1 tools (stats table, fixture ticker, Entry view) need **current state only** —
the newest `bootstrap-static` and `fixtures` payloads. None of them need history across
snapshots. That is the whole reason this decision is cheap.

Options:

- **Flatten on write.** An ETL step after each snapshot populates typed tables
  (players, clubs, fixtures). Fast reads, but adds a second writer, a schema that
  must track FPL's mid-season field additions, and a class of bug — a flattener that
  silently drops or mistypes a field — that corrupts a typed table permanently while
  looking green.
- **Read the raw payload at query time.** Postgres views select the newest row per
  endpoint and expand the arrays with `jsonb_to_recordset`. No second writer. An unknown
  key is ignored; a removed key yields `NULL` rather than an error. A bug here is a read
  bug: visible, and fixed by editing a view.
- **API calls the FPL API live.** Makes the snapshot archive decorative, and couples
  page loads to an undocumented upstream.

## Decision

1. v1 reads come from **views over the latest snapshot row**, excluding `capture_reason = 'backfill'`
   (a backfill row's `captured_at` says nothing about how current its payload is). No typed player/team/fixture
   tables, no ETL, no migration runner beyond the hand-applied files.
2. The snapshot job remains the only process that writes to Postgres.
3. Every API response carries the `captured_at` of the snapshot it was built from. The UI
   displays it. Data freshness is a visible property, not an assumption.
4. Numeric fields that the FPL API returns as strings (`form`, `ep_next`,
   `expected_goals`, `selected_by_percent`, `points_per_game`, ICT) are declared `text`
   in the `jsonb_to_recordset` column list and cast afterwards. Declaring them numeric
   makes the view throw if FPL changes a field's representation; declaring them text makes
   it survive.
5. Caching lives in the API, keyed on the `captured_at` read from the same `latest_*` view
   that serves the data, so key and body cannot come from different rows. The staleness
   check is one indexed scalar query; the expensive extraction runs only when the snapshot
   has actually changed.
6. The API connects as a read-only role (`freepl_reader`, `SELECT` on the views only). "The
   snapshot job is the only writer" is enforced by the database, not by convention.

## Consequences

- v1 ships without a data-modelling layer to get wrong. The thin vertical slice stays thin.
- FPL adding fields mid-season requires no migration — add the column to the recordset
  list when the UI wants it.
- Per-request extraction of ~700 players is real work. Acceptable at v1's cadence (the
  payload changes about twice a day) because of the cache; it would not be acceptable
  under load, which v1 does not have.
- **When this decision expires:** the price-change predictor and the projection model both
  read *across* snapshots — thousands of rows, joined on player and date. Views over a
  single row cannot serve that. Flattening gets its own spec at that point, written with
  the benefit of knowing which fields the model actually uses. That is the ordering the
  brief already argues for: don't curate before you know what you need.
- **Partly expired by spec 0005.** The pick rating reads every `post_gw` `event/{gw}/live`
  capture of the current season (one row per settled gameweek) through a view. That is the
  first read across captures. It is still a view with no second writer, so the rest of this
  decision stands; per-player-per-day reads (price predictor, projection model) still need
  their own flattening spec.
- Drizzle buys little against views — its value is typed tables and migrations, neither of
  which exists yet. v1 uses `postgres.js` with hand-written SQL and zod parsing at the
  boundary. Revisit when flattened tables arrive; adopting it later costs nothing that
  adopting it now saves.
