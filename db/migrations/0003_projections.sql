-- 0003: the decision log (spec 0009, ADR 0004). Applied by hand in the Neon SQL editor, as the
-- owner. Not safe to re-run as a whole: run once (the trigger and index use if-not-exists forms,
-- the table does not, so a second run stops at the first statement).
--
-- Append-only, like api_snapshots. One run of the projection job is one transaction, so all of
-- its rows share created_at (now() is the transaction's start). The database refuses a row
-- written at or after its deadline, and refuses every UPDATE, DELETE and TRUNCATE.

create table projections (
  id               bigserial   primary key,
  season           text        not null,
  gameweek         int         not null,
  deadline_time    timestamptz not null,
  model            text        not null,   -- 'last5' first (spec 0009 Q112), then the model
  model_version    text        not null,
  element_id       int         not null,
  expected_points  numeric(6,3) not null,
  expected_minutes numeric(5,1),           -- null for projections without a minutes part
  input_capture_id bigint      not null references api_snapshots (id),
  created_at       timestamptz not null default now(),
  check (created_at < deadline_time)
);

create index if not exists projections_run_idx
  on projections (season, gameweek, model, model_version, created_at desc);

create or replace function projections_append_only() returns trigger language plpgsql as $$
begin
  raise exception 'projections is append-only (ADR 0004): % refused', tg_op;
end $$;

create or replace trigger projections_no_update_delete
  before update or delete on projections
  for each row execute function projections_append_only();

create or replace trigger projections_no_truncate
  before truncate on projections
  for each statement execute function projections_append_only();
