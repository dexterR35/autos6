import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { getRouteMeta, headFor, jsonLdString } from './config.js';
import { trackPageView } from '../lib/analytics.js';

const env = import.meta.env ?? {};
export const SITE_URL = (env.VITE_SITE_URL || '').replace(/\/+$/, '');
export const NOINDEX = String(env.VITE_NOINDEX || '').toLowerCase() === 'true';

function upsert(tag, key, attrs) {
  let el = document.head.querySelector(`[data-seo="${key}"]`);
  if (!el) {
    el = document.createElement(tag);
    el.setAttribute('data-seo', key);
    document.head.appendChild(el);
  }
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
}

let lastTrackedPath = null; // React StrictMode runs effects twice in dev; count each navigation once

/**
 * Keep <head> in sync with the current route on client-side navigation (the first load
 * already has the right tags from the pre-rendered HTML), then record a virtual page view.
 */
export function useSeo() {
  const { pathname } = useLocation();
  useEffect(() => {
    const route = getRouteMeta(pathname);
    const head = headFor(route, { siteUrl: SITE_URL, noindex: NOINDEX });
    document.title = head.title;
    const keys = new Set(head.tags.map((t) => t.key));
    for (const t of head.tags) upsert(t.tag, t.key, t.attrs);
    // remove tags that don't apply to this route (e.g. canonical on the 404 page)
    document.head.querySelectorAll('[data-seo]').forEach((el) => {
      const k = el.getAttribute('data-seo');
      if (k !== 'jsonld' && !keys.has(k)) el.remove();
    });
    const ld = document.head.querySelector('script[data-seo="jsonld"]');
    if (head.jsonLd) {
      const s = ld ?? Object.assign(document.createElement('script'), { type: 'application/ld+json' });
      s.setAttribute('data-seo', 'jsonld');
      s.textContent = jsonLdString(head.jsonLd);
      if (!ld) document.head.appendChild(s);
    } else ld?.remove();

    // Query strings are dropped on purpose: /donation/success carries the Stripe session id.
    if (lastTrackedPath !== pathname) {
      lastTrackedPath = pathname;
      trackPageView({ path: pathname, title: head.title, location: `${window.location.origin}${pathname}` });
    }
  }, [pathname]);
}
