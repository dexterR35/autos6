// Row Level Security against the real migrations in PGlite with Supabase-like roles.
import { beforeAll, describe, expect, it } from 'vitest';
import { asRole, createTestDb, createUser, makeOwner } from './helpers/pg.js';

const OWNER = '11111111-1111-4111-8111-111111111111';
const STRANGER = '22222222-2222-4222-8222-222222222222';
let db;
let projectId;

beforeAll(async () => {
  db = await createTestDb();
  await createUser(db, OWNER, 'owner@example.com');
  await createUser(db, STRANGER, 'stranger@example.com');
  await makeOwner(db, OWNER);
  projectId = (await db.query(`select id from projects where slug = 'project-s6'`)).rows[0].id;
  // a paid public donation with a private email, plus a pending one
  await db.query(
    `insert into donations (project_id, attempt_id, amount_cents, currency, status, is_public, display_name, donor_email, paid_at, stripe_checkout_session_id)
     values ($1, gen_random_uuid(), 2500, 'usd', 'paid', true, 'Sam', 'sam@example.com', now(), 'cs_test_public1'),
            ($1, gen_random_uuid(), 5000, 'usd', 'paid', false, 'Hidden', 'hidden@example.com', now(), 'cs_test_private1'),
            ($1, gen_random_uuid(), 9900, 'usd', 'pending', true, 'Pending', null, null, null)`,
    [projectId],
  );
  await db.query(
    `insert into restoration_updates (project_id, title, body, published_at) values ($1, 'Published', 'x', now() - interval '1 day'), ($1, 'Draft', 'y', null)`,
    [projectId],
  );
});

const denied = (p) => expect(p).rejects.toThrow(/permission denied|row-level security|violates/i);

describe('anonymous visitors', () => {
  it('can read published projects, parts and published updates', async () => {
    expect(await asRole(db, 'anon', 'select slug from projects')).toHaveLength(1);
    expect(await asRole(db, 'anon', 'select id from parts')).toHaveLength(10);
    const ups = await asRole(db, 'anon', 'select title from restoration_updates');
    expect(ups.map((u) => u.title)).toEqual(['Published']);
  });

  it('cannot read or write payment records', async () => {
    await denied(asRole(db, 'anon', 'select * from donations'));
    await denied(asRole(db, 'anon', 'select * from stripe_events'));
    await denied(asRole(db, 'anon', `insert into donations (project_id, attempt_id, amount_cents, currency, status) values ($1, gen_random_uuid(), 100, 'usd', 'paid')`, [projectId]));
    await denied(asRole(db, 'anon', `update donations set status = 'paid'`));
  });

  it('cannot call server-only payment functions', async () => {
    await denied(asRole(db, 'anon', `select * from create_pending_donation(gen_random_uuid(), 'project-s6', null, 100, null, false)`));
    await denied(asRole(db, 'anon', `select process_stripe_event('evt_x','checkout.session.completed',false,'cs_test_public1',null,'paid',2500,'usd',null,null,null)`));
    await denied(asRole(db, 'anon', `select * from get_donation_status('cs_test_public1')`));
  });

  it('cannot change content or grant themselves ownership', async () => {
    await denied(asRole(db, 'anon', `update parts set status = 'bought'`));
    await denied(asRole(db, 'anon', `insert into project_admins (project_id, user_id) values ($1, $2)`, [projectId, STRANGER]));
  });

  it('gets campaign totals from confirmed donations only', async () => {
    const [s] = await asRole(db, 'anon', `select * from get_campaign_summary('project-s6')`);
    expect(Number(s.raised_cents)).toBe(7500); // 2500 + 5000 paid, pending excluded
    expect(Number(s.goal_cents)).toBe(800000);
  });

  it('sees only consented supporters, with no emails or Stripe ids', async () => {
    const rows = await asRole(db, 'anon', `select * from get_public_contributions('project-s6', 10)`);
    expect(rows).toHaveLength(1);
    expect(rows[0].display_name).toBe('Sam');
    expect(Object.keys(rows[0]).sort()).toEqual(['amount_cents', 'created_at', 'display_name', 'part_name']);
    expect(JSON.stringify(rows)).not.toMatch(/@|cs_test/);
  });
});

