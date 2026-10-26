import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { asRole, createTestDb } from './helpers/pg.js';

let db;
let projectId;
beforeAll(async () => {
  db = await createTestDb();
  projectId = (await db.query("select id from projects where slug='project-s6'")).rows[0].id;
  await db.query(`insert into donations(project_id,attempt_id,amount_cents,refunded_cents,currency,status,is_public,needs_review,display_name,donor_email,paid_at)
    values
    ($1,gen_random_uuid(),2500,0,'usd','paid',true,false,'Alex Old',' ALEX@example.com ','2026-10-01'),
    ($1,gen_random_uuid(),5000,1000,'usd','paid',true,false,'Alex New','alex@example.com','2026-10-02'),
    ($1,gen_random_uuid(),9900,0,'usd','paid',false,false,'Private name','alex@example.com','2026-10-03'),
    ($1,gen_random_uuid(),9900,0,'usd','pending',true,false,'Pending','pending@example.com','2026-10-03'),
    ($1,gen_random_uuid(),9900,0,'usd','paid',true,true,'Review','review@example.com','2026-10-03'),
    ($1,gen_random_uuid(),9900,0,'eur','paid',true,false,'Wrong currency','eur@example.com','2026-10-03'),
    ($1,gen_random_uuid(),9900,9900,'usd','paid',true,false,'Fully refunded','refunded@example.com','2026-10-03'),
    ($1,gen_random_uuid(),800,0,'usd','paid',true,false,'Sam','sam-one@example.com','2026-10-03'),
    ($1,gen_random_uuid(),800,0,'usd','paid',true,false,'Sam','sam-two@example.com','2026-10-03'),
    ($1,gen_random_uuid(),200,0,'usd','paid',true,false,'No Email',null,'2026-10-03'),
    ($1,gen_random_uuid(),200,0,'usd','paid',true,false,'No Email',null,'2026-10-03'),
    ($1,gen_random_uuid(),100,0,'usd','paid',true,false,'leak@example.com','leak@example.com','2026-10-03')`, [projectId]);
  const [pages] = (await db.query("insert into projects(slug,title,currency,goal_cents) values('garage-pages','Pages','usd',1000000) returning id")).rows;
  await db.query(`insert into donations(project_id,attempt_id,amount_cents,currency,status,is_public,display_name,donor_email,paid_at)
    select $1,gen_random_uuid(),100,'usd','paid',true,'Page '||lpad(i::text,3,'0'),'page'||lpad(i::text,3,'0')||'@example.com','2026-10-03'
    from generate_series(1,205) as i`, [pages.id]);
  const [hidden] = (await db.query("insert into projects(slug,title,currency,goal_cents,is_published) values('garage-hidden','Hidden','usd',1000000,false) returning id")).rows;
  await db.query("insert into donations(project_id,attempt_id,amount_cents,currency,status,is_public,display_name,donor_email) values($1,gen_random_uuid(),100,'usd','paid',true,'Hidden project','hidden@example.com')", [hidden.id]);
  await db.exec('create role garage_no_access nologin; grant usage on schema public to garage_no_access;');
});
afterAll(async () => { await db?.close(); });

describe('privacy and accounting of garage supporters', () => {
  it('counts repeat payments by private normalized email while returning public fields only', async () => {
    const rows = await asRole(db, 'anon', "select * from get_garage_supporters('project-s6',100,0)");
    expect(rows).toHaveLength(6);
    expect(rows[0]).toEqual({ display_name: 'Alex New', donation_count: 2, amount_cents: 6500 });
    expect(rows.filter((row) => row.display_name === 'Sam')).toHaveLength(2);
    expect(rows.filter((row) => row.display_name === 'No Email')).toHaveLength(2);
    expect(rows.some((row) => row.display_name === 'Supporter')).toBe(true);
    expect(Object.keys(rows[0]).sort()).toEqual(['amount_cents', 'display_name', 'donation_count']);
    expect(JSON.stringify(rows)).not.toMatch(/@|Private name|Pending|Review|Wrong currency|Fully refunded/);
    await expect(asRole(db, 'anon', 'select donor_email from donations')).rejects.toThrow(/permission denied/i);
  });

  it('never folds an unnamed donation into the same donor’s named row', async () => {
    const [project] = (await db.query("insert into projects(slug,title,currency,goal_cents) values('garage-unnamed','Unnamed','usd',1000000) returning id")).rows;
    await db.query(`insert into donations(project_id,attempt_id,amount_cents,currency,status,is_public,display_name,donor_email,paid_at)
      values
      ($1,gen_random_uuid(),1000,'usd','paid',true,'Alex','alex@example.com','2026-10-01'),
      ($1,gen_random_uuid(),500,'usd','paid',true,null,'alex@example.com','2026-10-02'),
      ($1,gen_random_uuid(),2000,'usd','paid',true,'Alex','alex@example.com','2026-10-03'),
      ($1,gen_random_uuid(),300,'usd','paid',true,'anonymous','alex@example.com','2026-10-04'),
      ($1,gen_random_uuid(),100,'usd','paid',true,'alex@example.com','alex@example.com','2026-10-05')`, [project.id]);
    const rows = await asRole(db, 'anon', "select * from get_garage_supporters('garage-unnamed',100,0)");
    expect(rows).toEqual([
      { display_name: 'Alex', donation_count: 2, amount_cents: 3000 },
      { display_name: 'Anonymous', donation_count: 1, amount_cents: 500 },
      { display_name: 'Anonymous', donation_count: 1, amount_cents: 300 },
      { display_name: 'Supporter', donation_count: 1, amount_cents: 100 },
    ]);
  });

  it('pages past 100 donors with deterministic ordering and no missing rows', async () => {
    const first = await asRole(db, 'anon', "select * from get_garage_supporters('garage-pages',100,0)");
    const second = await asRole(db, 'anon', "select * from get_garage_supporters('garage-pages',100,100)");
    const third = await asRole(db, 'anon', "select * from get_garage_supporters('garage-pages',100,200)");
    const complete = [...first, ...second, ...third];
    expect([first.length, second.length, third.length]).toEqual([100, 100, 5]);
    expect(new Set(complete.map((row) => row.display_name)).size).toBe(205);
    expect(complete[0].display_name).toBe('Page 001');
    expect(complete.at(-1).display_name).toBe('Page 205');
    expect(await asRole(db, 'anon', "select * from get_garage_supporters('garage-pages',100,100)")).toEqual(second);
    expect(await asRole(db, 'anon', "select * from get_garage_supporters('garage-pages',10000,-10)")).toEqual(first);
  });

  it('exposes only published campaign aggregates to explicitly allowed API roles', async () => {
    expect(await asRole(db, 'anon', "select * from get_garage_supporters('garage-hidden')")).toEqual([]);
    expect(await asRole(db, 'anon', "select * from get_garage_supporters('missing-project')")).toEqual([]);
    expect(await asRole(db, 'authenticated', "select * from get_garage_supporters('project-s6')")).toHaveLength(6);
    await expect(asRole(db, 'garage_no_access', "select * from get_garage_supporters('project-s6')")).rejects.toThrow(/permission denied/i);
  });
});
