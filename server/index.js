import 'dotenv/config';
import dotenv from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Stripe from 'stripe';
import { createClient } from '@supabase/supabase-js';
import { createApp } from './app.js';
import { readConfig } from './config.js';
import { createSupabaseDb } from './db.js';
import { createLogger } from './logger.js';

dotenv.config({ path: path.join(path.dirname(fileURLToPath(import.meta.url)), '.env'), quiet: true });

const config = readConfig();
const logger = createLogger();

const stripe = config.stripeSecretKey ? new Stripe(config.stripeSecretKey) : null;
const db =
  config.supabaseUrl && config.supabaseSecretKey
    ? createSupabaseDb(createClient(config.supabaseUrl, config.supabaseSecretKey, { auth: { persistSession: false, autoRefreshToken: false } }))
    : null;

if (config.stripeSecretKey.startsWith('sk_live_')) logger.warn('Running with a LIVE Stripe key.');
if (!stripe) logger.warn('STRIPE_SECRET_KEY not set: checkout endpoints return 503.');
if (!db) logger.warn('SUPABASE_URL / SUPABASE_SECRET_KEY not set: donation endpoints return 503.');
if (stripe && !config.stripeWebhookSecret) logger.warn('STRIPE_WEBHOOK_SECRET not set: webhooks are rejected, so payments will never confirm.');

createApp({ stripe, db, config, logger }).listen(config.port, () => {
  logger.info(`Project S6 API listening on http://localhost:${config.port} (app origin ${config.appOrigin})`);
});
