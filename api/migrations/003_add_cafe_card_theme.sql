-- Add selectable customer card theme per cafe

ALTER TABLE cafes
  ADD COLUMN IF NOT EXISTS card_theme TEXT DEFAULT 'paper';
