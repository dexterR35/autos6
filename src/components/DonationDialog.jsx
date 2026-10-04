import { useEffect, useMemo, useRef, useState } from 'react';
import { ExternalLink, Info, Lock } from 'lucide-react';
import Modal from './Modal.jsx';
import DemoBadge from './DemoBadge.jsx';
import { DONATION_PRESETS_CENTS, formatCents, parseDollarsToCents, validateAmountCents } from '../lib/money.js';
import { createCheckout, newAttemptId } from '../lib/donations.js';
import { track, trackBeginCheckout } from '../lib/analytics.js';
import { useGarageState } from '../hooks/useGarageState.jsx';
import { useProjectData } from '../hooks/useProjectData.jsx';

const NAME_MAX = 40;

export default function DonationDialog() {
  const { donationOpen, closeDonation, draft, setDraft } = useGarageState();
  const { project, parts, isDemo, status } = useProjectData();
  const currency = project.currency ?? 'usd';
  const [custom, setCustom] = useState('');
  const [error, setError] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [demoDone, setDemoDone] = useState(false);
  const attemptId = useRef(null);

  const isPreset = DONATION_PRESETS_CENTS.includes(draft.amountCents);
  const customCents = custom ? parseDollarsToCents(custom) : null;
  const amountCents = custom ? customCents : draft.amountCents;
  const amountError = custom && customCents === null ? 'Enter an amount like 15 or 15.50.' : validateAmountCents(amountCents);
  const part = parts.find((p) => p.id === draft.partId) ?? null;
  const fundable = useMemo(() => parts.filter((p) => p.status !== 'bought' || p.id === draft.partId), [parts, draft.partId]);

  useEffect(() => {
    if (!donationOpen) return;
    // New attempt each time the dialog opens; reused for retries so the server never creates two sessions.
    attemptId.current = newAttemptId();
    setError(null);
    setSubmitting(false);
    setDemoDone(false);
    setCustom(isPreset || !draft.amountCents ? '' : (draft.amountCents / 100).toString());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [donationOpen]);

  const submit = async (e) => {
    e.preventDefault();
    if (submitting) return;
    if (amountError) {
      setError(amountError);
      return;
    }
    setDraft({ amountCents });
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
      const { url } = await createCheckout({
        projectSlug: project.slug,
        partId: draft.partId,
        amountCents,
        displayName: draft.displayName.trim(),
        isPublic: draft.isPublic,
        attemptId: attemptId.current,
      });
      window.location.assign(url);
    } catch (err) {
      setError(err.message);
      setSubmitting(false);
    }
  };

  const liveUnavailable = !isDemo && status !== 'ready';

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
            <p className="note note--warn" role="alert">Donations are unavailable right now: live campaign data could not be loaded.</p>
          )}

          <fieldset>
            <legend>Amount ({currency.toUpperCase()})</legend>
            <div className="presets presets--dialog">
              {DONATION_PRESETS_CENTS.map((c) => (
                <button
                  key={c}
                  type="button"
                  className={`preset ${!custom && draft.amountCents === c ? 'is-active' : ''}`}
                  aria-pressed={!custom && draft.amountCents === c}
                  onClick={() => {
                    setCustom('');
                    setDraft({ amountCents: c });
                    setError(null);
                  }}
                >
                  {formatCents(c, currency)}
                </button>
              ))}
            </div>
            <label className="field field--inline">
              <span>Custom amount</span>
              <span className="money-input">
                <span aria-hidden="true">$</span>
                <input
                  inputMode="decimal"
                  placeholder="Other"
                  value={custom}
                  aria-invalid={Boolean(custom && amountError)}
                  aria-describedby="amount-help"
                  onChange={(e) => {
                    setCustom(e.target.value);
                    setError(null);
                  }}
                />
              </span>
            </label>
            <p id="amount-help" className={`fine ${custom && amountError ? 'is-error' : ''}`}>
              {custom && amountError ? amountError : 'Minimum $1, maximum $10,000.'}
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
