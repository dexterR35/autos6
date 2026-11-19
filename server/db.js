// Data access for the payment API, backed by Supabase RPCs (service role, server-only).
// Every write goes through a Postgres function so each operation is one transaction.

export class DbError extends Error {
  constructor(code, message) {
    super(message || code);
    this.code = code; // e.g. project_not_found, part_not_found, attempt_mismatch, donation_not_found
  }
}

const KNOWN = ['project_not_found', 'part_not_found', 'part_closed', 'amount_exceeds_remaining', 'attempt_mismatch', 'donation_not_found', 'recurring_not_found', 'recurring_mismatch', 'below_minimum', 'invalid_amount'];
export function toDbError(err) {
  const msg = err?.message || '';
  const code = KNOWN.find((k) => msg.includes(k)) || 'db_error';
  const e = new DbError(code, msg);
  // 'amount_exceeds_remaining:5000' carries what is left of the part's goal.
  if (code === 'amount_exceeds_remaining') e.remainingCents = Number(msg.match(/amount_exceeds_remaining:(\d+)/)?.[1] ?? 0);
  if (code === 'below_minimum') {
    const [, min, currency] = msg.match(/below_minimum:(\d+):([a-z]{3})/) ?? [];
    e.minimumCents = Number(min ?? 100);
    e.currency = currency ?? 'usd';
  }
  return e;
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

export const mapRecurring = (r) => ({
  recurringId: r.recurring_id,
  currency: r.currency,
  partSlug: r.part_slug,
  partName: r.part_name,
  amountCents: Number(r.amount_cents),
  checkoutSessionId: r.stripe_checkout_session_id,
  status: r.status,
});

export const recurringArgs = (e) => ({
  p_event_id: e.eventId,
  p_type: e.type,
  p_livemode: e.livemode,
  p_recurring_id: e.recurringId ?? null,
  p_session_id: e.sessionId ?? null,
  p_subscription_id: e.subscriptionId ?? null,
  p_customer_id: e.customerId ?? null,
  p_subscription_status: e.subscriptionStatus ?? null,
  p_invoice_id: e.invoiceId ?? null,
  p_payment_intent_id: e.paymentIntentId ?? null,
  p_amount_paid: e.amountPaid ?? null,
  p_currency: e.currency ?? null,
  p_email: e.email ?? null,
});

export const mapPartCard = (part, funding, project) => part && ({
  slug: part.slug,
  name: part.name,
  status: part.status,
  goalCents: Number(part.estimate_cents),
  raisedCents: Number(funding?.raised_cents ?? 0),
  supporters: Number(funding?.donation_count ?? 0),
  coverUrl: part.thumbnail_url || part.image_urls?.[0] || null,
  currency: project.currency,
  projectTitle: project.title,
});

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
      const rows = await rpc('create_checkout_donation', {
        p_attempt_id: v.attemptId,
        p_project_slug: v.projectSlug,
        p_part_slug: v.partSlug,
        p_amount_cents: v.amountCents,
        p_display_name: v.displayName,
        p_is_public: v.isPublic,
        p_terms_version: v.termsVersion,
        p_notify_updates: Boolean(v.notifyUpdates),
      });
      return mapPending(rows[0]);
    },
    async createRecurring(v) {
      const rows = await rpc('create_recurring_support', {
        p_attempt_id: v.attemptId, p_project_slug: v.projectSlug, p_part_slug: v.partSlug, p_amount_cents: v.amountCents,
        p_display_name: v.displayName, p_is_public: v.isPublic, p_terms_version: v.termsVersion, p_notify_updates: Boolean(v.notifyUpdates),
      });
      return mapRecurring(rows[0]);
    },
    attachRecurringSession: (id, sessionId) => rpc('attach_recurring_session', { p_recurring_id: id, p_session_id: sessionId }),
    processRecurringEvent: (e) => rpc('process_recurring_event', recurringArgs(e)),
    async getRecurringBySession(sessionId) {
      const rows = await rpc('get_recurring_by_session', { p_session_id: sessionId });
      const r = rows?.[0];
      return r ? { status: r.status, amountCents: Number(r.amount_cents), currency: r.currency, partName: r.part_name, customerId: r.stripe_customer_id } : null;
    },
    async getPartCard(projectSlug, partSlug) {
      const { data: project, error: e1 } = await client.from('projects').select('id,title,currency').eq('slug', projectSlug).eq('is_published', true).maybeSingle();
      if (e1) throw toDbError(e1);
      if (!project) return null;
      const { data: part, error: e2 } = await client.from('parts').select('slug,name,status,estimate_cents,thumbnail_url,image_urls').eq('project_id', project.id).eq('slug', partSlug).maybeSingle();
      if (e2) throw toDbError(e2);
      if (!part) return null;
      const funding = (await rpc('get_part_funding', { p_slug: projectSlug })).find((f) => f.part_slug === partSlug);
      return mapPartCard(part, funding, project);
    },
    processDisputeEvent: (e) => rpc('process_dispute_event', { p_event_id: e.eventId, p_type: e.type, p_livemode: e.livemode, p_payment_intent_id: e.paymentIntentId, p_dispute_status: e.disputeStatus }),
    getRecurringPortalCustomer: (sessionId) => rpc('get_recurring_portal_customer', { p_session_id: sessionId }),
    claimOwnerDigests: (date) => rpc('claim_owner_digests', { p_date: date }),
    finishOwnerDigest: (projectId, date, provider) => rpc('finish_owner_digest', { p_project_id: projectId, p_date: date, p_provider: provider }),
    attachCheckoutSession: (donationId, sessionId) => rpc('attach_checkout_session', { p_donation_id: donationId, p_session_id: sessionId }),
    processStripeEvent: (e) => rpc('process_stripe_event', eventArgs(e)),
    async getDonationStatus(sessionId) {
      const rows = await rpc('get_donation_status', { p_session_id: sessionId });
      return mapStatus(rows?.[0]) ?? null;
    },
    async listPartSlugs(projectSlug) {
      const rows = await rpc('get_part_funding', { p_slug: projectSlug });
      return (rows ?? []).map((r) => r.part_slug);
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
