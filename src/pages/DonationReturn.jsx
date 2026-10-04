import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { CircleCheck, CircleX, Clock, LoaderCircle } from 'lucide-react';
import { fetchDonationStatus } from '../lib/donations.js';
import { formatCents, parseDollarsToCents } from '../lib/money.js';
import { track, trackPurchaseOnce } from '../lib/analytics.js';
import { useGarageState } from '../hooks/useGarageState.jsx';
import { useProjectData } from '../hooks/useProjectData.jsx';

const POLL_MS = 2500;
const MAX_WAIT_MS = 60_000;

/**
 * Success return page. The redirect itself proves nothing: we show "pending" until the
 * backend (driven by the verified Stripe webhook) reports the donation as paid.
 */
export function DonationSuccess() {
  const [params] = useSearchParams();
  const sessionId = params.get('session_id');
  const { refreshSummary, isDemo } = useProjectData();
  const [state, setState] = useState({ phase: sessionId ? 'pending' : 'missing', data: null });
  const started = useRef(Date.now());

  const poll = useCallback(async () => {
    try {
      const data = await fetchDonationStatus(sessionId);
      if (data.status === 'paid' || data.status === 'refunded' || data.status === 'partially_refunded') {
        setState({ phase: 'paid', data });
        refreshSummary();
        // Only after server-confirmed payment; deduplicated across reloads.
        trackPurchaseOnce({ sessionId, amountCents: data.amountCents, currency: data.currency, partName: data.partName });
        return true;
      }
      if (data.status === 'failed' || data.status === 'expired') {
        setState({ phase: 'failed', data });
        return true;
      }
      setState({ phase: data.status === 'processing' ? 'processing' : 'pending', data });
    } catch (err) {
      if (err.status === 404 || err.status === 400) {
        setState({ phase: 'notfound', data: null });
        return true;
      }
      // network / server hiccup: keep waiting
    }
    if (Date.now() - started.current > MAX_WAIT_MS) {
      setState((s) => ({ ...s, phase: s.phase === 'processing' ? 'processing' : 'slow' }));
      return true;
    }
    return false;
  }, [sessionId, refreshSummary]);

  useEffect(() => {
    if (!sessionId || isDemo) return undefined;
    let timer;
    let stopped = false;
    const tick = async () => {
      const done = await poll();
      if (!done && !stopped) timer = setTimeout(tick, POLL_MS);
    };
    tick();
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [sessionId, poll, isDemo]);

  const retry = () => {
    started.current = Date.now();
    setState((s) => ({ ...s, phase: 'pending' }));
    const tick = async () => {
      const done = await poll();
      if (!done) setTimeout(tick, POLL_MS);
    };
    tick();
  };

  const d = state.data;
  const amount = d ? formatCents(d.amountCents, d.currency) : null;

  return (
    <div className="page page--narrow">
      <div className="panel return-card" role="status" aria-live="polite">
        {isDemo ? (
          <>
            <h1>Demo mode</h1>
            <p>No payments are processed in demo mode, so there is nothing to confirm here.</p>
          </>
        ) : state.phase === 'missing' || state.phase === 'notfound' ? (
          <>
            <CircleX className="return-card__icon is-bad" aria-hidden="true" />
            <h1>We couldn’t find that checkout</h1>
            <p>If you completed a payment, Stripe has emailed you a receipt. Your contribution will appear once it’s confirmed.</p>
          </>
        ) : state.phase === 'paid' ? (
          <>
            <CircleCheck className="return-card__icon is-good" aria-hidden="true" />
            <h1>Thank you!</h1>
            <p>
              Your contribution of <strong>{amount}</strong>
              {d.partName ? <> toward the <strong>{d.partName}</strong></> : ' to the restoration fund'} is confirmed.
            </p>
          </>
        ) : state.phase === 'failed' ? (
          <>
            <CircleX className="return-card__icon is-bad" aria-hidden="true" />
            <h1>Payment not completed</h1>
            <p>The payment {d?.status === 'expired' ? 'session expired' : 'failed'}. No money was taken, and you can try again.</p>
          </>
        ) : state.phase === 'processing' ? (
          <>
            <Clock className="return-card__icon" aria-hidden="true" />
            <h1>Payment processing</h1>
            <p>Your bank is still processing this payment ({amount}). It counts toward the total once it clears. This can take a few days for some payment methods.</p>
          </>
        ) : state.phase === 'slow' ? (
          <>
            <Clock className="return-card__icon" aria-hidden="true" />
            <h1>Still waiting for confirmation</h1>
            <p>Stripe hasn’t confirmed the payment yet. This usually takes seconds but can take a few minutes. You don’t need to pay again.</p>
            <button type="button" className="btn btn--primary" onClick={retry}>Check again</button>
            <p className="fine">If it still doesn’t confirm, contact the project owner with the time of your payment. Stripe has emailed you a receipt.</p>
          </>
        ) : (
          <>
            <LoaderCircle className="return-card__icon spin" aria-hidden="true" />
            <h1>Confirming your payment…</h1>
            <p>Waiting for Stripe to confirm. This page updates automatically.</p>
          </>
        )}
        <Link className="btn btn--ghost" to="/">Back to the garage</Link>
      </div>
    </div>
  );
}

export function DonationCancel() {
  const [params] = useSearchParams();
  const { setDraft, openDonation } = useGarageState();
  const { partsById } = useProjectData();
  const partId = params.get('part');
  const amountCents = parseDollarsToCents(params.get('amount') ?? '');
  const part = partId ? partsById[partId] : null;

  useEffect(() => {
    // Preserve the visitor's choices so "try again" starts where they left off.
    const patch = {};
    if (part) patch.partId = part.id;
    if (amountCents) patch.amountCents = amountCents;
    if (Object.keys(patch).length) setDraft(patch);
    track('donation_cancel', { part_id: part?.id ?? null });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [partId, amountCents, Boolean(part)]);

  return (
    <div className="page page--narrow">
      <div className="panel return-card">
        <CircleX className="return-card__icon" aria-hidden="true" />
        <h1>Checkout cancelled</h1>
        <p>No payment was taken and campaign totals haven’t changed.{part ? ` Your selection (${part.name}) has been kept.` : ''}</p>
        <div className="dialog-actions">
          <Link className="btn btn--ghost" to="/">Back to the garage</Link>
          <button type="button" className="btn btn--donate" onClick={() => openDonation()}>Try again</button>
        </div>
      </div>
    </div>
  );
}
