// Google Tag Manager data layer, Consent Mode v2 and the ad pixels (pixels.js).
//
// The GTM container is injected into <head> at build time by vite/seoPlugin.js (only when
// VITE_GTM_ID is set), preceded by a consent default of "denied". Two separate choices:
//   • analytics — GTM/GA4 measurement (analytics_storage)
//   • marketing — Meta, TikTok and Google Ads pixels, and ad tags inside GTM (ad_* signals)
// Nothing optional loads before the matching choice.
//
// Privacy rules: never push names, emails, free text other than catalogue part names, or
// Stripe ids. Money is sent in major units (dollars) as GA4 and the pixels expect.

import { PIXEL_VENDORS, PIXELS_CONFIGURED, pixelBeginCheckout, pixelDonation, pixelPageView, pixelViewPart, pixelsStarted, startPixels } from './pixels.js';
import { isTrackableUrl } from './urlScrub.js';

const CONSENT_KEY = 'project-s6:analytics-consent'; // 'granted' | 'denied'
const MARKETING_KEY = 'project-s6:marketing-consent'; // 'granted' | 'denied'
const PURCHASE_KEY = 'project-s6:tracked-purchases';

const env = import.meta.env ?? {};
export const GTM_ID = /^GTM-[A-Z0-9]{4,12}$/.test(env.VITE_GTM_ID || '') ? env.VITE_GTM_ID : '';
export const ANALYTICS_ENABLED = Boolean(GTM_ID);
// Set VITE_GTM_MARKETING=true when the GTM container also holds ad tags or pixels.
export const GTM_MARKETING = Boolean(GTM_ID) && env.VITE_GTM_MARKETING === 'true';
export const MARKETING_ENABLED = PIXELS_CONFIGURED || GTM_MARKETING;
export const MARKETING_VENDORS = PIXEL_VENDORS.length ? PIXEL_VENDORS : GTM_MARKETING ? ['ad partners'] : [];
export const CONSENT_ENABLED = ANALYTICS_ENABLED || MARKETING_ENABLED;

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
  pixelPageView();
}

// ---------------------------------------------------------------- consent
const read = (key) => {
  try {
    return localStorage.getItem(key); // null when the visitor hasn't chosen
  } catch {
    return null;
  }
};
export const getConsent = () => read(CONSENT_KEY);
export const getMarketingConsent = () => read(MARKETING_KEY);

/** True when a configured category still has no recorded choice. */
export const needsConsentChoice = () => (ANALYTICS_ENABLED && getConsent() === null) || (MARKETING_ENABLED && getMarketingConsent() === null);

/** Start whatever the visitor has allowed, unless the address holds secrets. */
export function startTrackers() {
  if (typeof window === 'undefined' || !isTrackableUrl()) return false;
  const analytics = getConsent() === 'granted';
  const marketing = getMarketingConsent() === 'granted';
  if (analytics || (GTM_MARKETING && marketing)) window.__s6StartAnalytics?.();
  return marketing ? startPixels() : false;
}

export function setConsentChoices({ analytics = false, marketing = false }) {
  const before = { analytics: getConsent(), marketing: getMarketingConsent() };
  const wasRunning = Boolean(window.__s6GtmStarted) || pixelsStarted();
  try {
    if (ANALYTICS_ENABLED || analytics) localStorage.setItem(CONSENT_KEY, analytics ? 'granted' : 'denied');
    if (MARKETING_ENABLED || marketing) localStorage.setItem(MARKETING_KEY, marketing ? 'granted' : 'denied');
  } catch {
    /* storage blocked: choices apply to this page view only */
  }
  const ad = marketing ? 'granted' : 'denied';
  gtag('consent', 'update', { analytics_storage: analytics ? 'granted' : 'denied', ad_storage: ad, ad_user_data: ad, ad_personalization: ad });
  track('consent_update', { analytics_consent: analytics ? 'granted' : 'denied', marketing_consent: ad });
  const revoked = (before.analytics === 'granted' && !analytics) || (before.marketing === 'granted' && !marketing);
  // Loaded scripts can't be unloaded; a reload honours a withdrawal immediately.
  if (revoked && wasRunning) { window.location.reload(); return; }
  if (startTrackers()) pixelPageView();
}

/** Analytics-only choice; any marketing choice already made is kept. */
export function setConsent(choice) {
  setConsentChoices({ analytics: choice === 'granted', marketing: getMarketingConsent() === 'granted' });
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

/** A part's own page or details were viewed. */
export function trackViewPart(part) {
  track('view_item', {
    ecommerce: { currency: 'USD', value: dollars(part.estimateCents), items: [{ item_id: part.id, item_name: part.name, item_category: `part_${part.status}`, price: dollars(part.estimateCents), quantity: 1 }] },
  });
  pixelViewPart(part);
}

export function trackBeginCheckout({ part, amountCents, currency, demo }) {
  track('begin_checkout', {
    demo_mode: Boolean(demo),
    ecommerce: { currency: currency.toUpperCase(), value: dollars(amountCents), items: [donationItem(part, amountCents)] },
  });
  if (!demo) pixelBeginCheckout({ partId: part?.id ?? null, amountCents, currency });
}

async function sha256Hex(text) {
  const bytes = new TextEncoder().encode(text);
  const hash = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Fire `purchase` (and the pixel donation events) once per confirmed donation.
 * transaction_id is a hash of the Checkout Session id (which doubles as the status-lookup
 * token, so it's never sent raw).
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
  pixelDonation({ eventId: txId, amountCents, currency, partName: partName ?? null });
  try {
    localStorage.setItem(PURCHASE_KEY, JSON.stringify([...seen, txId].slice(-50)));
  } catch {
    /* duplicate protection is best effort without storage */
  }
  return true;
}
