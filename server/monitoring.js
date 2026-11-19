// Optional error monitoring (Sentry). Off unless SENTRY_DSN is set.
// No request bodies, cookies, IPs or emails are sent (sendDefaultPii: false, and
// anything that looks like an email address is scrubbed from messages).
const EMAIL = /[^\s@<>"']+@[^\s@<>"']+\.[a-z]{2,}/gi;

export function scrub(event) {
  if (event.request) { delete event.request.data; delete event.request.cookies; delete event.request.headers; }
  if (event.user) event.user = undefined;
  if (event.message) event.message = event.message.replace(EMAIL, '[email]');
  for (const ex of event.exception?.values ?? []) if (ex.value) ex.value = ex.value.replace(EMAIL, '[email]');
  return event;
}

export async function initMonitoring(config, logger) {
  if (!config.sentryDsn) return null;
  try {
    const Sentry = await import('@sentry/node');
    Sentry.init({
      dsn: config.sentryDsn,
      environment: config.stripeLive ? 'production' : 'test',
      sendDefaultPii: false,
      tracesSampleRate: 0,
      beforeSend: scrub,
    });
    logger.info('Error monitoring enabled.');
    return Sentry;
  } catch (err) {
    logger.warn('Error monitoring could not start', err.message);
    return null;
  }
}
