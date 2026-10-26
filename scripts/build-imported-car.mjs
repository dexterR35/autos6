// Release the user's textured Audi with fitted glazing and calibrated geometry.
// The source upload, preview derivative and authored garage remain untouched.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {existsSync,mkdirSync,readFileSync,writeFileSync,copyFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawn} from 'node:child_process';
import * as THREE from 'three';
import {addImportedCarWindows} from './imported-car-windows.mjs';
import {partitionImportedCar} from './imported-car-parts.mjs';
import {calibrateImportedCar,mapImportedCarPoint,mapImportedCarNormal} from './imported-car-calibration.mjs';
import {prepareImportedCarSurfaces} from './imported-car-surfaces.mjs';
import {finishImportedCarPaint} from './imported-car-paint.mjs';
import {replaceImportedCarRoofbox} from './imported-car-roofbox.mjs';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const release='imported-v3',directory=path.join(root,'public','car-releases',release);
const working=path.join(root,'output','car-refinement',release);
const input=path.join(root,'output','car-refinement','imported','model-web.glb');
const garage=path.join(root,'public','models','garage.glb');
const digest=file=>createHash('sha256').update(readFileSync(file)).digest('hex');
const sourceHash=digest(input),garageHash=digest(garage);
const args=process.argv.slice(2),cliIndex=args.indexOf('--cli');
function findCli(){
  if(cliIndex>=0)return path.resolve(args[cliIndex+1]);
  const local=path.join(root,'node_modules','@gltf-transform','cli','bin','cli.js');
  if(existsSync(local))return local;
  // Only the version pinned in package.json (or an explicit --cli): never a copy from the npx cache.
  throw new Error('Run npm install for the pinned @gltf-transform/cli, or pass --cli PATH.');
}
const cli=findCli(),requireTool=createRequire(cli);
const {NodeIO,getBounds}=requireTool('@gltf-transform/core');
const {ALL_EXTENSIONS,KHRMaterialsClearcoat}=requireTool('@gltf-transform/extensions');
const {MeshoptDecoder}=requireTool('meshoptimizer');
const sharp=requireTool('sharp');
await MeshoptDecoder.ready;
const io=new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({'meshopt.decoder':MeshoptDecoder});
const document=await io.read(input),modelRoot=document.getRoot();
const scene=modelRoot.getDefaultScene()||modelRoot.listScenes()[0];
const nodes=[...modelRoot.listNodes()],sources=nodes.filter(node=>node.getMesh());
assert.equal(sources.length,1,'Review imports with several mesh nodes before releasing them.');
const original=sources[0],mesh=original.getMesh();
assert.equal(mesh.listPrimitives().length,1);
const primitive=mesh.listPrimitives()[0],buffer=modelRoot.listBuffers()[0];
const matrix=new THREE.Matrix4().fromArray(original.getWorldMatrix());
const normalMatrix=new THREE.Matrix3().getNormalMatrix(matrix);
const values=[],vector=new THREE.Vector3();
for(const [semantic,transform] of [['POSITION',true],['NORMAL',false]]){
  const source=primitive.getAttribute(semantic),array=new Float32Array(source.getCount()*3);
  for(let i=0;i<source.getCount();i++){
    source.getElement(i,values);vector.fromArray(values);
    if(transform)vector.applyMatrix4(matrix);else vector.applyMatrix3(normalMatrix).normalize();
    vector.toArray(array,i*3);
  }
  primitive.setAttribute(semantic,document.createAccessor(`Imported Audi | world ${semantic}`).setType('VEC3').setArray(array).setBuffer(buffer));
}
for(const child of [...scene.listChildren()])scene.removeChild(child);
for(const node of nodes)node.dispose();
const sourceNode=document.createNode('Imported Audi | textured source').setMesh(mesh);
scene.addChild(sourceNode);
// Read-time decompression has already produced ordinary accessor data.
for(const extension of [...modelRoot.listExtensionsUsed()])if(extension.extensionName==='EXT_meshopt_compression')extension.dispose();

