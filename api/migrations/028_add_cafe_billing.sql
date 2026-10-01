-- Stripe subscription billing for cafés (45€/month). A café counts as
-- unlocked when payment_exempt = true OR subscription_status is 'active'/
-- 'trialing' - see requireActiveSubscription in server.cjs. payment_exempt
-- is a manual admin override for cases that should never need a card at
-- all (the team's own test cafés, partners given free access outright),
-- separate from Stripe's own 100%-off promotion codes which still run a
-- real (zero-charge) subscription through Stripe.
ALTER TABLE cafes
  ADD COLUMN IF NOT EXISTS stripe_customer_id TEXT;
ALTER TABLE cafes
  ADD COLUMN IF NOT EXISTS stripe_subscription_id TEXT;
ALTER TABLE cafes
  ADD COLUMN IF NOT EXISTS subscription_status TEXT;
ALTER TABLE cafes
  ADD COLUMN IF NOT EXISTS subscription_current_period_end BIGINT;
ALTER TABLE cafes
  ADD COLUMN IF NOT EXISTS payment_exempt INTEGER DEFAULT 0;
