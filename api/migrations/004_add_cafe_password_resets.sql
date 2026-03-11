-- Add cafe password reset tokens

CREATE TABLE IF NOT EXISTS cafe_password_resets (
  id BIGSERIAL PRIMARY KEY,
  cafe_id BIGINT NOT NULL REFERENCES cafes(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL,
  created_at BIGINT NOT NULL,
  expires_at BIGINT NOT NULL,
  used_at BIGINT
);

CREATE INDEX IF NOT EXISTS idx_cafe_password_resets_hash ON cafe_password_resets(token_hash);
CREATE INDEX IF NOT EXISTS idx_cafe_password_resets_cafe ON cafe_password_resets(cafe_id);
