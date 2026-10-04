// Google Tag Manager data layer + Consent Mode v2.
//
// The GTM container itself is injected into <head> at build time by vite/seoPlugin.js
// (only when VITE_GTM_ID is set), preceded by a consent default of "denied". This module
// only pushes events and consent updates; nothing here loads third-party code.
//
// Privacy rules: never push names, emails, free text other than search terms, or Stripe
// ids. Money is sent in major units (dollars) as GA4 expects.

const CONSENT_KEY = 'project-s6:analytics-consent'; // 'granted' | 'denied'
const PURCHASE_KEY = 'project-s6:tracked-purchases';

const env = import.meta.env ?? {};
export const GTM_ID = /^GTM-[A-Z0-9]{4,12}$/.test(env.VITE_GTM_ID || '') ? env.VITE_GTM_ID : '';
export const ANALYTICS_ENABLED = Boolean(GTM_ID);

function dataLayer() {
  if (typeof window === 'undefined') return null;
  window.dataLayer = window.dataLayer || [];
  return window.dataLayer;
}

// gtag-style call (Consent Mode commands must be pushed as an `arguments` object).
function gtag() {
  // eslint-disable-next-line prefer-rest-params
  dataLayer()?.push(arguments);
}

/** Push an event to the data layer. Clears ecommerce first, as Google recommends. */
export function track(event, params = {}) {
  const dl = dataLayer();
  if (!dl) return;
  if (params.ecommerce) dl.push({ ecommerce: null });
  dl.push({ event, ...params });
}

export function trackPageView({ path, title, location }) {
  track('virtual_page_view', { page_path: path, page_title: title, page_location: location });
}

// ---------------------------------------------------------------- consent
export function getConsent() {
  try {
    return localStorage.getItem(CONSENT_KEY); // null when the visitor hasn't chosen
  } catch {
    return null;
  }
}

export function setConsent(choice) {
  const granted = choice === 'granted';
  try {
    localStorage.setItem(CONSENT_KEY, granted ? 'granted' : 'denied');
  } catch {
    /* storage blocked: choice applies to this page view only */
  }
  // Only analytics is ever requested; advertising signals stay denied.
  gtag('consent', 'update', {
    analytics_storage: granted ? 'granted' : 'denied',
    ad_storage: 'denied',
    ad_user_data: 'denied',
    ad_personalization: 'denied',
  });
  track('consent_update', { analytics_consent: granted ? 'granted' : 'denied' });
}

export const OPEN_CONSENT_EVENT = 'project-s6:open-consent';
export const openConsentSettings = () => window.dispatchEvent(new Event(OPEN_CONSENT_EVENT));

// ---------------------------------------------------------------- donation funnel (GA4 ecommerce)
const dollars = (cents) => Math.round(cents) / 100;

export function donationItem(part, amountCents) {
  return {
    item_id: part?.id ?? 'general-fund',
    item_name: part?.name ?? 'General restoration fund',
    item_category: part ? `part_${part.status}` : 'general',
    price: dollars(amountCents),
    quantity: 1,
  };
}

export function trackBeginCheckout({ part, amountCents, currency, demo }) {
  track('begin_checkout', {
    demo_mode: Boolean(demo),
    ecommerce: { currency: currency.toUpperCase(), value: dollars(amountCents), items: [donationItem(part, amountCents)] },
  });
}

async function sha256Hex(text) {
  const bytes = new TextEncoder().encode(text);
  const hash = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Fire `purchase` once per confirmed donation. transaction_id is a hash of the Checkout
 * Session id (which doubles as the status-lookup token, so it's never sent raw).
 */
export async function trackPurchaseOnce({ sessionId, amountCents, currency, partName }) {
  if (!sessionId || !globalThis.crypto?.subtle) return false;
  const txId = `s6-${(await sha256Hex(sessionId)).slice(0, 24)}`;
  let seen = [];
  try {
    seen = JSON.parse(localStorage.getItem(PURCHASE_KEY) || '[]');
  } catch {
    seen = [];
  }
  if (seen.includes(txId)) return false;
  track('purchase', {
    ecommerce: {
      transaction_id: txId,
      currency: currency.toUpperCase(),
      value: dollars(amountCents),
      items: [{ item_id: partName ? 'part' : 'general-fund', item_name: partName ?? 'General restoration fund', price: dollars(amountCents), quantity: 1 }],
    },
  });
  try {
    localStorage.setItem(PURCHASE_KEY, JSON.stringify([...seen, txId].slice(-50)));
  } catch {
    /* duplicate protection is best effort without storage */
  }
  return true;
}
