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

CREATE UNIQUE INDEX IF NOT EXISTS idx_google_wallet_objects_customer_cafe ON google_wallet_objects(customer_address, cafe_id);
