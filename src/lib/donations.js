// Browser side of the donation flow. Payment details are entered on Stripe's hosted
// Checkout page; this module only asks our API to create a session.

const DRAFT_KEY = 'project-s6:donation-draft';

export class ApiError extends Error {
  constructor(message, status, details = {}) {
    super(message);
    this.status = status;
    this.code = details.code ?? null;
    this.remainingCents = Number.isSafeInteger(details.remainingCents) ? details.remainingCents : null;
  }
}

async function readJson(res) {
  try {
    return await res.json();
  } catch {
    return {};
  }
}

/** Opens Stripe's billing page (change card / cancel) for the monthly support behind a checkout. */
export async function openRecurringPortal(sessionId) {
  let res;
  try {
    res = await fetch('/api/recurring/manage', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sessionId }) });
  } catch {
    throw new ApiError('Could not reach the server. Check your connection and try again.', 0);
  }
  const body = await readJson(res);
  if (!res.ok || !body.url) throw new ApiError(body.error || 'Could not open the billing page.', res.status, body);
  const url = new URL(body.url);
  if (url.protocol !== 'https:' || url.hostname !== 'billing.stripe.com') throw new ApiError('Unexpected billing address.', 502);
  return body.url;
}

export function newAttemptId() {
  if (globalThis.crypto?.randomUUID) return crypto.randomUUID();
  // RFC4122-ish fallback for very old browsers
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

/** @returns {Promise<{url: string}>} */
export async function createCheckout({ projectSlug, partId, amountCents, displayName, isPublic, attemptId, termsAccepted, termsVersion, recurring = false, notifyUpdates = false }) {
  let res;
  try {
    res = await fetch('/api/donations/checkout', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ projectSlug, partId: partId || null, amountCents, displayName: displayName || null, isPublic: Boolean(isPublic), attemptId, termsAccepted, termsVersion, recurring: Boolean(recurring), notifyUpdates: Boolean(notifyUpdates) }),
    });
  } catch {
    throw new ApiError('Could not reach the payment server. Check your connection and try again.', 0);
  }
  const body = await readJson(res);
  if (!res.ok || !body.url) throw new ApiError(body.error || 'Checkout could not be started.', res.status, body);
  const checkoutUrl = new URL(body.url);
  if (checkoutUrl.protocol !== 'https:' || checkoutUrl.hostname !== 'checkout.stripe.com') throw new ApiError('Unexpected checkout address. Please try again.', 502);
  return body;
}

/** Privacy-safe status lookup scoped to an unguessable Checkout Session id. */
export async function fetchDonationStatus(sessionId) {
  const res = await fetch(`/api/donations/status?session_id=${encodeURIComponent(sessionId)}`);
  const body = await readJson(res);
  if (!res.ok) throw new ApiError(body.error || 'Status unavailable.', res.status);
  return body;
}

export function saveDraft(draft) {
  try {
    sessionStorage.setItem(DRAFT_KEY, JSON.stringify({ amountCents: draft.amountCents, partId: draft.partId, customAmount: draft.customAmount, monthly: draft.monthly === true }));
  } catch {
    /* storage unavailable — draft simply isn't restored */
  }
}

export function loadDraft() {
  try {
    const raw = sessionStorage.getItem(DRAFT_KEY);
    if (!raw) return null;
    const draft = JSON.parse(raw);
    return { amountCents: Number.isSafeInteger(draft.amountCents) ? draft.amountCents : 2500, partId: typeof draft.partId === 'string' && /^[a-z0-9-]{1,60}$/.test(draft.partId) ? draft.partId : null, customAmount: draft.customAmount === true, monthly: draft.monthly === true };
  } catch {
    return null;
  }
}
