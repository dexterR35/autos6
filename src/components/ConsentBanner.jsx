import { useEffect, useState } from 'react';
import { Cookie } from 'lucide-react';
import {
  ANALYTICS_ENABLED, CONSENT_ENABLED, MARKETING_ENABLED, MARKETING_VENDORS, OPEN_CONSENT_EVENT,
  getConsent, getMarketingConsent, needsConsentChoice, setConsentChoices,
} from '../lib/analytics.js';

/**
 * Cookie choices (Consent Mode v2). Only rendered when analytics or ad pixels are
 * configured. Rejecting is as easy as accepting, and nothing optional loads first.
 */
export default function ConsentBanner() {
  const [open, setOpen] = useState(() => CONSENT_ENABLED && needsConsentChoice());
  const [custom, setCustom] = useState(false);
  const [choice, setChoice] = useState({ analytics: false, marketing: false });

  useEffect(() => {
    if (!CONSENT_ENABLED) return undefined;
    const show = () => {
      setChoice({ analytics: getConsent() === 'granted', marketing: getMarketingConsent() === 'granted' });
      setCustom(true);
      setOpen(true);
    };
    window.addEventListener(OPEN_CONSENT_EVENT, show);
    return () => window.removeEventListener(OPEN_CONSENT_EVENT, show);
  }, []);

  if (!open) return null;
  const save = (next) => {
    setConsentChoices({ analytics: ANALYTICS_ENABLED && next.analytics, marketing: MARKETING_ENABLED && next.marketing });
    setOpen(false);
  };
  const purposes = [ANALYTICS_ENABLED && 'measure visits', MARKETING_ENABLED && 'measure our ads'].filter(Boolean).join(' and ');
  return (
    <section className="consent panel" role="region" aria-labelledby="consent-title">
      <h2 id="consent-title"><Cookie aria-hidden="true" /> Cookies</h2>
      <p>Optional cookies help us {purposes}. They stay off unless you allow them.</p>
      {custom && (
        <div className="consent__choices">
          {ANALYTICS_ENABLED && (
            <label className="check"><input type="checkbox" checked={choice.analytics} onChange={(e) => setChoice((c) => ({ ...c, analytics: e.target.checked }))} /><span>Analytics (Google Analytics)</span></label>
          )}
          {MARKETING_ENABLED && (
            <label className="check"><input type="checkbox" checked={choice.marketing} onChange={(e) => setChoice((c) => ({ ...c, marketing: e.target.checked }))} /><span>Marketing ({MARKETING_VENDORS.join(', ')})</span></label>
          )}
        </div>
      )}
      <div className="consent__actions">
        {custom
          ? <button type="button" className="btn btn--ghost btn--sm" onClick={() => save(choice)}>Save choices</button>
          : <button type="button" className="btn btn--ghost btn--sm" onClick={() => setCustom(true)}>Choose</button>}
        <button type="button" className="btn btn--ghost btn--sm" onClick={() => save({ analytics: false, marketing: false })}>Reject all</button>
        <button type="button" className="btn btn--primary btn--sm" onClick={() => save({ analytics: true, marketing: true })}>Accept all</button>
      </div>
    </section>
  );
}
