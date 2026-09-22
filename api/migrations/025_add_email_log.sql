-- Append-only send history for outgoing customer/café emails - the mail
-- counterpart to reminder_log (022, push notifications). Populated by a
-- single wrapper around emailTransporter.sendMail in server.cjs, so every
-- email the app sends is captured here without each send*Email() function
-- needing its own logging call. cafe_id/customer_address are nullable and
-- best-effort (only set when the caller attaches __logMeta) - purely
-- account-level emails (password reset, verification) simply have no café
-- to attribute to.
CREATE TABLE IF NOT EXISTS email_log (
  id BIGSERIAL PRIMARY KEY,
  cafe_id INTEGER,
  customer_address TEXT,
  kind TEXT,
  recipient TEXT NOT NULL,
  subject TEXT,
  success INTEGER NOT NULL,
  error TEXT,
  sent_at BIGINT NOT NULL
);

CREATE INDEX IF NOT EXISTS email_log_cafe_sent_at_idx ON email_log (cafe_id, sent_at DESC);
