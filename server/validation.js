import { validateAmountCents } from '../src/lib/money.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SLUG_RE = /^[a-z0-9-]{1,60}$/;
export const SESSION_ID_RE = /^cs_(test|live)_[A-Za-z0-9]{10,200}$/;

/** Validate and normalise POST /api/donations/checkout input. */
export function validateCheckoutBody(body, { minCents, maxCents }) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return { error: 'Invalid request body.' };
  const { projectSlug, partId = null, amountCents, displayName = null, isPublic = false, attemptId } = body;

  if (typeof projectSlug !== 'string' || !SLUG_RE.test(projectSlug)) return { error: 'Unknown project.' };
  if (partId !== null && (typeof partId !== 'string' || !SLUG_RE.test(partId))) return { error: 'Unknown part.' };
  if (typeof amountCents !== 'number') return { error: 'Enter a valid amount.' };
  const amountError = validateAmountCents(amountCents, { min: minCents, max: maxCents });
  if (amountError) return { error: amountError };
  if (typeof attemptId !== 'string' || !UUID_RE.test(attemptId)) return { error: 'Invalid checkout attempt.' };
  if (typeof isPublic !== 'boolean') return { error: 'Invalid recognition preference.' };

  let name = null;
  if (displayName !== null) {
    if (typeof displayName !== 'string') return { error: 'Invalid display name.' };
    // strip control characters and collapse whitespace
    name = displayName.replace(/[\u0000-\u001f\u007f]/g, '').replace(/\s+/g, ' ').trim();
    if (name.length > 40) return { error: 'Display name must be 40 characters or fewer.' };
    if (!name) name = null;
  }

  return {
    value: { projectSlug, partSlug: partId, amountCents, displayName: name, isPublic, attemptId: attemptId.toLowerCase() },
  };
}
