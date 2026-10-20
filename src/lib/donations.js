// Browser side of the donation flow. Payment details are entered on Stripe's hosted
// Checkout page; this module only asks our API to create a session.

const DRAFT_KEY = 'project-s6:donation-draft';

export class ApiError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

async function readJson(res) {
  try {
    return await res.json();
  } catch {
    return {};
  }
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
export async function createCheckout({ projectSlug, partId, amountCents, displayName, isPublic, attemptId, termsAccepted, termsVersion }) {
  let res;
  try {
    res = await fetch('/api/donations/checkout', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ projectSlug, partId: partId || null, amountCents, displayName: displayName || null, isPublic: Boolean(isPublic), attemptId, termsAccepted, termsVersion }),
    });
  } catch {
    throw new ApiError('Could not reach the payment server. Check your connection and try again.', 0);
  }
  const body = await readJson(res);
  if (!res.ok || !body.url) throw new ApiError(body.error || 'Checkout could not be started.', res.status);
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
    sessionStorage.setItem(DRAFT_KEY, JSON.stringify({ amountCents: draft.amountCents, partId: draft.partId, customAmount: draft.customAmount }));
  } catch {
    /* storage unavailable — draft simply isn't restored */
  }
}

export function loadDraft() {
  try {
    const raw = sessionStorage.getItem(DRAFT_KEY);
    if (!raw) return null;
    const draft = JSON.parse(raw);
    return { amountCents: Number.isSafeInteger(draft.amountCents) ? draft.amountCents : 2500, partId: typeof draft.partId === 'string' && /^[a-z0-9-]{1,60}$/.test(draft.partId) ? draft.partId : null, customAmount: draft.customAmount === true };
  } catch {
    return null;
  }
}
