-- Cooldown tracking for a café's own manual "send to everyone" broadcast
-- (chat 2026-09-21: cafés want to trigger a push themselves, not just wait
-- for the automatic criteria-based reminder). One timestamp per café is
-- enough since a broadcast targets every customer with an open card at
-- once, not one customer at a time like reminder_notifications does.
ALTER TABLE cafes
  ADD COLUMN IF NOT EXISTS last_broadcast_at BIGINT;
