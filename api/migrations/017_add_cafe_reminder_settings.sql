-- Café-configurable push reminder: "if a customer has at least N stamps AND
-- hasn't stamped in M days, nudge them" (see TODO_FUTURE_TOPICS.md's "Fast
-- geschafft + Inaktivität kombiniert" writeup). Defaults mirror the existing
-- popup_* settings' shape but reminder_push_enabled defaults to 0 (off) -
-- unlike the in-app popups, this is a new outbound channel, so cafés opt in
-- rather than every existing café silently starting to send push
-- notifications on the next deploy.
ALTER TABLE cafes
  ADD COLUMN IF NOT EXISTS reminder_push_enabled INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS reminder_min_stamps INTEGER DEFAULT 1,
  ADD COLUMN IF NOT EXISTS reminder_inactive_days INTEGER DEFAULT 14;

-- Per-(café,customer) send tracking so a future sending job can tell "already
-- reminded this person for their current card" apart from "never reminded" -
-- one column per wallet platform since Apple/Google are separate notification
-- channels to the same relationship. Not populated by anything yet; the
-- sending job itself is a separate, later piece of work.
ALTER TABLE wallet_passes
  ADD COLUMN IF NOT EXISTS last_reminder_sent_at BIGINT;
ALTER TABLE google_wallet_objects
  ADD COLUMN IF NOT EXISTS last_reminder_sent_at BIGINT;
