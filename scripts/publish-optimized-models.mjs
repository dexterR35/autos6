import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, copyFileSync, statSync } from 'node:fs';
const parse=(path)=>{const data=readFileSync(path);assert.equal(data.toString('utf8',0,4),'glTF');return JSON.parse(data.toString('utf8',20,20+data.readUInt32LE(12)));};
const stats=(gltf)=>({
  triangles:gltf.meshes.reduce((sum,mesh)=>sum+mesh.primitives.reduce((total,p)=>total+gltf.accessors[p.indices].count/3,0),0),
  parts:[...new Set(gltf.nodes.map(n=>n.extras?.partId).filter(Boolean))].sort(),
  materials:gltf.materials.map(m=>m.name).sort(),
});
const manifest=JSON.parse(readFileSync('public/models/scene-info.json','utf8'));
for(const [file,key] of [['s6-c5.glb','car'],['garage.glb','garage']]) {
  const source=`output/model-optimization/originals/${file}`,optimized=`output/model-optimization/${file}`;
  const before=stats(parse(source)),gltf=parse(optimized),after=stats(gltf);
  assert.equal(after.triangles,before.triangles,'Triangle topology retained');
  assert.deepEqual(after.parts,before.parts,'Interactive part metadata retained');
  assert.deepEqual(after.materials,before.materials,'Material identity retained');
  copyFileSync(optimized,`public/models/${file}`);
  manifest[key].uncompressedBytes=statSync(source).size;
  manifest[key].bytes=statSync(optimized).size;
  manifest[key].extensions=gltf.extensionsUsed;
  manifest[key].compression='Meshopt; 16-bit positions, 14-bit normals, topology unchanged';
  console.log(`${file}: ${manifest[key].uncompressedBytes} -> ${manifest[key].bytes} bytes, ${after.triangles} triangles retained.`);
}
writeFileSync('public/models/scene-info.json',JSON.stringify(manifest,null,2)+'\n');
