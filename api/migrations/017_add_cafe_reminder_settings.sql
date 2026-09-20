-- Café-configurable push reminder: "if a customer has at least N stamps AND
-- hasn't stamped in M days, nudge them" (see TODO_FUTURE_TOPICS.md's "Fast
-- geschafft + Inaktivität kombiniert" writeup). Defaults mirror the existing
-- popup_* settings' shape but reminder_push_enabled defaults to 0 (off) -
-- unlike the in-app popups, this is a new outbound channel, so cafés opt in
-- rather than every existing café silently starting to send push
-- notifications on the next deploy. reminder_min_stamps defaults to 3, the
-- low end of the café-facing 3-9 range (matches the UI's <select>/number
-- bounds in cafe-scanner-new.html).
ALTER TABLE cafes
  ADD COLUMN IF NOT EXISTS reminder_push_enabled INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS reminder_min_stamps INTEGER DEFAULT 3,
  ADD COLUMN IF NOT EXISTS reminder_inactive_days INTEGER DEFAULT 14;

-- One row per (café, customer) tracking the last reminder sent and the
-- customer's stamp state (their lastStampTs, same field the existing
-- popup logic already uses) at that moment - "one push per state": a later
-- matching run skips a customer whose stamp state hasn't changed since,
-- and only reconsiders them once they've stamped again and gone inactive a
-- second time. Deliberately platform-agnostic (not per wallet_passes/
-- google_wallet_objects row) since the requirement is one push total per
-- customer, not one per wallet platform they happen to have installed.
CREATE TABLE IF NOT EXISTS reminder_notifications (
  cafe_id INTEGER NOT NULL,
  customer_address TEXT NOT NULL,
  sent_at BIGINT NOT NULL,
  stamp_state_ts BIGINT NOT NULL,
  PRIMARY KEY (cafe_id, customer_address)
);

-- Superseded by reminder_notifications above (platform-agnostic tracking is
-- the right shape for "one push per state" - see its own comment) - this
-- migration file already shipped a per-platform version to staging before
-- that design was settled, so clean it up here rather than leaving dead
-- columns behind. No-op on any database that never had them.
ALTER TABLE wallet_passes DROP COLUMN IF EXISTS last_reminder_sent_at;
ALTER TABLE google_wallet_objects DROP COLUMN IF EXISTS last_reminder_sent_at;
