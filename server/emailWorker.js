import { unsubscribeToken } from './subscriptions.js';

export async function deliverEmailJobs({ db, config, logger, fetchImpl = fetch }) {
  if (!db || !config.emailApiKey || !config.emailFrom || config.subscriptionSecret.length < 32) return;
  const jobs = await db.claimEmailJobs();
  for (const job of jobs) {
    let provider = null;
    try {
      // Recheck consent immediately before delivery, including jobs claimed earlier.
      if (!await db.isEmailEligible(job)) { await db.cancelEmailJob(job.id); continue; }
      const token = unsubscribeToken(job.subscriber_id, config.subscriptionSecret);
      const unsubscribe = `${config.appOrigin}/subscription/unsubscribe#token=${token}`;
      const confirmation = job.kind === 'confirmation';
      const payload = job.payload;
      const subject = confirmation ? 'Confirm your Project S6 updates' : `Project S6 · ${payload.title}`;
      const text = confirmation
        ? `You requested Project S6 updates. Confirm within 24 hours:\n${payload.url}\n\nIf you did not request this, ignore this email.\nCancel updates: ${unsubscribe}`
        : `${payload.title}\n\n${payload.body}\n\nSee the build: ${config.appOrigin}${payload.path}\n\nUnsubscribe: ${unsubscribe}`;
      const response = await fetchImpl('https://api.resend.com/emails', {
        method: 'POST', signal: AbortSignal.timeout(20_000),
        headers: { Authorization: `Bearer ${config.emailApiKey}`, 'Content-Type': 'application/json', 'Idempotency-Key': `s6-email-${job.id}` },
        body: JSON.stringify({ from: config.emailFrom, to: [job.email], subject: subject.replace(/[\r\n]/g, ' ').slice(0, 180), text,
          headers: { 'List-Unsubscribe': `<${config.appOrigin}/api/subscriptions/unsubscribe?token=${token}>`, 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' } }),
      });
      if (!response.ok) throw new Error('delivery_failed');
      const result = await response.json();
      if (typeof result.id !== 'string' || !result.id) throw new Error('delivery_failed');
      provider = result.id;
    } catch { logger.warn('Email delivery will be retried; no recipient details logged.'); }
    await db.finishEmailJob(job.id, job.lease_id, provider);
  }
}

export function startEmailWorker(deps) {
  let busy = false;
  const tick = async () => {
    if (busy) return;
    busy = true;
    try { await deliverEmailJobs(deps); } catch { deps.logger.error('Email queue unavailable.'); }
    finally { busy = false; }
  };
  const timer = setInterval(tick, 30_000);
  timer.unref();
  return () => clearInterval(timer);
}
