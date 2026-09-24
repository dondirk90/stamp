-- Café-generated stamp silhouette (from their uploaded logo), used instead
-- of the default coffee bean wherever stamps render. NULL means "use the
-- default bean" - this is purely additive, no existing café is affected
-- until they explicitly generate one (see POST /cafes/me/stamp-icon).
ALTER TABLE cafes
  ADD COLUMN IF NOT EXISTS stamp_icon_mime TEXT;
ALTER TABLE cafes
  ADD COLUMN IF NOT EXISTS stamp_icon_data TEXT;
