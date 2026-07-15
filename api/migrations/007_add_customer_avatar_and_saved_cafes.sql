ALTER TABLE customers
  ADD COLUMN IF NOT EXISTS avatar_mime TEXT,
  ADD COLUMN IF NOT EXISTS avatar_data TEXT;

CREATE TABLE IF NOT EXISTS customer_saved_cafes (
  id BIGSERIAL PRIMARY KEY,
  customer_id BIGINT NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  cafe_address TEXT NOT NULL,
  created_at BIGINT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_customer_saved_cafes_unique
  ON customer_saved_cafes(customer_id, cafe_address);

CREATE INDEX IF NOT EXISTS idx_customer_saved_cafes_customer
  ON customer_saved_cafes(customer_id);

CREATE INDEX IF NOT EXISTS idx_customer_saved_cafes_cafe
  ON customer_saved_cafes(cafe_address);
