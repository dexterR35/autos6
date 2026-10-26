// Turn a verified Stripe event into arguments for process_stripe_event, or null when the
// event isn't one of ours (unrelated product, unhandled type).
const HANDLED_SESSION_EVENTS = new Set([
  'checkout.session.completed',
  'checkout.session.async_payment_succeeded',
  'checkout.session.async_payment_failed',
  'checkout.session.expired',
]);

// Each of these triggers a recount of the payment's refunds from Stripe.
export const REFUND_EVENTS = new Set(['charge.refunded', 'refund.failed', 'refund.updated']);

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
      // Missing/null fields must quarantine a success event rather than bypass SQL's
      // mismatch check (NULL comparisons are not true in PostgreSQL).
      amountTotal: Number.isSafeInteger(obj.amount_total) && obj.amount_total > 0 ? obj.amount_total : -1,
      currency: typeof obj.currency === 'string' && /^[a-z]{3}$/.test(obj.currency) ? obj.currency : 'invalid',
      donorEmail: obj.customer_details?.email ?? null,
      donationId,
    };
  }
  if (REFUND_EVENTS.has(event.type)) {
    // refund.updated also fires for reference numbers and metadata; only a failed or
    // cancelled refund changes how much money was actually returned.
    if (event.type === 'refund.updated' && !['failed', 'canceled'].includes(obj.status)) return null;
    const paymentIntentId = idOf(obj.payment_intent);
    if (!paymentIntentId) return null;
    return {
      eventId: event.id,
      type: event.type,
      livemode: Boolean(event.livemode),
      paymentIntentId,
      // Filled in by the webhook from Stripe's current refund list (see refundedTotal).
      syncRefunds: true,
      donationId: obj.object === 'charge' ? obj.metadata?.donation_id ?? null : null,
    };
  }
  return null;
}

/**
 * Net amount refunded for a payment, read from Stripe at processing time. Event payloads
 * can arrive out of order, and a failed or cancelled refund returns the money, so the
 * stored total is replaced with this recount on every refund event.
 */
export async function refundedTotal(stripe, paymentIntentId) {
  const refunds = await stripe.refunds.list({ payment_intent: paymentIntentId, limit: 100 }).autoPagingToArray({ limit: 10_000 });
  return refunds
    .filter((refund) => !['failed', 'canceled'].includes(refund.status))
    .reduce((sum, refund) => sum + (Number.isSafeInteger(refund.amount) && refund.amount > 0 ? refund.amount : 0), 0);
}
