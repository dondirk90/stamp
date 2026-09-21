-- Raises the push reminder's default "minimum stamps" from 3 to 7 (chat
-- 2026-09-21: the main reminder should trigger at 7+ stamps / 2 weeks
-- inactive, not 3+). Migration 017 already shipped
-- `ADD COLUMN IF NOT EXISTS reminder_min_stamps INTEGER DEFAULT 3` to
-- staging - editing that file's default text wouldn't change anything on a
-- database that already has the column (IF NOT EXISTS skips it), so both
-- the column-level DEFAULT and any café rows still sitting at the old
-- default need an explicit fix here. Safe to blanket-update every row
-- currently at 3: the feature has not been enabled by any real café yet
-- (reminder_push_enabled defaults to 0), so there's no café-chosen "3" to
-- accidentally overwrite.
ALTER TABLE cafes ALTER COLUMN reminder_min_stamps SET DEFAULT 7;
UPDATE cafes SET reminder_min_stamps = 7 WHERE reminder_min_stamps = 3;
