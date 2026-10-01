// Stripe subscription billing for cafés (45€/month, see chat 2026-10-02).
// Pure Stripe-API wrapper, no DB access here - same separation as
// wallet-pass.cjs/google-wallet-pass.cjs: this module builds/reads Stripe
// objects, server.cjs owns reading/writing the `cafes` row.

let stripeClient = null;

function isBillingConfigured() {
  return !!process.env.STRIPE_SECRET_KEY;
}

function getClient() {
  if (!stripeClient) {
    const Stripe = require("stripe");
    stripeClient = new Stripe(process.env.STRIPE_SECRET_KEY);
  }
  return stripeClient;
}

function requirePriceId() {
  const priceId = process.env.STRIPE_PRICE_ID;
  if (!priceId) {
    throw new Error("STRIPE_PRICE_ID not configured");
  }
  return priceId;
}

// cafeRow.stripe_customer_id, once persisted, is trusted as-is - no round
// trip to Stripe to verify it still exists, same reasoning as every other
// "trust our own saved id" convention in this codebase (see wallet-pass.cjs/
// google-wallet-pass.cjs object id handling).
async function getOrCreateStripeCustomerId(cafeRow) {
  if (cafeRow.stripe_customer_id) return cafeRow.stripe_customer_id;
  const stripe = getClient();
  const customer = await stripe.customers.create({
    email: cafeRow.email || undefined,
    name: cafeRow.name || undefined,
    metadata: { cafeId: String(cafeRow.id) },
  });
  return customer.id;
}

async function createCheckoutSession({
  cafeRow,
  customerId,
  successUrl,
  cancelUrl,
  subscriptionMetadata,
}) {
  const stripe = getClient();
  return stripe.checkout.sessions.create({
    mode: "subscription",
    customer: customerId,
    line_items: [{ price: requirePriceId(), quantity: 1 }],
    // The café types a Promotion Code (fixed-amount or 100%-off) directly
    // into Stripe's own checkout page - no custom discount-code system to
    // build/maintain, Stripe's dashboard already is the admin UI for this.
    allow_promotion_codes: true,
    client_reference_id: String(cafeRow.id),
    metadata: { cafeId: String(cafeRow.id) },
    // Copied onto the resulting Subscription object itself, not just this
    // Checkout Session - the webhook looks the café up by this, not by
    // stripe_customer_id, so it self-heals regardless of event ordering.
    subscription_data: subscriptionMetadata
      ? { metadata: subscriptionMetadata }
      : undefined,
    success_url: successUrl,
    cancel_url: cancelUrl,
  });
}

// Billing Portal: lets an already-subscribed café manage/cancel its
// subscription and - the other half of "Café braucht eine Rechnung" -
// download its full Stripe-generated invoice history, with zero custom
// PDF/email code needed on our side.
async function createPortalSession({ customerId, returnUrl }) {
  const stripe = getClient();
  return stripe.billingPortal.sessions.create({
    customer: customerId,
    return_url: returnUrl,
  });
}

function constructWebhookEvent(rawBody, signatureHeader) {
  const stripe = getClient();
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) throw new Error("STRIPE_WEBHOOK_SECRET not configured");
  return stripe.webhooks.constructEvent(rawBody, signatureHeader, secret);
}

// Normalizes the handful of fields server.cjs's webhook route actually
// persists, from whatever Stripe subscription object a given event carries
// (checkout.session.completed nests it differently than
// customer.subscription.updated/deleted - callers pass whichever object the
// event gives them).
function summarizeSubscription(subscription) {
  return {
    id: subscription.id,
    status: subscription.status,
    currentPeriodEnd: subscription.current_period_end
      ? subscription.current_period_end * 1000
      : null,
  };
}

module.exports = {
  isBillingConfigured,
  getOrCreateStripeCustomerId,
  createCheckoutSession,
  createPortalSession,
  constructWebhookEvent,
  summarizeSubscription,
};
