import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { HDRLoader } from 'three/addons/loaders/HDRLoader.js';
import { assetBaseUrl } from '../src/lib/modelAssets.js';
import { validatePublicEnv } from '../vite/validatePublicEnv.js';
import { asRole, createTestDb, createUser, makeOwner } from './helpers/pg.js';
import { includePublicAsset } from '../vite/modelAssetsPlugin.js';

describe('production model delivery',()=>{
  it('requires Supabase model hosting in live mode, while demo remains usable locally',()=>{
    expect(()=>validatePublicEnv({VITE_DEMO_MODE:'false'})).toThrow(/requires VITE_MODEL_ASSET_BASE_URL/);
    expect(()=>validatePublicEnv({VITE_DEMO_MODE:'FALSE'})).toThrow(/requires VITE_MODEL_ASSET_BASE_URL/);
    expect(()=>validatePublicEnv({VITE_DEMO_MODE:'true'})).not.toThrow();
    expect(()=>validatePublicEnv({VITE_DEMO_MODE:'false',VITE_MODEL_ASSET_BASE_URL:'https://project.supabase.co/storage/v1/object/public/project-models/project-id/v1'})).not.toThrow();
    expect(()=>validatePublicEnv({VITE_DEMO_MODE:'false',VITE_MODEL_ASSET_BASE_URL:'https://elsewhere.example/models'})).toThrow(/Supabase/);
    expect(()=>assetBaseUrl('javascript:alert(1)')).toThrow();
    expect(assetBaseUrl('https://project.supabase.co/storage/v1/object/public/project-models/project-id/v1/')).not.toMatch(/\/$/);
    expect(includePublicAsset('models/s6-c5.glb')).toBe(false);
    expect(includePublicAsset('textures/garage-lighting.hdr')).toBe(false);
    expect(includePublicAsset('assets/car/parts/wheels.webp')).toBe(true);
  });
  it('ships embedded compressed geometry and a valid small HDR environment',()=>{
    let bytes=0;
    for(const name of ['s6-c5','garage']) {
      const buffer=readFileSync(`public/models/${name}.glb`);bytes+=buffer.length;
      const gltf=JSON.parse(buffer.toString('utf8',20,20+buffer.readUInt32LE(12)));
      expect(gltf.extensionsRequired).toContain('EXT_meshopt_compression');
      expect(gltf.images.every(image=>image.bufferView!==undefined)).toBe(true);
    }
    expect(bytes).toBeLessThan(3500000);
    const buffer=readFileSync('public/textures/garage-lighting.hdr');
    const hdr=new HDRLoader().parse(buffer.buffer.slice(buffer.byteOffset,buffer.byteOffset+buffer.byteLength));
    expect(hdr.width).toBe(512);expect(hdr.height).toBe(256);expect(buffer.length).toBeLessThan(20000);
  });
  it('permits model writes only in an owner’s project folder',async()=>{
    const pg=await createTestDb();
    try {
      const owner='11111111-1111-4111-8111-111111111111',other='22222222-2222-4222-8222-222222222222';
      await createUser(pg,owner,'owner@example.com');await createUser(pg,other,'other@example.com');await makeOwner(pg,owner);
      const id=(await pg.query('select id from projects')).rows[0].id;
      const sql="insert into storage.objects(bucket_id,name)values('project-models',$1)";
      await asRole(pg,'authenticated',sql,[`${id}/v1/s6-c5.glb`],owner);
      await expect(asRole(pg,'authenticated',sql,[`${id}/v1/garage.glb`],other)).rejects.toThrow(/row-level security/i);
      await expect(asRole(pg,'anon',sql,[`${id}/v1/garage.glb`])).rejects.toThrow(/row-level security|permission denied/i);
      const [bucket]=(await pg.query("select public,file_size_limit from storage.buckets where id='project-models'")).rows;
      expect(bucket.public).toBe(true);expect(Number(bucket.file_size_limit)).toBe(26214400);
    } finally {await pg.close();}
  });
});
