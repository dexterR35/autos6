import { beforeAll, describe, expect, it } from 'vitest';
import { asRole, createTestDb } from './helpers/pg.js';
let db, project;
const account='33333333-3333-4333-8333-333333333333';
beforeAll(async()=>{
  db=await createTestDb();
  project=(await db.query("select id from public.projects where slug='project-s6'")).rows[0].id;
});
describe('trusted owner invitations',()=>{
  it('waits for email verification, then consumes the matching invitation',async()=>{
    await db.query("insert into private.project_owner_invitations(project_id,email,expires_at) values($1,'owner-invite@example.com',now()+interval '1 day')",[project]);
    await db.query("insert into auth.users(id,email,email_confirmed_at) values($1,'owner-invite@example.com',null)",[account]);
    expect((await db.query('select * from public.project_admins where user_id=$1',[account])).rows).toHaveLength(0);
    await db.query('update auth.users set email_confirmed_at=now() where id=$1',[account]);
    expect((await db.query('select * from public.project_admins where user_id=$1',[account])).rows).toHaveLength(1);
    expect((await db.query('select * from private.project_owner_invitations')).rows).toHaveLength(0);
  });
  it('does not grant access for an expired invitation or another email',async()=>{
    await db.query("insert into private.project_owner_invitations(project_id,email,expires_at) values($1,'expired@example.com',now()-interval '1 day')",[project]);
    await db.exec("insert into auth.users(id,email,email_confirmed_at) values(gen_random_uuid(),'expired@example.com',now()),(gen_random_uuid(),'stranger@example.com',now())");
    expect((await db.query('select * from public.project_admins')).rows).toHaveLength(1);
  });
  it('does not expose invitations or allow visitors to manufacture one',async()=>{
    for(const role of ['anon','authenticated']){
      await expect(asRole(db,role,'select * from private.project_owner_invitations')).rejects.toThrow(/permission denied/i);
      await expect(asRole(db,role,"insert into private.project_owner_invitations values($1,'attacker@example.com',now()+interval '1 day',now())",[project])).rejects.toThrow(/permission denied/i);
    }
  });
});
