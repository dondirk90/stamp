-- One-shot "finish onboarding" reminder tracking (unconfirmed email and/or
-- an Apple Wallet pass that was downloaded but never confirmed active).
-- No backfill UPDATE here on purpose: migrate.cjs re-applies every
-- migration file's SQL on every single deploy (see its own comment,
-- migrate.cjs:31-38), so a "mark existing rows as already-sent" UPDATE
-- keyed off IS NULL would keep re-firing and would incorrectly swallow
-- real candidates that sign up between deploys. Grandfathering
-- existing/backlog accounts is instead done with a fixed rollout-cutoff
-- constant in server.cjs (ONBOARDING_REMINDER_ROLLOUT_AT_MS).
ALTER TABLE customers
  ADD COLUMN IF NOT EXISTS onboarding_reminder_sent_at BIGINT;

-- Café whose QR code was scanned at registration (if any) - previously only
-- used transiently to build the verification link and then discarded, now
-- persisted so a later reminder email can still name the café and show its
-- logo.
ALTER TABLE customers
  ADD COLUMN IF NOT EXISTS registered_via_cafe_address TEXT;
