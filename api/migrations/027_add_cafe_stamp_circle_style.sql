-- Whether the backing circle behind each stamp slot is a solid white disc
-- (default, keeps dark ink legible on dark card themes) or blends into the
-- card's own background color instead. NULL/"white" means the existing
-- behavior - purely additive.
ALTER TABLE cafes
  ADD COLUMN IF NOT EXISTS stamp_circle_style TEXT DEFAULT 'white';
