// In-process Postgres (PGlite) that mimics the parts of Supabase our SQL relies on:
// anon/authenticated/service_role roles, Supabase's broad default grants, auth.uid()
// and a minimal storage schema. The real migration files are applied unchanged.
import { PGlite } from '@electric-sql/pglite';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '../..');

const BOOTSTRAP = `
create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;
grant usage on schema public to anon, authenticated, service_role;

-- Supabase's default privileges: new public objects are broadly granted. Our migrations
-- must revoke what they don't want exposed, so the tests run against the same defaults.
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;

create schema auth;
grant usage on schema auth to anon, authenticated, service_role;
create table auth.users (id uuid primary key, email text);
create function auth.uid() returns uuid language sql stable as $$
  select nullif(coalesce(current_setting('request.jwt.claim.sub', true), current_setting('request.jwt.claims', true)::jsonb ->> 'sub'), '')::uuid
$$;
grant execute on function auth.uid() to anon, authenticated, service_role;

create schema storage;
grant usage on schema storage to anon, authenticated, service_role;
create table storage.buckets (id text primary key, name text not null, public boolean default false);
create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text references storage.buckets(id), name text not null, owner uuid);
alter table storage.objects enable row level security;
grant select, insert, update, delete on storage.objects to anon, authenticated, service_role;
create policy "public read" on storage.objects for select using (true);
`;

export async function createTestDb({ seed = true } = {}) {
  const db = new PGlite();
  await db.exec(BOOTSTRAP);
  const dir = path.join(ROOT, 'supabase/migrations');
  for (const f of readdirSync(dir).filter((n) => n.endsWith('.sql')).sort()) {
    await db.exec(readFileSync(path.join(dir, f), 'utf8'));
  }
  if (seed) await db.exec(readFileSync(path.join(ROOT, 'supabase/seed.sql'), 'utf8'));
  return db;
}

/**
 * Run a statement as a Supabase role in its own transaction (like a PostgREST request).
 * role: 'anon' | 'authenticated' | 'service_role'; userId sets auth.uid().
 */
export async function asRole(db, role, sql, params = [], userId = null) {
  return db.transaction(async (tx) => {
    await tx.exec(`set local role ${role}`);
    await tx.query(`select set_config('request.jwt.claim.sub', $1, true)`, [userId ?? '']);
    const r = await tx.query(sql, params);
    return r.rows;
  });
}

export async function createUser(db, id, email) {
  await db.query('insert into auth.users (id, email) values ($1, $2)', [id, email]);
  return id;
}

export async function makeOwner(db, userId, slug = 'project-s6') {
  await db.query('insert into public.project_admins (project_id, user_id) select id, $1 from public.projects where slug = $2', [userId, slug]);
}

/** Server db adapter backed by PGlite, calling the same SQL functions as the Supabase adapter. */
export function createPgliteServerDb(db) {
  const call = async (sql, params) => {
    try {
      return await asRole(db, 'service_role', sql, params);
    } catch (err) {
      const { toDbError } = await import('../../server/db.js');
      throw toDbError(err);
    }
  };
  return {
    async createPendingDonation(v) {
      const { mapPending } = await import('../../server/db.js');
      const rows = await call('select * from public.create_pending_donation($1, $2, $3, $4, $5, $6)', [
        v.attemptId, v.projectSlug, v.partSlug, v.amountCents, v.displayName, v.isPublic,
      ]);
      return mapPending(rows[0]);
    },
    async attachCheckoutSession(donationId, sessionId) {
      const rows = await call('select public.attach_checkout_session($1, $2) as ok', [donationId, sessionId]);
      return rows[0].ok;
    },
    async processStripeEvent(e) {
      const { eventArgs } = await import('../../server/db.js');
      const a = eventArgs(e);
      const rows = await call('select public.process_stripe_event($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) as result', [
        a.p_event_id, a.p_type, a.p_livemode, a.p_session_id, a.p_payment_intent_id, a.p_payment_status,
        a.p_amount_total, a.p_currency, a.p_donor_email, a.p_amount_refunded, a.p_donation_id,
      ]);
      return rows[0].result;
    },
    async getDonationStatus(sessionId) {
      const { mapStatus } = await import('../../server/db.js');
      const rows = await call('select * from public.get_donation_status($1)', [sessionId]);
      return mapStatus(rows[0]) ?? null;
    },
  };
}
