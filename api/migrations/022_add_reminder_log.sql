-- Append-only push-reminder history (chat 2026-09-21: "gibt es ein log wann
-- an wen welche push rausgingen?"). reminder_notifications only ever holds
-- the *latest* send per (cafe, customer) - that's what the "one push per
-- state" dedup check needs, but it means a café can't see anything older
-- than the most recent send. This table logs every send *attempt*, not
-- just successful ones, so a delivery that silently didn't reach a device
-- (apple_touched true but apple_pushed 0) stays visible instead of looking
-- identical to a real send.
CREATE TABLE IF NOT EXISTS reminder_log (
  id BIGSERIAL PRIMARY KEY,
  cafe_id INTEGER NOT NULL,
  customer_address TEXT NOT NULL,
  kind TEXT,
  message TEXT,
  stamp_state_ts BIGINT,
  apple_touched INTEGER,
  apple_pushed INTEGER,
  google_sent INTEGER,
  sent_at BIGINT NOT NULL
);

CREATE INDEX IF NOT EXISTS reminder_log_cafe_sent_at_idx
  ON reminder_log (cafe_id, sent_at DESC);
