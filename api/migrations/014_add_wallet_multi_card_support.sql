-- Multi-card wallet support: a customer can have more than one wallet pass
-- per cafe (one per card_id) once a full card overflows into a new one, so
-- the old (customer, cafe) unique index - one row per customer+cafe, full
-- stop - has to widen to (customer, cafe, card_id). NULL card_id (every
-- pass issued before this feature existed) is still unique-safe under the
-- new index: Postgres treats each NULL as distinct in a unique index.

ALTER TABLE wallet_passes ADD COLUMN IF NOT EXISTS card_id TEXT;
DROP INDEX IF EXISTS idx_wallet_passes_customer_cafe;
CREATE UNIQUE INDEX IF NOT EXISTS idx_wallet_passes_customer_cafe_card ON wallet_passes(customer_address, cafe_id, card_id);

ALTER TABLE google_wallet_objects ADD COLUMN IF NOT EXISTS card_id TEXT;
DROP INDEX IF EXISTS idx_google_wallet_objects_customer_cafe;
CREATE UNIQUE INDEX IF NOT EXISTS idx_google_wallet_objects_customer_cafe_card ON google_wallet_objects(customer_address, cafe_id, card_id);
