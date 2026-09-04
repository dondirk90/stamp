-- Apple Wallet pass registrations: one row per (customer, cafe) pass instance,
-- plus device push-token registrations for update notifications.

CREATE TABLE IF NOT EXISTS wallet_passes (
  id BIGSERIAL PRIMARY KEY,
  serial_number TEXT UNIQUE NOT NULL,
  customer_address TEXT NOT NULL,
  cafe_id BIGINT NOT NULL REFERENCES cafes(id) ON DELETE CASCADE,
  authentication_token TEXT NOT NULL,
  updated_at BIGINT NOT NULL,
  created_at BIGINT NOT NULL
);

-- The (customer, cafe) unique index that used to live here was replaced by
-- 014_add_wallet_multi_card_support.sql's wider (customer, cafe, card_id)
-- one, which is required once a customer can legitimately hold more than
-- one wallet pass per cafe (multi-card overflow). migrate.cjs re-applies
-- every migration file's *current* content on every deploy (not just once -
-- see its own comment), so leaving the old CREATE UNIQUE INDEX statement
-- here would keep trying to reinstate the narrower, now-incompatible
-- constraint on every single deploy, and fail outright the moment any real
-- customer has overflowed into a second card by then. Confirmed live: this
-- is exactly what broke a production deploy.

CREATE TABLE IF NOT EXISTS wallet_registrations (
  id BIGSERIAL PRIMARY KEY,
  device_library_identifier TEXT NOT NULL,
  serial_number TEXT NOT NULL REFERENCES wallet_passes(serial_number) ON DELETE CASCADE,
  push_token TEXT NOT NULL,
  created_at BIGINT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_wallet_registrations_device_serial ON wallet_registrations(device_library_identifier, serial_number);
CREATE INDEX IF NOT EXISTS idx_wallet_registrations_serial ON wallet_registrations(serial_number);
