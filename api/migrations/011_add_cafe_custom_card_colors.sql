-- Optional custom hex colors for a cafe's card (App + Wallet). When set,
-- these override the fixed card_theme preset colors. NULL means "use the
-- card_theme preset", keeping every existing cafe unchanged by default.

ALTER TABLE cafes ADD COLUMN IF NOT EXISTS card_bg_color TEXT;
ALTER TABLE cafes ADD COLUMN IF NOT EXISTS card_fg_color TEXT;
