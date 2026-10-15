# ADR 0003 — The API may read the FPL API live for entry-scoped data, and never stores it

Date: 2026-10-14 · Status: accepted · Amended 2026-10-15 (point 4: client lives in `server/`)

## Context

Spec 0001 captures entry endpoints `post_gw` only — after a gameweek settles. That is
correct for the archive: settled picks are the scorecard, and nothing about them is lost.

The Entry view needs something different. Between a gameweek settling and the next deadline, the
squad changes (transfers are confirmed immediately and are public). A view that shows the
last settled picks and nothing else is wrong for most of the week.

Capturing entry endpoints hourly would fix the display but is the wrong trade: entry
history and transfers are fully re-fetchable at any time, so snapshotting them buys no
irrecoverable data and spends storage on the one free tier with a measured ceiling.

## Decision

1. `api/` may fetch the FPL API directly for **entry-scoped, re-fetchable** endpoints:
   `entry/{id}/history`, `entry/{id}/transfers`, `entry/{id}/event/{gw}/picks`.
2. Those responses are **never written to Postgres**. The snapshot job remains the only
   writer, and `api_snapshots` remains a record of what the archive captured, not a cache.
3. Everything not entry-scoped — players, teams, fixtures, events — is read from the
   snapshot views per ADR 0002. The API does not fetch `bootstrap-static` live. A stats
   table that silently falls back to upstream would hide a dead snapshot job, which is
   precisely the failure the dead-man's switch exists to catch.
4. Live reads reuse spec 0001's fetching discipline: 30s timeout, up to 3 attempts on
   network error/429/5xx with backoff and jitter, ≥1s pacing, and shape validation before
   use. The snapshot client is Python, so this is a **deliberate TypeScript copy** in
   `server/`, with a header comment naming spec 0001 "Fetching" as the source of truth.
   It does not go in `packages/contract`, which ships to the browser. User-Agent
   `FreePL-api/0.1 (+contact: <FPL_CONTACT>)`. Do not write a second, laxer client.
5. In-process cache, 5 minute TTL, keyed by entry id and endpoint. One user, one entry id;
   this does not need Redis.
6. An upstream failure degrades the page, it does not blank it. Render what the cache or
   the snapshot views can supply and show the error inline.

## Consequences

- The Entry view reflects the squad as it stands, not as it stood on Saturday.
- The `transfers` endpoint carries `element_in_cost` and `element_out_cost`. Combined with
  the GW1 deadline snapshot, that reconstructs purchase prices for the whole season
  without authentication — relevant later for sell-price accounting in the AI account's
  state table. Not built in v1, but the inputs now exist and are worth not losing.
- v1 has exactly one outbound dependency on FPL from the serving path. Keeping that
  boundary explicit is what stops "just fetch it live" from spreading to the stats table
  the first time a view feels slow.
