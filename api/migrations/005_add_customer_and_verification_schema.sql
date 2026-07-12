-- Bring Postgres schema in line with the current runtime expectations

ALTER TABLE cafes
  ADD COLUMN IF NOT EXISTS stamp_style TEXT DEFAULT 'bean',
  ADD COLUMN IF NOT EXISTS stamps_for_reward INTEGER DEFAULT 10,
  ADD COLUMN IF NOT EXISTS reward_description TEXT,
  ADD COLUMN IF NOT EXISTS popup_inactive_enabled INTEGER DEFAULT 1,
  ADD COLUMN IF NOT EXISTS popup_inactive_days INTEGER DEFAULT 21,
  ADD COLUMN IF NOT EXISTS popup_inactive_message TEXT,
  ADD COLUMN IF NOT EXISTS popup_almost_reward_enabled INTEGER DEFAULT 1,
  ADD COLUMN IF NOT EXISTS popup_almost_reward_remaining INTEGER DEFAULT 2,
  ADD COLUMN IF NOT EXISTS popup_almost_reward_message TEXT,
  ADD COLUMN IF NOT EXISTS card_bg_mime TEXT,
  ADD COLUMN IF NOT EXISTS card_bg_data TEXT,
  ADD COLUMN IF NOT EXISTS card_back_text TEXT,
  ADD COLUMN IF NOT EXISTS accepted_privacy_at BIGINT,
  ADD COLUMN IF NOT EXISTS accepted_terms_at BIGINT,
  ADD COLUMN IF NOT EXISTS privacy_version TEXT,
  ADD COLUMN IF NOT EXISTS terms_version TEXT,
  ADD COLUMN IF NOT EXISTS email_verified_at BIGINT;

ALTER TABLE customers
  ADD COLUMN IF NOT EXISTS accepted_privacy_at BIGINT,
  ADD COLUMN IF NOT EXISTS accepted_terms_at BIGINT,
  ADD COLUMN IF NOT EXISTS privacy_version TEXT,
  ADD COLUMN IF NOT EXISTS terms_version TEXT,
  ADD COLUMN IF NOT EXISTS email_verified_at BIGINT;

CREATE TABLE IF NOT EXISTS customer_email_verifications (
  id BIGSERIAL PRIMARY KEY,
  customer_id BIGINT NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL,
  created_at BIGINT NOT NULL,
  expires_at BIGINT NOT NULL,
  used_at BIGINT
);

CREATE INDEX IF NOT EXISTS idx_customer_email_verifications_hash
  ON customer_email_verifications(token_hash);

CREATE INDEX IF NOT EXISTS idx_customer_email_verifications_customer
  ON customer_email_verifications(customer_id);

CREATE TABLE IF NOT EXISTS cafe_email_verifications (
  id BIGSERIAL PRIMARY KEY,
  cafe_id BIGINT NOT NULL REFERENCES cafes(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL,
  created_at BIGINT NOT NULL,
  expires_at BIGINT NOT NULL,
  used_at BIGINT
);

CREATE INDEX IF NOT EXISTS idx_cafe_email_verifications_hash
  ON cafe_email_verifications(token_hash);

CREATE INDEX IF NOT EXISTS idx_cafe_email_verifications_cafe
  ON cafe_email_verifications(cafe_id);
