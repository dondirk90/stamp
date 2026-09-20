-- Café-editable text for the push reminder (see migration 017), same
-- {token} placeholder convention as popup_inactive_message/
-- popup_almost_reward_message (see formatCampaignText in
-- customer-qr-modern.js and its server-side mirror formatReminderText in
-- server.cjs) - {days} and {remaining} are the ones the default template
-- uses, but {cafe}/{stamps}/{goal}/{reward} are also available.
ALTER TABLE cafes
  ADD COLUMN IF NOT EXISTS reminder_message TEXT;

-- The fully-composed text for one specific reminder send, snapshotted at
-- send time (not recomputed later) - so what a customer's Wallet pass shows
-- reflects the days-inactive/remaining-stamps numbers as they actually were
-- when the reminder fired, not whatever they've drifted to by the time the
-- device happens to poll for the update.
ALTER TABLE reminder_notifications
  ADD COLUMN IF NOT EXISTS message TEXT;
