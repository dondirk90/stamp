-- Persists the single-use redeem-QR token while a wallet card is full, so
-- repeated pass regenerations (e.g. a cafe profile save) reuse the same
-- token/QR image instead of minting a new one every time. Cleared once the
-- card drops back below the reward threshold (redeemed).

ALTER TABLE wallet_passes ADD COLUMN IF NOT EXISTS active_redeem_token TEXT;
ALTER TABLE google_wallet_objects ADD COLUMN IF NOT EXISTS active_redeem_token TEXT;