const surfaceCleanup=await prepareImportedCarSurfaces(document,sourceNode,{cliPath:cli});
const originalIndices=primitive.getIndices().getArray(),paintTriangleKeys=new Set();
for(let face=0;face<surfaceCleanup.paintTriangleMask.length;face++)if(surfaceCleanup.paintTriangleMask[face]) {
  paintTriangleKeys.add(`${originalIndices[face*3]},${originalIndices[face*3+1]},${originalIndices[face*3+2]}`);
}
// Preserve the colour atlas for trim, plates and lamps. Painted panels receive
// their own clean lacquer below, removing photographed highlights from paint.
const material=primitive.getMaterial(),colour=material.getBaseColorTexture();
const textureHash=createHash('sha256').update(colour.getImage()).digest('hex');
const raw=await sharp(colour.getImage()).resize(1024,1024).removeAlpha().raw().toBuffer({resolveWithObject:true});
const packed=Buffer.alloc(raw.info.width*raw.info.height*3);
const coatPixels=Buffer.alloc(packed.length);
const blueWeight=(r,g,b)=>Math.min(1,Math.max(0,(b-r-2)/10))*Math.min(1,Math.max(0,(b-g-1)/8));
for(let i=0;i<raw.info.width*raw.info.height;i++){
  const r=raw.data[i*raw.info.channels],g=raw.data[i*raw.info.channels+1],b=raw.data[i*raw.info.channels+2];
  const weight=blueWeight(r,g,b),grey=(r+g+b)/3;
  packed[i*3]=255;packed[i*3+1]=Math.round(255*((grey>65?.48:.82)*(1-weight)+.18*weight));
  packed[i*3+2]=Math.round(255*((grey>65?.50:.035)*(1-weight)+.68*weight));
  coatPixels[i*3]=Math.round(weight*255);coatPixels[i*3+1]=9;coatPixels[i*3+2]=0;
}
const packedBytes=await sharp(packed,{raw:{width:raw.info.width,height:raw.info.height,channels:3}}).png().toBuffer();
const mask=document.createTexture('Imported Audi | paint and trim material mask').setMimeType('image/png').setImage(packedBytes);
material.setName('Imported Audi | textured trim and components').setMetallicFactor(1).setRoughnessFactor(1).setMetallicRoughnessTexture(mask);
const clearcoat=document.createExtension(KHRMaterialsClearcoat);
// Neutralize baked blue highlights continuously in UV space. A per-triangle
// paint switch created sawtooth colour boundaries on curved wheel arches.
const albedo=await sharp(colour.getImage()).removeAlpha().raw().toBuffer({resolveWithObject:true});
const neutral=[22,46,82];
for(let i=0;i<albedo.info.width*albedo.info.height;i++){
  const offset=i*albedo.info.channels,weight=blueWeight(albedo.data[offset],albedo.data[offset+1],albedo.data[offset+2]);
  for(let channel=0;channel<3;channel++)albedo.data[offset+channel]=Math.round(albedo.data[offset+channel]*(1-weight)+neutral[channel]*weight);
}
const cleanBytes=await sharp(albedo.data,{raw:{width:albedo.info.width,height:albedo.info.height,channels:albedo.info.channels}}).jpeg({quality:94,chromaSubsampling:'4:4:4'}).toBuffer();
const cleanColour=document.createTexture('Imported Audi | clean blue albedo').setMimeType('image/jpeg').setImage(cleanBytes);
const coatBytes=await sharp(coatPixels,{raw:{width:raw.info.width,height:raw.info.height,channels:3}}).blur(.5).png().toBuffer();
const coatMap=document.createTexture('Imported Audi | lacquer mask').setMimeType('image/png').setImage(coatBytes);
const polished=material.clone().setName('Imported Audi | polished blue paint and trim').setBaseColorTexture(cleanColour);
polished.setExtension('KHR_materials_clearcoat',clearcoat.createClearcoat().setClearcoatFactor(1).setClearcoatRoughnessFactor(1).setClearcoatTexture(coatMap).setClearcoatRoughnessTexture(coatMap));
const glazing=addImportedCarWindows(document,{scene,buffer,clearcoatExtension:clearcoat});
const partition=await partitionImportedCar(document,sourceNode,{cliPath:cli});
const roofbox=replaceImportedCarRoofbox(document,partition.nodes.find(node=>node.getExtras().partId==='roof-box'),{clearcoatExtension:clearcoat});
for(const node of partition.nodes)if(!['roof-box','brake-kit'].includes(node.getExtras().partId))for(const primitive of node.getMesh().listPrimitives())primitive.setMaterial(polished);
const {geometryStats:paint}=finishImportedCarPaint(document,partition.nodes,{paintTriangleKeys,paintMaterial:polished,clearcoatExtension:clearcoat});
mesh.dispose();primitive.dispose();
const calibration=calibrateImportedCar(document);
const anchors=Object.fromEntries(Object.entries(partition.anchors).map(([part,candidates])=>[part,candidates.map(({position,normal})=>({position:mapImportedCarPoint(position),normal:mapImportedCarNormal(position,normal)}))]));

