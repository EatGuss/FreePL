-- 0002: read-only role for the API (spec 0002 "Database"). Applied by hand in the Neon SQL
-- editor, BEFORE db/views/0002_current.sql (whose grants name this role).
--
-- Replace the placeholder with a strong random password IN THE EDITOR ONLY. Never commit a
-- real password to this file. Create the role with SQL, not the console's "Add role", so it
-- is not given extra privileges.

create role freepl_reader with login password 'REPLACE-IN-EDITOR-ONLY';

grant usage on schema public to freepl_reader;
-- No grant on api_snapshots: the views run with their owner's privileges.
-- SELECT on each view is granted at the end of db/views/0002_current.sql.
