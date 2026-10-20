import dotenv from 'dotenv';
import { readFile } from 'node:fs/promises';
import { createClient } from '@supabase/supabase-js';
dotenv.config({quiet:true});dotenv.config({path:'server/.env',quiet:true});
const args=process.argv.slice(2);
const project=args[args.indexOf('--project')+1];
const version=args.includes('--version')?args[args.indexOf('--version')+1]:'v1';
if(!args.includes('--project')||!/^[0-9a-f-]{36}$/.test(project||'')||!/^[a-z0-9-]{1,40}$/.test(version||'')) throw new Error('Usage: npm run upload:models -- --project <project UUID> --version v1');
const url=process.env.SUPABASE_URL,key=process.env.SUPABASE_SECRET_KEY||process.env.SUPABASE_SERVICE_ROLE_KEY;
if(!url||!key)throw new Error('Configure SUPABASE_URL and SUPABASE_SECRET_KEY in server/.env first.');
const client=createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}});
const {data,error}=await client.from('projects').select('id').eq('id',project).single();
if(error||!data)throw new Error('The project does not exist or could not be verified.');
const files=[['public/models/s6-c5.glb','s6-c5.glb','model/gltf-binary'],['public/models/garage.glb','garage.glb','model/gltf-binary'],['public/textures/garage-lighting.hdr','garage-lighting.hdr','image/vnd.radiance']];
// Validate every local file before publishing any. New version paths cannot
// overwrite existing cached releases; the operator explicitly selects the version.
const prepared=await Promise.all(files.map(async([path,name,type])=>({name,type,body:await readFile(path)})));
for(const file of prepared) {
  const {error:failure}=await client.storage.from('project-models').upload(`${project}/${version}/${file.name}`,file.body,{contentType:file.type,cacheControl:'31536000',upsert:false});
  if(failure)throw new Error(`Upload failed for ${file.name}. Verify the bucket migration and use a new version for an existing release.`);
  console.log(`Uploaded ${file.name} (${file.body.length} bytes).`);
}
const base=`${url.replace(/\/+$/,'')}/storage/v1/object/public/project-models/${project}/${version}`;
console.log(`Set VITE_MODEL_ASSET_BASE_URL=${base}`);
console.log('Set MODEL_ASSET_BASE_URL to the same URL on the API, then rebuild the frontend.');