mkdirSync(directory,{recursive:true});mkdirSync(working,{recursive:true});
const rawFile=path.join(working,'car-uncompressed.glb'),output=path.join(working,'s6-c5.glb');
await io.write(rawFile,document);
await new Promise((resolve,reject)=>{
  const child=spawn(process.execPath,[cli,'meshopt',rawFile,output,'--level','medium','--quantize-position','16','--quantize-normal','14','--quantize-texcoord','16'],{cwd:root,stdio:'inherit',windowsHide:true});
  child.on('error',reject);child.on('exit',code=>code===0?resolve():reject(new Error(`Meshopt exited ${code}`)));
});
const exported=await io.read(output),exportedRoot=exported.getRoot();
const finalScene=exportedRoot.getDefaultScene()||exportedRoot.listScenes()[0],bounds=getBounds(finalScene);
const primitives=exportedRoot.listMeshes().flatMap(mesh=>mesh.listPrimitives());
const parts=[...new Set(exportedRoot.listNodes().map(node=>node.getExtras().partId).filter(Boolean))].sort();
assert.equal(digest(input),sourceHash);assert.equal(digest(garage),garageHash);
assert.ok(exportedRoot.listTextures().some(texture=>createHash('sha256').update(texture.getImage()).digest('hex')===textureHash),'The original colour atlas must remain embedded.');
copyFileSync(path.join(root,'public','car-releases','reference-v2','paint-studio.hdr'),path.join(directory,'paint-studio.hdr'));
const manifest={release,url:`/car-releases/${release}/s6-c5.glb`,source:{file:'User-provided model.glb; optimized preview derivative',sha256:sourceHash,colourAtlasSha256:textureHash},coordinates:{unit:'metres',up:'+Y',vehicleNose:'+X',driverSide:'+Z',ground:0},car:{file:`/car-releases/${release}/s6-c5.glb`,bytes:readFileSync(output).length,sha256:digest(output),meshes:exportedRoot.listMeshes().length,drawCalls:primitives.length,triangles:primitives.reduce((sum,p)=>sum+p.getIndices().getCount()/3,0),bounds,parts,compression:'Meshopt medium; 16-bit positions, 14-bit normals, 16-bit UVs'},anchors,glazing:{panes:glazing.panes,triangles:glazing.triangles},partition:{parts:partition.parts,sourceTriangles:partition.sourceTriangles,classification:partition.classification},surfaceCleanup:surfaceCleanup.stats,paint,roofbox,calibration,garageSha256:garageHash,notes:['Uploaded car replaces the procedural car.','Original colour texture and source files preserved.','Geometry calibrated locally around wheels; no blanket horizontal stretch.','Clean painted surfaces and a smooth gloss-black touring box replace baked highlights and noisy reflections.']};
writeFileSync(path.join(working,'manifest.json'),JSON.stringify(manifest,null,2)+'\n');
if(args.includes('--publish')){
  copyFileSync(output,path.join(directory,'s6-c5.glb'));
  copyFileSync(path.join(working,'manifest.json'),path.join(directory,'manifest.json'));
}
console.log(JSON.stringify({release,bytes:manifest.car.bytes,triangles:manifest.car.triangles,drawCalls:manifest.car.drawCalls,bounds,parts,calibration},null,2));
