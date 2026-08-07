-- cafes.website_url/instagram_url/short_description were only ever added via
-- runSqliteOnlyAlter() in server.cjs (SQLite dev convenience only, see the
-- isSqliteDb() guard there) - never as a Postgres migration, so production
-- has been missing them since these fields were introduced. Backfills the
-- gap the same way every other runSqliteOnlyAlter-only column already got
-- one (see 002/003/005/007/008).

ALTER TABLE cafes
  ADD COLUMN IF NOT EXISTS website_url TEXT,
  ADD COLUMN IF NOT EXISTS instagram_url TEXT,
  ADD COLUMN IF NOT EXISTS short_description TEXT;
