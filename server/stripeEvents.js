// Turn a verified Stripe event into arguments for process_stripe_event, or null when the
// event isn't one of ours (unrelated product, unhandled type).
const HANDLED_SESSION_EVENTS = new Set([
  'checkout.session.completed',
  'checkout.session.async_payment_succeeded',
  'checkout.session.async_payment_failed',
  'checkout.session.expired',
]);

const idOf = (v) => (typeof v === 'string' ? v : v?.id ?? null);

export function extractEvent(event) {
  const obj = event?.data?.object;
  if (!obj) return null;
  if (HANDLED_SESSION_EVENTS.has(event.type)) {
    const donationId = obj.metadata?.donation_id;
    if (!donationId) return null;
    return {
      eventId: event.id,
      type: event.type,
      livemode: Boolean(event.livemode),
      sessionId: obj.id,
      paymentIntentId: idOf(obj.payment_intent),
      paymentStatus: obj.payment_status,
      amountTotal: obj.amount_total,
      currency: obj.currency,
      donorEmail: obj.customer_details?.email ?? null,
      donationId,
    };
  }
  if (event.type === 'charge.refunded') {
    const paymentIntentId = idOf(obj.payment_intent);
    if (!paymentIntentId) return null;
    return {
      eventId: event.id,
      type: event.type,
      livemode: Boolean(event.livemode),
      paymentIntentId,
      amountRefunded: obj.amount_refunded,
      donationId: obj.metadata?.donation_id ?? null,
    };
  }
  return null;
}
