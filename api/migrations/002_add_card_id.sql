-- Add card_id to stamp_events for multi-card support

ALTER TABLE stamp_events
  ADD COLUMN IF NOT EXISTS card_id TEXT;

-- Helps fast per-card counts (queries use LOWER(cafe) and LOWER("user"))
CREATE INDEX IF NOT EXISTS idx_stamp_events_cafe_user_card
  ON stamp_events ((lower(cafe)), (lower("user")), card_id);
