CREATE TABLE IF NOT EXISTS customer_oauth_identities (
  id BIGSERIAL PRIMARY KEY,
  customer_id BIGINT NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  provider TEXT NOT NULL,
  provider_subject TEXT NOT NULL,
  email TEXT,
  created_at BIGINT NOT NULL,
  last_used_at BIGINT
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_customer_oauth_identity_unique
  ON customer_oauth_identities(provider, provider_subject);

CREATE INDEX IF NOT EXISTS idx_customer_oauth_identity_customer
  ON customer_oauth_identities(customer_id);

CREATE TABLE IF NOT EXISTS customer_auth_grants (
  id BIGSERIAL PRIMARY KEY,
  customer_id BIGINT NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL,
  provider TEXT,
  created_at BIGINT NOT NULL,
  expires_at BIGINT NOT NULL,
  used_at BIGINT
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_customer_auth_grants_hash
  ON customer_auth_grants(token_hash);

CREATE INDEX IF NOT EXISTS idx_customer_auth_grants_customer
  ON customer_auth_grants(customer_id);
