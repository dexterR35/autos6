import { useEffect, useMemo, useRef, useState } from 'react';
import { Lock } from 'lucide-react';
import Modal from './Modal.jsx';
import DemoBadge from './DemoBadge.jsx';
import { DONATION_PRESETS_CENTS, formatCents, parseDollarsToCents, validateAmountCents } from '../lib/money.js';
import { createCheckout, newAttemptId } from '../lib/donations.js';
import { track, trackBeginCheckout } from '../lib/analytics.js';
import { useGarageState } from '../hooks/useGarageState.jsx';
import { useProjectData } from '../hooks/useProjectData.jsx';
import { Link } from 'react-router-dom';
import AmountPicker from './AmountPicker.jsx';
import FundMeter from './FundMeter.jsx';
import { POLICY_VERSION } from '../lib/policies.js';

const NAME_MAX = 40;
// 1500 → "15", 1550 → "15.50": the text a visitor would type into the custom field.
const centsToInput = (cents) => (cents % 100 ? (cents / 100).toFixed(2) : String(cents / 100));

export default function DonationDialog() {
  const { donationOpen, closeDonation, draft, setDraft } = useGarageState();
  const { project, parts, isDemo, status } = useProjectData();
  const currency = project.currency ?? 'usd';
  const [custom, setCustom] = useState(null);
  const [termsAccepted, setTermsAccepted] = useState(false);
  const [error, setError] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [demoDone, setDemoDone] = useState(false);
  const attemptId = useRef(null);
  const submittedPayload = useRef(null);

  const isPreset = DONATION_PRESETS_CENTS.includes(draft.amountCents);
  const customCents = custom !== null ? parseDollarsToCents(custom) : null;
  const amountCents = custom !== null ? customCents : draft.amountCents;
  const amountError = custom !== null && customCents === null ? 'Enter an amount like 15 or 15.50.' : validateAmountCents(amountCents);
  const part = parts.find((p) => p.id === draft.partId) ?? null;
  const fundable = useMemo(() => parts.filter((p) => p.status !== 'bought' || p.id === draft.partId), [parts, draft.partId]);

  useEffect(() => {
    if (!donationOpen) return;
    // New attempt each time the dialog opens; reused for retries so the server never creates two sessions.
    attemptId.current = newAttemptId();
    submittedPayload.current = null;
    setTermsAccepted(false);
    setError(null);
    setSubmitting(false);
    setDemoDone(false);
    // A custom amount survives a cancelled checkout instead of reopening as a blank field.
    const savedAmount = Number.isSafeInteger(draft.amountCents) && draft.amountCents > 0 ? centsToInput(draft.amountCents) : null;
    setCustom(draft.customAmount ? savedAmount ?? '' : isPreset ? null : savedAmount);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [donationOpen]);

  const submit = async (e) => {
    e.preventDefault();
    if (submitting) return;
    if (amountError) {
      setError(amountError);
      return;
    }
    if (!termsAccepted) { setError('Please accept the donation terms and privacy notice.'); return; }
    setDraft({ amountCents, customAmount: custom !== null });
    if (isDemo) {
      // Not a real checkout: keep it out of GA4 ecommerce reports.
      track('donation_demo_preview', { value: amountCents / 100, currency: currency.toUpperCase(), part_id: part?.id ?? null });
      setDemoDone(true);
      return;
    }
    trackBeginCheckout({ part, amountCents, currency, demo: false });
    setSubmitting(true);
    setError(null);
    try {
      const fingerprint = JSON.stringify([draft.partId, amountCents, draft.displayName.trim(), draft.isPublic]);
      if (submittedPayload.current && submittedPayload.current !== fingerprint) attemptId.current = newAttemptId();
      submittedPayload.current = fingerprint;
      const { url } = await createCheckout({
        projectSlug: project.slug,
        partId: draft.partId,
        amountCents,
        displayName: draft.displayName.trim(),
        isPublic: draft.isPublic,
        attemptId: attemptId.current,
        termsAccepted,
        termsVersion: POLICY_VERSION,
      });
      window.location.assign(url);
    } catch (err) {
      setError(err.message);
      setSubmitting(false);
    }
  };

  const legalReady = Boolean(import.meta.env.VITE_OPERATOR_NAME && import.meta.env.VITE_CONTACT_EMAIL);
  const liveUnavailable = !isDemo && (status !== 'ready' || !legalReady);

  return (
    <Modal open={donationOpen} onClose={closeDonation} title="Support the restoration" labelledBy="donate-title" className="donate-modal">
      {demoDone ? (
        <div className="demo-result" role="status">
          <DemoBadge>Demo mode</DemoBadge>
          <h3>No payment was taken</h3>
          <p className="muted">
            Live checkout would open Stripe for <strong>{formatCents(amountCents, currency)}</strong>
            {part ? <> toward <strong>{part.name}</strong></> : <> to the general fund</>}.
          </p>
          <div className="dialog-actions">
            <button type="button" className="btn btn--ghost" onClick={() => setDemoDone(false)}>Back</button>
            <button type="button" className="btn btn--primary" onClick={closeDonation}>Done</button>
          </div>
        </div>
      ) : (
        <form className="donate-form" onSubmit={submit} noValidate>
          {isDemo && <p className="form-note">Demo mode: no payment is taken.</p>}
          {liveUnavailable && <p className="form-note form-note--warn" role="alert">{!legalReady ? 'Donations open soon.' : 'Donations are unavailable right now.'}</p>}

          <fieldset>
            <legend className="form-label">Amount</legend>
            <AmountPicker amountCents={draft.amountCents} currency={currency} custom={custom} onCustom={(value) => { setCustom(value); setError(null); }} onChange={(value) => { setCustom(null); setDraft({ amountCents: value, customAmount: false }); setError(null); }} />
            {custom !== null && amountError && <p id="amount-help" className="fine is-error">{amountError}</p>}
          </fieldset>

          <label className="field">
            <span>For</span>
            <select value={draft.partId ?? ''} onChange={(e) => setDraft({ partId: e.target.value || null })}>
              <option value="">General fund</option>
              {fundable.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </label>
          {part && <FundMeter label={part.name} raisedCents={part.raisedCents} goalCents={part.estimateCents} currency={currency} />}

          <label className="field">
            <span>Display name (optional)</span>
            <input value={draft.displayName} maxLength={NAME_MAX} autoComplete="nickname" onChange={(e) => setDraft({ displayName: e.target.value })} />
          </label>
          <label className="check">
            <input type="checkbox" checked={draft.isPublic} onChange={(e) => setDraft({ isPublic: e.target.checked })} />
            <span>Show me on the supporter wall</span>
          </label>
          <label className="check consent-check">
            <input type="checkbox" checked={termsAccepted} onChange={(e) => setTermsAccepted(e.target.checked)} />
            <span>I agree to the <Link to="/terms" target="_blank" rel="noopener noreferrer">terms</Link> and <Link to="/privacy" target="_blank" rel="noopener noreferrer">privacy notice</Link></span>
          </label>

          {error && <p className="form-error" role="alert">{error}</p>}

          <div className="dialog-actions">
            <button type="button" className="btn btn--ghost" onClick={closeDonation}>Cancel</button>
            <button type="submit" className="btn btn--donate" disabled={submitting || liveUnavailable} aria-busy={submitting}>
              {!isDemo && <Lock aria-hidden="true" />}
              {submitting
                ? 'Opening checkout…'
                : `${isDemo ? 'Preview' : 'Donate'}${amountCents && !amountError ? ` ${formatCents(amountCents, currency)}` : ''}`}
            </button>
          </div>
          <p className="form-footnote">Secure Stripe checkout · A contribution, not a parts purchase · Not tax-deductible</p>
        </form>
      )}
    </Modal>
  );
}
