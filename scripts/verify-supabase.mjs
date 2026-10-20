// Read-only hosted checks using the browser key. No test payments/subscribers.
import dotenv from 'dotenv';
import assert from 'node:assert/strict';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
dotenv.config({path:'.env.local',quiet:true});dotenv.config({quiet:true});
const url=process.env.VITE_SUPABASE_URL,key=process.env.VITE_SUPABASE_PUBLISHABLE_KEY;
assert.ok(url&&key,'Configure the public Supabase URL and publishable key.');
const client=createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}});
const slug=process.env.VITE_PROJECT_SLUG||'project-s6';
const checked=({data,error})=>{if(error)throw new Error(error.message);return data;};
const project=checked(await client.from('projects').select('id,slug,goal_cents,currency').eq('slug',slug).single());
assert.equal(Number(project.goal_cents),1000000);assert.equal(project.currency,'usd');
const parts=checked(await client.from('parts').select('id,slug,estimate_cents,priority').eq('project_id',project.id));
assert.ok(parts.length>0);
const summary=checked(await client.rpc('get_campaign_summary',{p_slug:slug}));
const funding=checked(await client.rpc('get_part_funding',{p_slug:slug}));
assert.equal(funding.length,parts.length);
checked(await client.rpc('get_public_contributions',{p_slug:slug,p_limit:10}));
for(const table of ['restoration_updates','community_posts'])checked(await client.from(table).select('id').eq('project_id',project.id).limit(1));
const privateAccess=[];
for(const table of ['donations','stripe_events','subscribers','email_jobs']){
  const {error}=await client.from(table).select('*').limit(1);
  assert.ok(error,`${table} must reject anonymous reads`);
  assert.equal(error.code,'42501',`${table} fails for permission, not an unrelated API error`);
  privateAccess.push({table,denied:true});
}
const base=process.env.VITE_MODEL_ASSET_BASE_URL;
assert.ok(base?.includes(`/project-models/${project.id}/`));
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const assets=[];
for(const [name,path] of [['s6-c5.glb','public/models/s6-c5.glb'],['garage.glb','public/models/garage.glb'],['garage-lighting.hdr','public/textures/garage-lighting.hdr']]){
  const response=await fetch(`${base}/${name}`);assert.ok(response.ok,`${name} downloads`);
  const body=Buffer.from(await response.arrayBuffer());
  assert.equal(hash(body),hash(await readFile(path)),`${name} matches the local export`);
  assert.match(response.headers.get('cache-control')||'',/max-age=31536000/);
  assets.push({name,bytes:body.length,sha256:hash(body)});
}
const report={verifiedAt:new Date().toISOString(),project,partCount:parts.length,summary,privateAccess,assets};
await mkdir('output/supabase-verification',{recursive:true});
await writeFile('output/supabase-verification/live-checks.json',JSON.stringify(report,null,2));
console.log(JSON.stringify(report,null,2));
