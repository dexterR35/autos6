import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { POLICY_VERSION } from '../src/lib/policies.js';

export const hashToken = (token) => createHash('sha256').update(token).digest('hex');
export const unsubscribeToken = (id, secret) => `${id}.${createHmac('sha256', secret).update(id).digest('hex')}`;
export function verifyUnsubscribe(token, secret) {
  if (typeof token !== 'string' || !/^[a-f0-9-]{36}\.[a-f0-9]{64}$/.test(token)) return null;
  const [id, mac] = token.split('.');
  const expected = unsubscribeToken(id, secret).split('.')[1];
  return timingSafeEqual(Buffer.from(mac, 'hex'), Buffer.from(expected, 'hex')) ? id : null;
}

export function registerSubscriptions(app, { db, config, json, limiter, originGuard, logger }) {
  const ready = () => db && config.emailApiKey && config.emailFrom && config.subscriptionSecret.length >= 32;
  app.post('/api/subscriptions', limiter(5), originGuard, json, async (req, res) => {
    if (!ready()) return res.status(503).json({ error: 'Email updates are not available yet. Please try again later.' });
    const { email, projectSlug, partId = null, consent, website } = req.body ?? {};
    if (website) return res.status(202).json({ ok: true });
    if (consent !== POLICY_VERSION) return res.status(400).json({ error: 'Please agree to receive updates and read the privacy notice.' });
    if (typeof email !== 'string' || email.length > 254 || !/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(email)
      || typeof projectSlug !== 'string' || !/^[a-z0-9-]{1,60}$/.test(projectSlug)
      || (partId !== null && (typeof partId !== 'string' || !/^[a-z0-9-]{1,60}$/.test(partId)))) return res.status(400).json({ error: 'Enter a valid email and part.' });
    const token = randomBytes(32).toString('hex');
    try {
      await db.requestSubscription({ slug: projectSlug, email: email.trim().toLowerCase(), partSlug: partId, hash: hashToken(token), url: `${config.appOrigin}/subscription/confirm#token=${token}`, consent });
      // Same response for existing and new subscribers: no email enumeration.
      return res.status(202).json({ ok: true });
    } catch (err) {
      logger.error('subscription request failed', err.code || 'database');
      return res.status(500).json({ error: 'Could not save your subscription. Please try again.' });
    }
  });
  app.post('/api/subscriptions/confirm', limiter(15), originGuard, json, async (req, res) => {
    const token = req.body?.token;
    if (typeof token !== 'string' || !/^[a-f0-9]{64}$/.test(token)) return res.status(400).json({ error: 'Invalid confirmation link.' });
    if (!db) return res.status(503).json({ error: 'Subscriptions unavailable.' });
    try {
      if (!await db.confirmSubscription(hashToken(token))) return res.status(400).json({ error: 'This link expired or was already used. You can subscribe again.' });
      return res.json({ ok: true });
    } catch { return res.status(500).json({ error: 'Please try again shortly.' }); }
  });
  // POST only: mail scanners may GET links without changing preferences.
  app.post('/api/subscriptions/unsubscribe', limiter(30), json, async (req, res) => {
    const id = config.subscriptionSecret ? verifyUnsubscribe(req.body?.token ?? req.query.token, config.subscriptionSecret) : null;
    if (!id) return res.status(400).json({ error: 'Invalid unsubscribe link.' });
    if (!db) return res.status(503).json({ error: 'Subscriptions unavailable.' });
    try { await db.unsubscribe(id); return res.json({ ok: true }); }
    catch { return res.status(500).json({ error: 'Please try again shortly.' }); }
  });
}
