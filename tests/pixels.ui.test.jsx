// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const META = '123456789012345';
const TIKTOK = 'C0TESTPIXEL12345';
const ADS = 'AW-123456789';

// Fresh modules per test: pixel IDs are read from the environment at import time.
async function loadWithPixels() {
  vi.resetModules();
  vi.stubEnv('VITE_META_PIXEL_ID', META);
  vi.stubEnv('VITE_TIKTOK_PIXEL_ID', TIKTOK);
  vi.stubEnv('VITE_GOOGLE_ADS_ID', ADS);
  vi.stubEnv('VITE_GOOGLE_ADS_DONATION_LABEL', 'DonationLabel_1');
  return { analytics: await import('../src/lib/analytics.js'), pixels: await import('../src/lib/pixels.js') };
}
const pixelScripts = () => [...document.head.querySelectorAll('script[src]')].map((s) => s.src).filter((src) => /facebook|tiktok|googletagmanager/.test(src));
const calls = () => JSON.stringify([window.fbq?.queue ?? [], [...(window.ttq ?? [])], window.dataLayer ?? []]);

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  window.dataLayer = [];
  delete window.fbq; delete window._fbq; delete window.ttq; delete window.gtag;
  document.head.querySelectorAll('script[src]').forEach((s) => s.remove());
  window.history.replaceState(null, '', '/');
});
afterEach(() => { cleanup(); vi.unstubAllEnvs(); });

describe('ad pixels', () => {
  it('load nothing without marketing consent, even when analytics is allowed', async () => {
    const { analytics } = await loadWithPixels();
    expect(analytics.MARKETING_VENDORS).toEqual(['Meta', 'TikTok', 'Google Ads']);
    expect(analytics.startTrackers()).toBe(false);
    analytics.setConsentChoices({ analytics: true, marketing: false });
    analytics.trackViewPart({ id: 'hood', name: 'Hood', status: 'needed', estimateCents: 65000 });
    expect(pixelScripts()).toEqual([]);
    expect(window.fbq).toBeUndefined();
    expect(window.ttq).toBeUndefined();
  });

  it('load every configured pixel after marketing consent, with Meta auto-scraping off', async () => {
    const { analytics } = await loadWithPixels();
    analytics.setConsentChoices({ analytics: false, marketing: true });
    expect(localStorage.getItem('project-s6:marketing-consent')).toBe('granted');
    expect(pixelScripts()).toEqual([
      'https://connect.facebook.net/en_US/fbevents.js',
      `https://analytics.tiktok.com/i18n/pixel/events.js?sdkid=${TIKTOK}&lib=ttq`,
      `https://www.googletagmanager.com/gtag/js?id=${ADS}`,
    ]);
    const meta = window.fbq.queue.map((args) => [...args]);
    expect(meta.slice(0, 2)).toEqual([['set', 'autoConfig', false, META], ['init', META]]);
    expect(meta).toContainEqual(['track', 'PageView']);
    expect([...window.ttq].map((entry) => entry[0])).toContain('page');
    const consent = window.dataLayer.find((e) => e[0] === 'consent' && e[1] === 'update');
    expect(consent[2]).toMatchObject({ ad_storage: 'granted', ad_user_data: 'granted', ad_personalization: 'granted', analytics_storage: 'denied' });
  });

  it('report a confirmed donation once, deduplicated, without the Stripe session id', async () => {
    const { analytics } = await loadWithPixels();
    analytics.setConsentChoices({ analytics: false, marketing: true });
    const args = { sessionId: 'cs_test_secretsession123', amountCents: 2500, currency: 'usd', partName: 'Hood' };
    expect(await analytics.trackPurchaseOnce(args)).toBe(true);
    expect(await analytics.trackPurchaseOnce(args)).toBe(false);
    const donate = window.fbq.queue.map((a) => [...a]).filter((a) => a[1] === 'Donate');
    expect(donate).toHaveLength(1);
    expect(donate[0][2]).toEqual({ value: 25, currency: 'USD', content_name: 'Hood' });
    expect(donate[0][3].eventID).toMatch(/^s6-[0-9a-f]{24}$/);
    expect([...window.ttq].filter((e) => e[0] === 'track' && e[1] === 'CompletePayment')).toHaveLength(1);
    const conversion = window.dataLayer.find((e) => e[0] === 'event' && e[1] === 'conversion');
    expect(conversion[2]).toMatchObject({ send_to: `${ADS}/DonationLabel_1`, value: 25, currency: 'USD', transaction_id: donate[0][3].eventID });
    expect(calls()).not.toContain('cs_test_secretsession123');
  });

  it('send part views and checkout starts with no personal data', async () => {
    const { analytics } = await loadWithPixels();
    analytics.setConsentChoices({ analytics: false, marketing: true });
    analytics.trackViewPart({ id: 'hood', name: 'Hood', status: 'needed', estimateCents: 65000 });
    analytics.trackBeginCheckout({ part: { id: 'hood', name: 'Hood', status: 'needed' }, amountCents: 1500, currency: 'usd', demo: false });
    analytics.trackBeginCheckout({ part: null, amountCents: 500, currency: 'usd', demo: true });
    const meta = window.fbq.queue.map((a) => [...a]);
    expect(meta).toContainEqual(['track', 'ViewContent', { content_ids: ['hood'], content_name: 'Hood', content_type: 'product' }]);
    expect(meta.filter((a) => a[1] === 'InitiateCheckout')).toEqual([['track', 'InitiateCheckout', { value: 15, currency: 'USD', content_ids: ['hood'] }]]);
  });

  it('never start on a page whose address holds a secret', async () => {
    const { analytics } = await loadWithPixels();
    localStorage.setItem('project-s6:marketing-consent', 'granted');
    window.history.replaceState(null, '', '/community#access_token=abc&refresh_token=def');
    expect(analytics.startTrackers()).toBe(false);
    window.history.replaceState(null, '', '/admin');
    expect(analytics.startTrackers()).toBe(false);
    expect(pixelScripts()).toEqual([]);
    window.history.replaceState(null, '', '/parts');
    expect(analytics.startTrackers()).toBe(true);
  });

  it('the banner offers a separate marketing choice naming the vendors', async () => {
    const { default: Banner } = await (async () => { await loadWithPixels(); return import('../src/components/ConsentBanner.jsx'); })();
    render(<Banner />);
    const region = screen.getByRole('region', { name: /Cookies/ });
    fireEvent.click(within(region).getByRole('button', { name: 'Choose' }));
    expect(within(region).getByLabelText('Marketing (Meta, TikTok, Google Ads)')).not.toBeChecked();
    expect(within(region).queryByLabelText(/Analytics/)).toBeNull(); // GTM not configured
    fireEvent.click(within(region).getByRole('button', { name: 'Save choices' }));
    expect(localStorage.getItem('project-s6:marketing-consent')).toBe('denied');
    expect(pixelScripts()).toEqual([]);
  });
});

