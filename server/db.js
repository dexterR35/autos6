// Data access for the payment API, backed by Supabase RPCs (service role, server-only).
// Every write goes through a Postgres function so each operation is one transaction.

export class DbError extends Error {
  constructor(code, message) {
    super(message || code);
    this.code = code; // e.g. project_not_found, part_not_found, attempt_mismatch, donation_not_found
  }
}

const KNOWN = ['project_not_found', 'part_not_found', 'attempt_mismatch', 'donation_not_found', 'invalid_amount'];
export function toDbError(err) {
  const msg = err?.message || '';
  const code = KNOWN.find((k) => msg.includes(k)) || 'db_error';
  return new DbError(code, msg);
}

export const mapPending = (r) => ({
  donationId: r.donation_id,
  projectId: r.project_id,
  currency: r.currency,
  partSlug: r.part_slug,
  partName: r.part_name,
  amountCents: Number(r.amount_cents),
  checkoutSessionId: r.stripe_checkout_session_id,
  status: r.status,
});

export const mapStatus = (r) =>
  r && { status: r.status, amountCents: Number(r.amount_cents), refundedCents: Number(r.refunded_cents), currency: r.currency, partName: r.part_name };

export const eventArgs = (e) => ({
  p_event_id: e.eventId,
  p_type: e.type,
  p_livemode: e.livemode,
  p_session_id: e.sessionId ?? null,
  p_payment_intent_id: e.paymentIntentId ?? null,
  p_payment_status: e.paymentStatus ?? null,
  p_amount_total: e.amountTotal ?? null,
  p_currency: e.currency ?? null,
  p_donor_email: e.donorEmail ?? null,
  p_amount_refunded: e.amountRefunded ?? null,
  p_donation_id: e.donationId ?? null,
});

export function createSupabaseDb(client) {
  const rpc = async (fn, args) => {
    const { data, error } = await client.rpc(fn, args);
    if (error) throw toDbError(error);
    return data;
  };
  return {
    async createPendingDonation(v) {
      const rows = await rpc('create_consented_donation', {
        p_attempt_id: v.attemptId,
        p_project_slug: v.projectSlug,
        p_part_slug: v.partSlug,
        p_amount_cents: v.amountCents,
        p_display_name: v.displayName,
        p_is_public: v.isPublic,
        p_terms_version: v.termsVersion,
      });
      return mapPending(rows[0]);
    },
    attachCheckoutSession: (donationId, sessionId) => rpc('attach_checkout_session', { p_donation_id: donationId, p_session_id: sessionId }),
    processStripeEvent: (e) => rpc('process_stripe_event', eventArgs(e)),
    async getDonationStatus(sessionId) {
      const rows = await rpc('get_donation_status', { p_session_id: sessionId });
      return mapStatus(rows?.[0]) ?? null;
    },
    requestSubscription: (v) => rpc('request_subscription', { p_slug: v.slug, p_email: v.email, p_part_slug: v.partSlug, p_hash: v.hash, p_url: v.url, p_consent: v.consent }),
    confirmSubscription: (hash) => rpc('confirm_subscription', { p_hash: hash }),
    unsubscribe: (id) => rpc('unsubscribe_member', { p_id: id }),
    claimEmailJobs: () => rpc('claim_email_jobs', { p_limit: 20 }),
    finishEmailJob: (id, lease, provider) => rpc('finish_email_job', { p_id: id, p_lease: lease, p_provider: provider }),
    async isEmailEligible(job) {
      const { data, error } = await client.from('subscribers').select('status,token_hash,token_expires_at').eq('id', job.subscriber_id).single();
      if (error) throw toDbError(error);
      if (job.kind === 'update') return data.status === 'active';
      const token = new URL(job.payload.url).hash.slice(7);
      const { hashToken } = await import('./subscriptions.js');
      return data.status === 'pending' && data.token_hash === hashToken(token) && Date.parse(data.token_expires_at) > Date.now();
    },
    async cancelEmailJob(id) {
      const { error } = await client.from('email_jobs').update({ state: 'cancelled' }).eq('id', id);
      if (error) throw toDbError(error);
    },
  };
}
