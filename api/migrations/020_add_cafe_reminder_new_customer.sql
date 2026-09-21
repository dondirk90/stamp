-- Second push-reminder scenario: a customer who saved a wallet card but
-- never got a single stamp (distinct from reminder_inactive_days, which
-- only applies to customers who have *some* stamp history and went quiet -
-- someone who never stamped has no "last stamp" to measure inactivity
-- from, so this measures days since the wallet card was created instead).
-- Reuses the same reminder_push_enabled master switch (migration 017) -
-- one on/off per café for "the reminder system", not two separate toggles.
ALTER TABLE cafes
  ADD COLUMN IF NOT EXISTS reminder_new_customer_days INTEGER DEFAULT 21,
  ADD COLUMN IF NOT EXISTS reminder_new_customer_message TEXT;
