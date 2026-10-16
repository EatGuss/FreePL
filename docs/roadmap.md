# Roadmap

Capabilities deliberately not built yet, with what they need, so they aren't rediscovered
from scratch.

## Selling prices for the AI account

Spec 0004 reconstructs purchase and selling prices for the Entry from the transfer log and
launch prices (`now_cost − cost_change_start`). The AI account's `squad_state` table needs
the same function for the solver; reuse it, don't rewrite it.

## Server-side saved plans

Spec 0006 keeps shortlists and plans in the URL and browser storage. Saving them on the
server would make the API a second writer and need a FreePL login of its own — only worth
it if FreePL ever becomes multi-user. FPL login stays out regardless.

## Flattening into typed tables

Trigger: the price-change predictor or the projection model, both of which read across
captures per player per day. Views over the latest capture (ADR 0002) cannot serve that.
Gets its own spec, written once we know which fields the model uses. Spec 0005's
`season_gameweek_live` view is the first cross-capture read and is not a substitute.

## Price-change predictor inputs

Since 2026/27, `bootstrap-static.elements[]` carries FPL's own price-change signals:
`price_change_percent`, `price_change_hourly_rate`, `price_change_projections[]` (offset,
projected percent, likelihood), `price_change_locked_until`, `price_change_calibrating`.
They are point-in-time and overwritten, so only our captures preserve them — another reason
the routine capture cadence matters. The predictor's spec should decide whether these are
features, a baseline to beat, or both.

## Per-gameweek history in the UI

Points, minutes and underlying stats per gameweek since GW1 for each player. Not needed by
the stats table. The data already exists as `post_gw` `event/{gw}/live` captures; spec 0005
reads it for the rating. Revisit if role changes or rotation patterns prove hard to see
from season totals.
