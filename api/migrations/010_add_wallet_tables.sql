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

CREATE UNIQUE INDEX IF NOT EXISTS idx_wallet_passes_customer_cafe ON wallet_passes(customer_address, cafe_id);

CREATE TABLE IF NOT EXISTS wallet_registrations (
  id BIGSERIAL PRIMARY KEY,
  device_library_identifier TEXT NOT NULL,
  serial_number TEXT NOT NULL REFERENCES wallet_passes(serial_number) ON DELETE CASCADE,
  push_token TEXT NOT NULL,
  created_at BIGINT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_wallet_registrations_device_serial ON wallet_registrations(device_library_identifier, serial_number);
CREATE INDEX IF NOT EXISTS idx_wallet_registrations_serial ON wallet_registrations(serial_number);
