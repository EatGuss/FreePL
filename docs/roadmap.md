# Roadmap

Capabilities deliberately not built yet, with what they need, so they aren't rediscovered
from scratch.

## Selling-price reconstruction

Public data can rebuild every Squad player's purchase price without authentication:
GW1 deadline prices come from the deadline capture of `bootstrap-static`, and
`entry/{id}/transfers` carries `element_in_cost` for every change since. Selling price then
follows the rule in `docs/fpl-domain.md`. Belongs with the AI account's `squad_state`
table, which needs it for the solver. Until then no selling price is shown (spec 0004).

## Flattening into typed tables

Trigger: the price-change predictor or the projection model, both of which read across
captures per player per day. Views over the latest capture (ADR 0002) cannot serve that.
Gets its own spec, written once we know which fields the model uses. Spec 0005's
`season_gameweek_live` view is the first cross-capture read and is not a substitute.

## Per-gameweek history in the UI

Points, minutes and underlying stats per gameweek since GW1 for each player. Not needed by
the stats table. The data already exists as `post_gw` `event/{gw}/live` captures; spec 0005
reads it for the rating. Revisit if role changes or rotation patterns prove hard to see
from season totals.