describe('secrets in the address', () => {
  it('moves the Stripe session id out of the address before trackers can read it', async () => {
    const { scrubSensitiveUrl, readScrubbed, isTrackableUrl } = await import('../src/lib/urlScrub.js');
    window.history.replaceState(null, '', '/donation/success?session_id=cs_test_secretsession123');
    expect(isTrackableUrl()).toBe(false);
    scrubSensitiveUrl();
    expect(window.location.href).not.toContain('cs_test');
    expect(window.location.pathname).toBe('/donation/success');
    expect(readScrubbed('session_id', '/donation/success')).toBe('cs_test_secretsession123');
    expect(readScrubbed('session_id', '/parts')).toBeNull();
    expect(isTrackableUrl()).toBe(true);
  });

  it('moves email-link tokens out of the address', async () => {
    const { scrubSensitiveUrl, readScrubbed } = await import('../src/lib/urlScrub.js');
    const token = 'a'.repeat(64);
    window.history.replaceState(null, '', `/subscription/confirm#token=${token}`);
    scrubSensitiveUrl();
    expect(window.location.hash).toBe('');
    expect(readScrubbed('token', '/subscription/confirm')).toBe(token);
  });

  it('leaves ordinary addresses alone', async () => {
    const { scrubSensitiveUrl } = await import('../src/lib/urlScrub.js');
    window.history.replaceState(null, '', '/parts/hood?ref=share#top');
    scrubSensitiveUrl();
    expect(`${window.location.pathname}${window.location.search}${window.location.hash}`).toBe('/parts/hood?ref=share#top');
  });
});
