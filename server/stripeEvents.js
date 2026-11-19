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

const INVOICE_EVENTS = new Set(['invoice.paid', 'invoice.payment_failed']);
const SUBSCRIPTION_EVENTS = new Set(['customer.subscription.updated', 'customer.subscription.deleted']);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const recurringIdOf = (v) => (typeof v === 'string' && UUID.test(v) ? v.toLowerCase() : null);

/**
 * Monthly support (Stripe subscriptions). Only objects carrying our recurring_id
 * metadata are handled, so unrelated subscriptions on the same account are ignored
 * instead of being retried forever.
 */
function extractRecurring(event, obj) {
  const base = { kind: 'recurring', eventId: event.id, type: event.type, livemode: Boolean(event.livemode) };
  if (HANDLED_SESSION_EVENTS.has(event.type) && obj.mode === 'subscription') {
    const recurringId = recurringIdOf(obj.metadata?.recurring_id);
    if (!recurringId || !['checkout.session.completed', 'checkout.session.expired'].includes(event.type)) return null;
    // subscriptionStatus carries the session's payment_status ('unpaid' for bank debits).
    return { ...base, recurringId, sessionId: obj.id, subscriptionId: idOf(obj.subscription), customerId: idOf(obj.customer), email: obj.customer_details?.email ?? null, subscriptionStatus: obj.payment_status ?? null };
  }
  if (INVOICE_EVENTS.has(event.type)) {
    // API 2025-03+ moved the subscription and its metadata under invoice.parent.
    const details = obj.parent?.subscription_details ?? obj.subscription_details ?? null;
    const recurringId = recurringIdOf(details?.metadata?.recurring_id ?? obj.lines?.data?.[0]?.metadata?.recurring_id);
    if (!recurringId) return null;
    return {
      ...base, recurringId, invoiceId: obj.id,
      subscriptionId: idOf(details?.subscription) ?? idOf(obj.subscription),
      customerId: idOf(obj.customer),
      // Older API versions include it; newer ones are looked up from the invoice's payments.
      paymentIntentId: idOf(obj.payment_intent),
      amountPaid: Number.isSafeInteger(obj.amount_paid) ? obj.amount_paid : null,
      currency: typeof obj.currency === 'string' && /^[a-z]{3}$/.test(obj.currency) ? obj.currency : 'invalid',
      email: obj.customer_email ?? null,
    };
  }
  if (SUBSCRIPTION_EVENTS.has(event.type)) {
    const recurringId = recurringIdOf(obj.metadata?.recurring_id);
    if (!recurringId) return null;
    return { ...base, recurringId, subscriptionId: obj.id, customerId: idOf(obj.customer), subscriptionStatus: obj.status ?? null };
  }
  return null;
}

/** Payment intent behind a paid invoice (API 2025-03+ keeps it in invoice payments). */
export async function invoicePaymentIntent(stripe, invoiceId) {
  if (!stripe.invoicePayments?.list) return null;
  const payments = await stripe.invoicePayments.list({ invoice: invoiceId, limit: 10 });
  const paid = payments.data.find((p) => p.status === 'paid' && p.payment?.type === 'payment_intent') ?? payments.data.find((p) => p.payment?.payment_intent);
  return idOf(paid?.payment?.payment_intent);
}

// Chargebacks: the payment leaves every total while disputed, and stays out if lost.
export const DISPUTE_EVENTS = new Set(['charge.dispute.created', 'charge.dispute.updated', 'charge.dispute.closed', 'charge.dispute.funds_reinstated']);

export function extractEvent(event) {
  const obj = event?.data?.object;
  if (!obj) return null;
  if (DISPUTE_EVENTS.has(event.type)) {
    const paymentIntentId = idOf(obj.payment_intent);
    if (!paymentIntentId) return null;
    return { kind: 'dispute', eventId: event.id, type: event.type, livemode: Boolean(event.livemode), paymentIntentId, disputeStatus: obj.status ?? null };
  }
  if (obj.object === 'checkout.session' && obj.mode === 'subscription' || INVOICE_EVENTS.has(event.type) || SUBSCRIPTION_EVENTS.has(event.type)) {
    return extractRecurring(event, obj);
  }
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