describe('authenticated non-owner', () => {
  it('cannot update parts, projects or updates of a project they do not own', async () => {
    const r1 = await asRole(db, 'authenticated', `update parts set status = 'bought' where slug = 'hood' returning id`, [], STRANGER);
    expect(r1).toHaveLength(0); // RLS filters the row: nothing updated
    const r2 = await asRole(db, 'authenticated', `update projects set goal_cents = 1 returning id`, [], STRANGER);
    expect(r2).toHaveLength(0);
    await denied(asRole(db, 'authenticated', `insert into parts (project_id, slug, name, estimate_cents) values ($1, 'x', 'X', 1)`, [projectId], STRANGER));
    await denied(asRole(db, 'authenticated', `insert into restoration_updates (project_id, title, created_by) values ($1, 'hack', $2)`, [projectId, STRANGER], STRANGER));
    const status = (await db.query(`select status from parts where slug = 'hood'`)).rows[0].status;
    expect(status).toBe('needed');
  });

  it('cannot read donations or drafts', async () => {
    await denied(asRole(db, 'authenticated', 'select * from donations', [], STRANGER));
    const ups = await asRole(db, 'authenticated', 'select title from restoration_updates', [], STRANGER);
    expect(ups.map((u) => u.title)).toEqual(['Published']);
  });

  it('is_project_admin is false', async () => {
    const [r] = await asRole(db, 'authenticated', 'select is_project_admin($1) as ok', [projectId], STRANGER);
    expect(r.ok).toBe(false);
  });
});

describe('project owner', () => {
  it('can update parts and campaign copy', async () => {
    const r = await asRole(db, 'authenticated', `update parts set status = 'bought' where slug = 'side-skirts' returning status`, [], OWNER);
    expect(r).toEqual([{ status: 'bought' }]);
    const p = await asRole(db, 'authenticated', `update projects set tagline = 'New tagline' returning tagline`, [], OWNER);
    expect(p).toEqual([{ tagline: 'New tagline' }]);
  });

  it('cannot change protected columns (slug, currency)', async () => {
    await denied(asRole(db, 'authenticated', `update projects set currency = 'eur'`, [], OWNER));
    await denied(asRole(db, 'authenticated', `update projects set slug = 'other'`, [], OWNER));
  });

  it('can create, see drafts of, and delete updates', async () => {
    await asRole(db, 'authenticated', `insert into restoration_updates (project_id, title, body, created_by) values ($1, 'Owner draft', 'b', $2)`, [projectId, OWNER], OWNER);
    const ups = await asRole(db, 'authenticated', 'select title from restoration_updates order by title', [], OWNER);
    expect(ups.map((u) => u.title)).toEqual(['Draft', 'Owner draft', 'Published']);
    const del = await asRole(db, 'authenticated', `delete from restoration_updates where title = 'Owner draft' returning id`, [], OWNER);
    expect(del).toHaveLength(1);
  });

  it('still cannot read private payment records from the browser', async () => {
    await denied(asRole(db, 'authenticated', 'select * from donations', [], OWNER));
  });

  it('can upload media only into their own project folder', async () => {
    await asRole(db, 'authenticated', `insert into storage.objects (bucket_id, name) values ('project-media', $1)`, [`${projectId}/updates/a.jpg`], OWNER);
    await denied(asRole(db, 'authenticated', `insert into storage.objects (bucket_id, name) values ('project-media', 'not-a-uuid/a.jpg')`, [], OWNER));
    await denied(asRole(db, 'authenticated', `insert into storage.objects (bucket_id, name) values ('project-media', $1)`, [`${projectId}/b.jpg`], STRANGER));
  });
});
