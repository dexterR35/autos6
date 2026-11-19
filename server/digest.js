// Daily email to project owners: yesterday's money, newly funded parts, what needs attention.
import { formatCents } from '../src/lib/money.js';

const list = (items) => (items?.length ? items.map((n) => `  • ${n}`).join('\n') : '  (none)');

export function digestEmail({ projectTitle, currency, summary: s }, appOrigin) {
  const attention = [
    s.ready_to_buy?.length ? `${s.ready_to_buy.length} part(s) funded and ready to buy` : null,
    s.needs_review ? `${s.needs_review} payment(s) need review (amount/currency mismatch) in Stripe` : null,
    s.pending_posts ? `${s.pending_posts} community post(s) waiting for approval` : null,
    s.monthly_past_due ? `${s.monthly_past_due} monthly supporter(s) with a failed payment` : null,
  ].filter(Boolean);
  const subject = `${projectTitle} daily: ${formatCents(Number(s.raised_cents), currency)} from ${s.contributions} contribution(s)`
    + (s.newly_funded?.length ? ` · ${s.newly_funded.length} part(s) funded` : '');
  const text = [
    `${projectTitle} — last 24 hours (UTC)`,
    '',
    `Raised: ${formatCents(Number(s.raised_cents), currency)} from ${s.contributions} contribution(s)`,
    `Refunded: ${formatCents(Number(s.refunded_cents), currency)}`,
    `Monthly supporters: ${s.monthly_active} active`,
    '',
    'Newly funded:',
    list(s.newly_funded),
    '',
    'Ready to buy (record the purchase in admin):',
    list(s.ready_to_buy),
    '',
    attention.length ? `Needs your attention:\n${list(attention)}` : 'Nothing needs your attention.',
    '',
    `Admin: ${appOrigin}/admin`,
  ].join('\n');
  return { subject, text, quiet: !Number(s.contributions) && !s.newly_funded?.length && !attention.length };
}

/** Send today's digests once (any server instance may run this; the database picks one). */
export async function sendOwnerDigests({ db, config, logger, now = new Date(), fetchImpl = fetch }) {
  if (!db?.claimOwnerDigests || !config.emailApiKey || !config.emailFrom || !config.ownerDigest) return 0;
  if (now.getUTCHours() < config.digestHourUtc) return 0;
  const date = now.toISOString().slice(0, 10);
  const rows = await db.claimOwnerDigests(date);
  let sent = 0;
  for (const row of rows) {
    let provider = null;
    try {
      const recipients = (row.recipients ?? []).filter(Boolean);
      const email = digestEmail({ projectTitle: row.project_title, currency: row.currency, summary: row.summary }, config.appOrigin);
      if (!recipients.length || (email.quiet && !config.digestWhenQuiet)) {
        provider = 'skipped';
      } else {
        const res = await fetchImpl('https://api.resend.com/emails', {
          method: 'POST', signal: AbortSignal.timeout(20_000),
          headers: { Authorization: `Bearer ${config.emailApiKey}`, 'Content-Type': 'application/json', 'Idempotency-Key': `s6-digest-${row.project_id}-${date}` },
          body: JSON.stringify({ from: config.emailFrom, to: recipients, subject: email.subject.slice(0, 180), text: email.text }),
        });
        if (!res.ok) throw new Error('delivery_failed');
        provider = (await res.json()).id || 'sent';
        sent += 1;
      }
    } catch {
      logger.warn('Owner digest will be retried.');
    }
    await db.finishOwnerDigest(row.project_id, date, provider);
  }
  return sent;
}

export function startDigestWorker(deps) {
  let busy = false;
  const tick = async () => {
    if (busy) return;
    busy = true;
    try { await sendOwnerDigests(deps); } catch { deps.logger.error('Owner digest unavailable.'); }
    finally { busy = false; }
  };
  const timer = setInterval(tick, 10 * 60_000);
  timer.unref();
  setTimeout(tick, 15_000).unref();
  return () => clearInterval(timer);
}
