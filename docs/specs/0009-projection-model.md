# Spec 0009 — Projection model v1

Status: reviewed 2026-11-09 (Q103–Q115) · ready to build part 1 (Q114)
Depends on spec 0001 (captures), spec 0008 (scorecard), ADR 0001 (Neon + archive), ADR 0002

## Decisions from review (2026-11-09)

- **Q103:** v1 projects points only, for the upcoming gameweek only; the optimiser, multi-gameweek
  projections and the account's decisions are the next spec.
- **Q104:** Python in GitHub Actions, inside each deadline window; never on Vercel. How it is
  triggered is round 2 (the owner asked whether GitHub is reliable enough).
- **Q105:** trains on earlier seasons from vaastav/Fantasy-Premier-League: MIT-licensed
  (checked 2026-11-09); its README asks for a link back, which the README gives. Its files
  live in the private archive, never in this public repo. Its own README warns that `xP` may be
  post-match; it is never a feature (data-integrity rules).
- **Q106:** two parts multiplied, as the README says: a minutes model and points per appearance.
- **Q107:** projections go to a new append-only `projections` table, the second writer, with
  ADR 0004 written before it is built.
- **Q108:** a second job in `snapshot.yml`, run after every run that stores a deadline capture,
  so it reuses the external hourly trigger and gets 3–4 tries per deadline window. A model
  failure never fails or delays the snapshot job. Its own healthcheck alerts when no
  projection was written before a deadline. The latest run written before the deadline counts.
- **Q110:** numpy, pandas and scikit-learn, pinned in `model/requirements.txt` only; the snapshot
  job's `requirements.txt` stays as it is.
- **Q111:** the go-live goal: on the 2025/26 replay, the model's MAE is **at least 10% lower than
  the last-5 baseline's, overall and in every position**. Until it is, the model is improved
  and nothing of it is logged live.
- **Q112:** the **last-5 baseline** (each player's average points over his last 5 settled
  gameweeks known before the deadline) also runs live: logged before every deadline by the
  same job, in the same decision log, and shown on the scorecard beside `ep_next` and the model,
  which must keep beating it. The pipeline is built first with the last-5 baseline as its first
  entry, so it logs live weeks before the model is ready.
- **Q114:** three PRs. **Part 1, the pipeline:** the `projections` table and ADR 0004, the job in
  `snapshot.yml` with its healthcheck, the last-5 baseline logged live, the scorecard reading
  the table. **Part 2, the replay:** vaastav seasons into the archive, a 2025/26 replay harness
  using only what was known before each deadline, and the last-5 baseline's replay MAE (the
  bar). **Part 3, the model:** minutes × points per appearance, improved until Q111's goal is
  met, then logged live.
- **Q113:** with several projections, each gameweek is scored over **one shared set of
  players**: anyone any projection put above zero, plus anyone who scored. With one projection
  this is spec 0008's Q96 unchanged (GW7–9 keep their numbers). The set is used only to mark
  projections after a gameweek settles; no model ever sees it.
- **Q115:** live results never tune the model. Tuning uses earlier seasons and the 2025/26 replay
  only. Every change is a new `model_version` that must meet Q111's goal on the replay again
  before it is logged live, and the scorecard scores each version only on the gameweeks it
  actually projected: a new version never inherits or replaces an old one's record.

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

## Shape (Q106)

`expected points = P(plays 60+) × points if 60+ + P(plays 1–59) × points if under 60`, per
player, built from two parts:

1. **Minutes model:** the chance of starting and of playing 60+, from recent starts and minutes,
   the Club's fixture and, live only, FPL's availability fields. The 2025/26 replay is
   flag-blind (data-integrity rules), so it is trained and validated without them.
2. **Points per appearance:** expected goals, assists, clean sheets, saves, bonus and DefCon
   points, from per-90 rates and the opponent's strength, using FPL's scoring values read from
   the payload (`fpl-domain.md`: never hardcoded).

## Where it runs (Q104, Q108)

Python, in `model/`, as a second job in `snapshot.yml` that runs after every snapshot run that
stored a deadline capture. It reads captures from Neon with the job's role and writes its
projections. A failure here never fails the snapshot job. Never on Vercel.

## The decision log (Q107)

A new append-only table, the second writer in the system (needs ADR 0004):
`projections(season, gameweek, model, model_version, element_id, expected_points,
expected_minutes, created_at, deadline_time, input_capture_id)`. A row counts only if
`created_at < deadline_time`; the scorecard reads the latest qualifying run per gameweek and
`model_version`. Never `UPDATE` or `DELETE`, like `api_snapshots`. First entries: `last5`
(Q112), then the model.

## Training and validation data (Q105, Q109, Q111)

- **Training:** earlier seasons' per-gameweek player data (vaastav/Fantasy-Premier-League),
  for components only. `xP`, `selected`, `transfers_*` and current-season aggregates are never
  features (data-integrity rules).
- **Validation and the go-live goal:** a 2025/26 replay, flag-blind, gameweek by gameweek using
  only what was known before each deadline. The model must beat the last-5 baseline's replay MAE
  by at least 10%, overall and in every position (Q111). It is **not** compared with `ep_next`
  there: `ep_next` has no honest point-in-time record for 2025/26.
- **Live:** from the first gameweek each version logs, scored on the scorecard against `ep_next`
  and the last-5 baseline (Q112, Q113, Q115).

## Acceptance criteria

Part 1 (pipeline):
- [ ] Before every deadline from the first live one, a `last5` projection for every player in
      the deadline capture is logged; the healthcheck fails if none was written in time.
- [ ] No row is ever updated or deleted; a row written after its deadline is never scored.
- [ ] A model failure leaves the snapshot job's run and deadline assertion untouched.
- [ ] The scorecard shows `last5` beside `ep_next`, both over one shared set of players (Q113),
      and GW7–9's `ep_next` numbers are unchanged.

Part 2 (replay):
- [ ] The 2025/26 replay uses only data known before each deadline (a test replays one
      gameweek with later data present and gets the same projection), with no `xP`,
      `selected`, `transfers_*` or availability fields.
- [ ] The last-5 baseline's replay MAE, overall and per position, is recorded as the bar.

Part 3 (model):
- [ ] The model meets Q111's goal on the replay before it is logged live; each version's replay
      result is recorded with its `model_version`.
- [ ] The scorecard shows the model beside both baselines, each version scored only on its own
      gameweeks.
