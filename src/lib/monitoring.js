// Optional browser error monitoring (Sentry). Loaded only when VITE_SENTRY_DSN is set,
// as a separate chunk. No IPs, cookies, form values or emails are sent, and no session replay.
const EMAIL = /[^\s@<>"']+@[^\s@<>"']+\.[a-z]{2,}/gi;

export function scrubBrowserEvent(event) {
  if (event.user) event.user = undefined;
  if (event.request) { delete event.request.cookies; delete event.request.headers; if (event.request.url) event.request.url = event.request.url.split(/[?#]/)[0]; }
  if (event.message) event.message = event.message.replace(EMAIL, '[email]');
  for (const ex of event.exception?.values ?? []) if (ex.value) ex.value = ex.value.replace(EMAIL, '[email]');
  for (const b of event.breadcrumbs ?? []) if (b.message) b.message = b.message.replace(EMAIL, '[email]');
  return event;
}

export function initClientMonitoring() {
  const dsn = import.meta.env.VITE_SENTRY_DSN;
  if (!dsn || typeof window === 'undefined') return;
  // After first paint, so monitoring never slows the garage down.
  const start = () => import('@sentry/react').then((Sentry) => {
    Sentry.init({
      dsn,
      environment: import.meta.env.MODE,
      sendDefaultPii: false,
      tracesSampleRate: 0,
      // Checkout return URLs carry session ids; strip query strings from breadcrumbs too.
      beforeBreadcrumb: (b) => (b.data?.url ? { ...b, data: { ...b.data, url: String(b.data.url).split(/[?#]/)[0] } } : b),
      beforeSend: scrubBrowserEvent,
    });
  }).catch(() => {});
  if ('requestIdleCallback' in window) requestIdleCallback(start, { timeout: 5000 }); else setTimeout(start, 2000);
}
