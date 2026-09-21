-- Second reminder template for the "card is already full, just not
-- redeemed yet" case - a customer with an open card at/above the reward
-- threshold reads oddly in the normal "nur noch 0 Stempel fehlen" text (see
-- the live staging check that surfaced this: a customer with 11 stamps on a
-- 10-stamp threshold). Same {token} convention as reminder_message.
ALTER TABLE cafes
  ADD COLUMN IF NOT EXISTS reminder_full_message TEXT;
