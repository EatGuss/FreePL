# Spec 0009 — Projection model v1

Status: draft (2026-11-09) · review with the owner before building
Depends on spec 0001 (captures), spec 0008 (scorecard), ADR 0001 (Neon + archive), ADR 0002

## Goal

FreePL's first projection: every player's expected points for the upcoming gameweek, written
to an append-only log **before each deadline**, and scored on the scorecard beside FPL's
`ep_next` (2.16 MAE over GW7–9). It is the README's "minutes model → per-event points
projection", and the first entry in the decision log that spec 0008 deferred (Q95).

It does not pick a team. The account stays managed by hand (`MODEL_MANAGES_FROM = null`) until
the optimiser's spec.

## What it is not

- Not the optimiser, transfers, captaincy or chips: those are the next spec, and they read this
  projection.
- Not multi-gameweek: the upcoming gameweek only. A horizon comes with the optimiser.
- Never fed by the pick rating (spec 0005 "What it is not").

## Shape (draft, Q4)

`expected points = P(plays 60+) × points if 60+ + P(plays 1–59) × points if under 60`, per
player, built from two parts:

1. **Minutes model:** the chance of starting and of playing 60+, from recent starts and minutes,
   the Club's fixture and, live only, FPL's availability fields. The 2025/26 replay is
   flag-blind (data-integrity rules), so it is trained and validated without them.
2. **Points per appearance:** expected goals, assists, clean sheets, saves, bonus and DefCon
   points, from per-90 rates and the opponent's strength, using FPL's scoring values read from
   the payload (`fpl-domain.md`: never hardcoded).

## Where it runs (draft, Q2)

Python, like the snapshot job, in GitHub Actions: a second workflow that runs inside each
deadline window after a deadline capture, reads captures from Neon with the job's role, and
writes its projections. Never on Vercel.

## The decision log (draft, Q5)

A new append-only table, the second writer in the system (needs ADR 0004):
`projections(season, gameweek, model, model_version, element_id, expected_points,
expected_minutes, created_at, deadline_time, input_capture_id)`. A row counts only if
`created_at < deadline_time`; the scorecard reads the latest qualifying run per gameweek. Never
`UPDATE` or `DELETE`, like `api_snapshots`.

## Training and validation data (draft, Q3, Q6)

- **Training:** earlier seasons' per-gameweek player data (vaastav/Fantasy-Premier-League),
  for components only. `xP`, `selected`, `transfers_*` and current-season aggregates are never
  features (data-integrity rules).
- **Validation:** a 2025/26 replay, flag-blind, gameweek by gameweek using only what was known
  before each deadline. Its MAE is reported but **not** compared with `ep_next`, which has no
  honest point-in-time record for 2025/26.
- **Live:** from the first gameweek the job logs, scored on the scorecard against `ep_next`.

## Open questions for review

Draft questions Q1–Q6 are put to the owner in rounds; decisions are recorded here as Q103 on.

## Acceptance criteria (sketch)

- [ ] A projection for every player in the deadline capture is logged before the deadline, for
      every gameweek from the first live one.
- [ ] No row is ever updated or deleted; a row written after its deadline is never scored.
- [ ] The scorecard shows the model's MAE beside `ep_next`'s, over the same players.
- [ ] No feature uses data from after its gameweek's deadline (a test replays one gameweek with
      later data present and gets the same projection).
