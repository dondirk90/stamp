-- wallet_passes/google_wallet_objects only had a composite unique index
-- starting with customer_address, which a plain "WHERE cafe_id = ?" or a
-- time-windowed "WHERE cafe_id = ? AND created_at >= ?" query (per-cafe
-- dashboard charts) can't use as an index seek - both would fall back to a
-- full table scan across every cafe's wallet rows. Adds the missing
-- (cafe_id, created_at) index so those queries stay index-backed as the
-- wallet tables grow.

CREATE INDEX IF NOT EXISTS idx_wallet_passes_cafe_created
  ON wallet_passes(cafe_id, created_at);

CREATE INDEX IF NOT EXISTS idx_google_wallet_objects_cafe_created
  ON google_wallet_objects(cafe_id, created_at);
