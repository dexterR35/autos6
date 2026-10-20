import { useEffect, useMemo, useRef, useState } from 'react';
import { ExternalLink, Info, Lock } from 'lucide-react';
import Modal from './Modal.jsx';
import DemoBadge from './DemoBadge.jsx';
import { DONATION_PRESETS_CENTS, formatCents, parseDollarsToCents, validateAmountCents } from '../lib/money.js';
import { createCheckout, newAttemptId } from '../lib/donations.js';
import { track, trackBeginCheckout } from '../lib/analytics.js';
import { useGarageState } from '../hooks/useGarageState.jsx';
import { useProjectData } from '../hooks/useProjectData.jsx';
import { Link } from 'react-router-dom';
import AmountPicker from './AmountPicker.jsx';
import PartProgress from './PartProgress.jsx';
import { POLICY_VERSION } from '../lib/policies.js';

const NAME_MAX = 40;

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
    setCustom(draft.customAmount ? '' : isPreset || !draft.amountCents ? null : (draft.amountCents / 100).toString());
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
          <p>
            This site is running with demo fixtures. In live mode, “Continue to secure checkout” sends you to Stripe’s hosted
            payment page for <strong>{formatCents(amountCents, currency)}</strong>
            {part ? <> toward the <strong>{part.name}</strong></> : <> to the general restoration fund</>}. Totals only change after
            Stripe confirms the payment.
          </p>
          <div className="dialog-actions">
            <button type="button" className="btn btn--ghost" onClick={() => setDemoDone(false)}>Back</button>
            <button type="button" className="btn btn--primary" onClick={closeDonation}>Done</button>
          </div>
        </div>
      ) : (
        <form className="donate-form" onSubmit={submit} noValidate>
          {isDemo && (
            <p className="note"><Info aria-hidden="true" /> Demo mode: you can try the form, but no payment will be taken.</p>
          )}
          {liveUnavailable && (
            <p className="note note--warn" role="alert">{!legalReady ? 'Donations are not open yet. The project owner is completing the public terms and contact details.' : 'Donations are unavailable right now: live campaign data could not be loaded.'}</p>
          )}

          <fieldset>
            <legend>Amount ({currency.toUpperCase()})</legend>
            <AmountPicker amountCents={draft.amountCents} currency={currency} custom={custom} onCustom={(value) => { setCustom(value); setError(null); }} onChange={(value) => { setCustom(null); setDraft({ amountCents: value, customAmount: false }); setError(null); }} />
            <p id="amount-help" className={`fine ${custom !== null && amountError ? 'is-error' : ''}`}>
              {custom !== null && amountError ? amountError : 'Minimum $1, maximum $10,000 per donation.'}
            </p>
          </fieldset>

          <label className="field">
            <span>Put it toward</span>
            <select value={draft.partId ?? ''} onChange={(e) => setDraft({ partId: e.target.value || null })}>
              <option value="">General restoration fund</option>
              {fundable.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} — {formatCents(p.estimateCents, currency)} estimate
                </option>
              ))}
            </select>
          </label>
          {part && (
            <p className="fine">
              A part contribution supports restoring the {part.name.toLowerCase()}. It isn’t a parts purchase, and the owner marks
              parts as bought only after buying them.
            </p>
          )}
          {part && <PartProgress part={part} currency={currency} />}
          <p className="fine">Every contribution also moves the $10,000 campaign forward. After a part or the campaign is funded, additional support helps with fitting, running costs and future work.</p>

          <label className="field">
            <span>Display name <span className="muted">(optional)</span></span>
            <input
              value={draft.displayName}
              maxLength={NAME_MAX}
              autoComplete="nickname"
              onChange={(e) => setDraft({ displayName: e.target.value })}
            />
          </label>
          <label className="check">
            <input type="checkbox" checked={draft.isPublic} onChange={(e) => setDraft({ isPublic: e.target.checked })} />
            <span>Show my display name and amount on the public supporters list</span>
          </label>
          <label className="check consent-check">
            <input type="checkbox" checked={termsAccepted} onChange={(e) => setTermsAccepted(e.target.checked)} />
            <span>I agree to the <Link to="/terms" target="_blank" rel="noopener noreferrer">donation terms</Link> and have read the <Link to="/privacy" target="_blank" rel="noopener noreferrer">privacy notice</Link>. This is a voluntary contribution to a personal restoration.</span>
          </label>

          {error && <p className="form-error" role="alert">{error}</p>}

          <div className="dialog-actions">
            <button type="button" className="btn btn--ghost" onClick={closeDonation}>Cancel</button>
            <button type="submit" className="btn btn--donate" disabled={submitting || liveUnavailable} aria-busy={submitting}>
              {isDemo ? <Info aria-hidden="true" /> : <Lock aria-hidden="true" />}
              {submitting
                ? 'Opening checkout…'
                : `${isDemo ? 'Preview checkout' : 'Continue to secure checkout'}${amountCents && !amountError ? ` · ${formatCents(amountCents, currency)}` : ''}`}
              {!isDemo && !submitting && <ExternalLink aria-hidden="true" className="ext" />}
            </button>
          </div>
          <p className="fine">
            Payments are handled on Stripe’s hosted checkout; card details never touch this site. Project S6 is a personal
            restoration project, not a registered charity.
          </p>
        </form>
      )}
    </Modal>
  );
}
