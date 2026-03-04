-- Initial Postgres schema for Stamp (off-chain)

CREATE TABLE IF NOT EXISTS cafes (
  id BIGSERIAL PRIMARY KEY,
  name TEXT,
  email TEXT UNIQUE,
  api_key TEXT UNIQUE,
  encrypted_key TEXT,
  address TEXT,
  location_address TEXT,
  street TEXT,
  house_number TEXT,
  postal_code TEXT,
  city TEXT,
  country TEXT,
  lat DOUBLE PRECISION,
  lng DOUBLE PRECISION,
  password_hash TEXT,
  about_text TEXT,
  redeem_message TEXT,
  logo_mime TEXT,
  logo_data TEXT,
  updated_at BIGINT,
  created_at BIGINT
);

CREATE TABLE IF NOT EXISTS stamp_events (
  id BIGSERIAL PRIMARY KEY,
  ts BIGINT NOT NULL,
  cafe TEXT NOT NULL,
  "user" TEXT NOT NULL,
  customer_name TEXT,
  txhash TEXT NOT NULL,
  status TEXT DEFAULT 'confirmed',
  event_type TEXT DEFAULT 'stamp',
  delta INTEGER DEFAULT 1
);

CREATE INDEX IF NOT EXISTS idx_stamp_events_ts ON stamp_events(ts);
CREATE INDEX IF NOT EXISTS idx_stamp_events_cafe ON stamp_events(cafe);
CREATE INDEX IF NOT EXISTS idx_stamp_events_user ON stamp_events("user");

CREATE TABLE IF NOT EXISTS cafe_images (
  id BIGSERIAL PRIMARY KEY,
  cafe_id BIGINT NOT NULL REFERENCES cafes(id) ON DELETE CASCADE,
  mime TEXT NOT NULL,
  data_b64 TEXT NOT NULL,
  created_at BIGINT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_cafe_images_cafe_id ON cafe_images(cafe_id);

CREATE TABLE IF NOT EXISTS qr_nonces (
  nonce TEXT PRIMARY KEY,
  cafe_id TEXT NOT NULL,
  expires BIGINT NOT NULL,
  consumed BOOLEAN DEFAULT FALSE,
  consumed_at BIGINT
);

CREATE TABLE IF NOT EXISTS redeem_tokens (
  token TEXT PRIMARY KEY,
  created_at BIGINT NOT NULL,
  used_at BIGINT,
  cafe TEXT,
  "user" TEXT,
  used_by_cafe TEXT,
  used_txhash TEXT
);

CREATE TABLE IF NOT EXISTS cafe_sessions (
  id BIGSERIAL PRIMARY KEY,
  cafe_id BIGINT NOT NULL REFERENCES cafes(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL,
  created_at BIGINT NOT NULL,
  expires_at BIGINT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_cafe_sessions_token_hash ON cafe_sessions(token_hash);
CREATE INDEX IF NOT EXISTS idx_cafe_sessions_cafe_id ON cafe_sessions(cafe_id);

CREATE TABLE IF NOT EXISTS customers (
  id BIGSERIAL PRIMARY KEY,
  customer_id TEXT UNIQUE,
  username TEXT,
  email TEXT,
  address TEXT,
  encrypted_key TEXT,
  password_hash TEXT,
  created_at BIGINT
);

CREATE INDEX IF NOT EXISTS idx_customers_email ON customers((lower(email)));

CREATE TABLE IF NOT EXISTS customer_password_resets (
  id BIGSERIAL PRIMARY KEY,
  customer_id BIGINT NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL,
  created_at BIGINT NOT NULL,
  expires_at BIGINT NOT NULL,
  used_at BIGINT
);

CREATE INDEX IF NOT EXISTS idx_customer_password_resets_hash ON customer_password_resets(token_hash);
CREATE INDEX IF NOT EXISTS idx_customer_password_resets_customer ON customer_password_resets(customer_id);

CREATE TABLE IF NOT EXISTS sync_state (
  key TEXT PRIMARY KEY,
  value TEXT
);
