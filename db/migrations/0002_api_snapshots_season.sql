-- 0002: tag every row with its FPL season, e.g. '2026-27'. See spec 0001 "Season".
-- Applied by hand in the Neon SQL editor (no migration runner).
-- ADD COLUMN with a constant default fills existing rows without an UPDATE (metadata-only);
-- every row before this migration is from 2026/27.

alter table api_snapshots add column season text not null default '2026-27';
alter table api_snapshots alter column season drop default;  -- inserts must name the season
