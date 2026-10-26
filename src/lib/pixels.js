// Ad measurement pixels: Meta (Facebook/Instagram), TikTok and Google Ads.
// Nothing loads and no event is sent unless the visitor accepted marketing cookies
// (analytics.js decides) and the address holds no secrets (urlScrub.js). Events carry
// only part ids/names, amounts and currency: never names, emails, payment ids or tokens.
import { isTrackableUrl } from './urlScrub.js';

const env = import.meta.env ?? {};
const pick = (value, pattern) => (pattern.test(value || '') ? value : '');
export const META_PIXEL_ID = pick(env.VITE_META_PIXEL_ID, /^\d{8,20}$/);
export const TIKTOK_PIXEL_ID = pick(env.VITE_TIKTOK_PIXEL_ID, /^[A-Z0-9]{12,30}$/);
export const GOOGLE_ADS_ID = pick(env.VITE_GOOGLE_ADS_ID, /^AW-\d{6,15}$/);
export const GOOGLE_ADS_DONATION_LABEL = pick(env.VITE_GOOGLE_ADS_DONATION_LABEL, /^[A-Za-z0-9_-]{4,64}$/);
export const PIXEL_VENDORS = [META_PIXEL_ID && 'Meta', TIKTOK_PIXEL_ID && 'TikTok', GOOGLE_ADS_ID && 'Google Ads'].filter(Boolean);
export const PIXELS_CONFIGURED = PIXEL_VENDORS.length > 0;

let started = false;
export const pixelsStarted = () => started;
const dollars = (cents) => Math.round(cents) / 100;

function loadScript(src) {
  const script = document.createElement('script');
  script.async = true;
  script.src = src;
  document.head.appendChild(script);
}

function startMeta() {
  if (!META_PIXEL_ID || window.fbq) return;
  // Meta's standard queue stub. autoConfig off: no automatic button or page scraping.
  const fbq = function fbq() { fbq.callMethod ? fbq.callMethod.apply(fbq, arguments) : fbq.queue.push(arguments); };
  Object.assign(fbq, { push: fbq, loaded: true, version: '2.0', queue: [] });
  window.fbq = fbq;
  window._fbq = fbq;
  fbq('set', 'autoConfig', false, META_PIXEL_ID);
  fbq('init', META_PIXEL_ID);
  loadScript('https://connect.facebook.net/en_US/fbevents.js');
}

function startTikTok() {
  if (!TIKTOK_PIXEL_ID || window.ttq) return;
  // TikTok's standard queue stub.
  const ttq = [];
  ttq.methods = ['page', 'track', 'identify', 'instances', 'debug', 'on', 'off', 'once', 'ready', 'alias', 'group', 'enableCookie', 'disableCookie', 'holdConsent', 'revokeConsent', 'grantConsent'];
  ttq.setAndDefer = (target, method) => { target[method] = (...args) => { target.push([method, ...args]); }; };
  ttq.methods.forEach((method) => ttq.setAndDefer(ttq, method));
  ttq.instance = (id) => { const instance = ttq._i[id] || []; ttq.methods.forEach((method) => ttq.setAndDefer(instance, method)); return instance; };
  ttq.load = (id, options) => {
    const url = 'https://analytics.tiktok.com/i18n/pixel/events.js';
    ttq._i = ttq._i || {}; ttq._i[id] = []; ttq._i[id]._u = url;
    ttq._t = ttq._t || {}; ttq._t[id] = Date.now();
    ttq._o = ttq._o || {}; ttq._o[id] = options || {};
    loadScript(`${url}?sdkid=${encodeURIComponent(id)}&lib=ttq`);
  };
  window.TiktokAnalyticsObject = 'ttq';
  window.ttq = ttq;
  ttq.load(TIKTOK_PIXEL_ID);
}

function startGoogleAds() {
  if (!GOOGLE_ADS_ID) return;
  window.dataLayer = window.dataLayer || [];
  window.gtag = window.gtag || function gtag() { window.dataLayer.push(arguments); }; // eslint-disable-line prefer-rest-params
  window.gtag('consent', 'update', { ad_storage: 'granted', ad_user_data: 'granted', ad_personalization: 'granted' });
  window.gtag('js', new Date());
  window.gtag('config', GOOGLE_ADS_ID, { send_page_view: false });
  loadScript(`https://www.googletagmanager.com/gtag/js?id=${GOOGLE_ADS_ID}`);
}

/** Load every configured pixel once. Call only after marketing consent. */
export function startPixels() {
  if (started || !PIXELS_CONFIGURED || typeof window === 'undefined' || !isTrackableUrl()) return false;
  started = true;
  startMeta();
  startTikTok();
  startGoogleAds();
  return true;
}

export function pixelPageView() {
  if (!started || !isTrackableUrl()) return;
  window.fbq?.('track', 'PageView');
  window.ttq?.page?.();
  if (GOOGLE_ADS_ID) window.gtag?.('event', 'page_view', { send_to: GOOGLE_ADS_ID });
}

export function pixelViewPart(part) {
  if (!started || !part) return;
  window.fbq?.('track', 'ViewContent', { content_ids: [part.id], content_name: part.name, content_type: 'product' });
  window.ttq?.track?.('ViewContent', { content_id: part.id, content_name: part.name, content_type: 'product' });
  if (GOOGLE_ADS_ID) window.gtag?.('event', 'view_item', { send_to: GOOGLE_ADS_ID, items: [{ id: part.id, name: part.name }] });
}

export function pixelBeginCheckout({ partId = null, amountCents, currency }) {
  if (!started) return;
  const value = dollars(amountCents);
  const code = currency.toUpperCase();
  window.fbq?.('track', 'InitiateCheckout', { value, currency: code, ...(partId ? { content_ids: [partId] } : {}) });
  window.ttq?.track?.('InitiateCheckout', { value, currency: code, ...(partId ? { content_id: partId } : {}) });
  if (GOOGLE_ADS_ID) window.gtag?.('event', 'begin_checkout', { send_to: GOOGLE_ADS_ID, value, currency: code });
}

/** A Stripe-confirmed donation. `eventId` is the hashed transaction id, for deduplication. */
export function pixelDonation({ eventId, amountCents, currency, partName = null }) {
  if (!started) return;
  const value = dollars(amountCents);
  const code = currency.toUpperCase();
  window.fbq?.('track', 'Donate', { value, currency: code, ...(partName ? { content_name: partName } : {}) }, { eventID: eventId });
  window.ttq?.track?.('CompletePayment', { value, currency: code, ...(partName ? { content_name: partName } : {}) }, { event_id: eventId });
  if (GOOGLE_ADS_ID && GOOGLE_ADS_DONATION_LABEL) {
    window.gtag?.('event', 'conversion', { send_to: `${GOOGLE_ADS_ID}/${GOOGLE_ADS_DONATION_LABEL}`, value, currency: code, transaction_id: eventId });
  }
}
