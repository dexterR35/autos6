import { useEffect, useState } from 'react';
import { Cookie } from 'lucide-react';
import { ANALYTICS_ENABLED, OPEN_CONSENT_EVENT, getConsent, setConsent } from '../lib/analytics.js';

/**
 * Analytics consent (Consent Mode v2). Only rendered when GTM is configured. Until the
 * visitor chooses, analytics_storage stays "denied" (set in <head> before GTM loads).
 */
export default function ConsentBanner() {
  const [open, setOpen] = useState(() => ANALYTICS_ENABLED && getConsent() === null);

  useEffect(() => {
    if (!ANALYTICS_ENABLED) return undefined;
    const show = () => setOpen(true);
    window.addEventListener(OPEN_CONSENT_EVENT, show);
    return () => window.removeEventListener(OPEN_CONSENT_EVENT, show);
  }, []);

  if (!open) return null;
  const choose = (choice) => {
    setConsent(choice);
    setOpen(false);
  };
  return (
    <section className="consent panel" role="region" aria-labelledby="consent-title">
      <h2 id="consent-title"><Cookie aria-hidden="true" /> Analytics cookies</h2>
      <p>
        We’d like to use Google Analytics to see which parts and pages people look at. It’s off unless you allow it. No
        advertising cookies are used.
      </p>
      <div className="consent__actions">
        <button type="button" className="btn btn--ghost btn--sm" onClick={() => choose('denied')}>Reject</button>
        <button type="button" className="btn btn--primary btn--sm" onClick={() => choose('granted')}>Allow analytics</button>
      </div>
    </section>
  );
}
