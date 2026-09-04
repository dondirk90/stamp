-- Google Wallet loyalty objects: one row per (customer, cafe) card, so we
-- know who to PATCH via the Wallet Objects REST API on stamp events / cafe
-- profile changes. No device push-token registry needed here (unlike Apple
-- Wallet) - Google syncs REST patches to the device on its own.

CREATE TABLE IF NOT EXISTS google_wallet_objects (
  id BIGSERIAL PRIMARY KEY,
  object_id TEXT UNIQUE NOT NULL,
  customer_address TEXT NOT NULL,
  cafe_id BIGINT NOT NULL REFERENCES cafes(id) ON DELETE CASCADE,
  updated_at BIGINT NOT NULL,
  created_at BIGINT NOT NULL
);

-- Same story as wallet_passes in 010_add_wallet_tables.sql: this narrow
-- (customer, cafe) index was superseded by 014_add_wallet_multi_card_support.sql's
-- wider (customer, cafe, card_id) one. Left here, it would keep trying to
-- reinstate itself on every deploy (migrate.cjs re-applies every file's
-- current content every time) and fail as soon as any customer legitimately
-- has more than one Google Wallet object per cafe.
