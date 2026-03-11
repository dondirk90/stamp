-- Add optional card customization fields for cafes

ALTER TABLE cafes
  ADD COLUMN IF NOT EXISTS card_bg_mime TEXT;

ALTER TABLE cafes
  ADD COLUMN IF NOT EXISTS card_bg_data TEXT;

ALTER TABLE cafes
  ADD COLUMN IF NOT EXISTS card_back_text TEXT;
