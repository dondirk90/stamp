-- One-shot "you already have stamps, but your wallet pass was never
-- confirmed" reminder tracking - a separate flag from
-- onboarding_reminder_sent_at (016) on purpose: that one nudges brand-new
-- signups and explicitly excludes anyone with stamp_events already, on the
-- assumption that stamping means they're engaged. That assumption doesn't
-- hold here - a café can award stamps via /stamp-by-cafe regardless of
-- whether the customer ever finished "Add to Wallet" (café-side auth only,
-- see checkWalletActive's own comment), so a customer can rack up real
-- stamps that never actually show in their Wallet. This is the backlog
-- case for exactly that gap.
ALTER TABLE customers
  ADD COLUMN IF NOT EXISTS wallet_activation_reminder_sent_at BIGINT;
