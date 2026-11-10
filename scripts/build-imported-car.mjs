// Release the user's textured Audi with fitted glazing and calibrated geometry.
// The source upload, preview derivative and authored garage remain untouched.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {existsSync,mkdirSync,readFileSync,writeFileSync,copyFileSync,readdirSync} from 'node:fs';
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
import {createImportedCarMaterials,finishImportedCarComponents} from './imported-car-materials.mjs';
import {optimizeImportedCarTopology} from './imported-car-topology.mjs';
import {removeImportedRunningGear,batchWheelComponents} from './imported-car-running-gear.mjs';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const release='imported-v4',directory=path.join(root,'public','car-releases',release);
const working=path.join(root,'output','car-refinement',release);
// The editable Blender wheel project and its export stay where MODULAR-AUDI-PARTS.md documents them.
const wheelWorking=path.join(root,'output','car-refinement','imported-v3');
// Full-detail normalized upload from prepare-imported-car.mjs. The simplified
// model-web.glb preview must not be used here: it crumples the body panels.
const input=process.env.CAR_INPUT?path.resolve(process.env.CAR_INPUT):path.join(root,'output','car-refinement','imported','model-clean.glb');
assert.ok(existsSync(input),'Run node scripts/prepare-imported-car.mjs first to create model-clean.glb.');
const garage=path.join(root,'public','models','garage.glb');
const digest=file=>createHash('sha256').update(readFileSync(file)).digest('hex');
const sourceHash=digest(input),garageHash=digest(garage);
const args=process.argv.slice(2),cliIndex=args.indexOf('--cli');
const value=(flag,fallback)=>{const index=args.indexOf(flag);return index<0?fallback:args[index+1];};
const run=(command,commandArgs)=>new Promise((resolve,reject)=>{
  const child=spawn(command,commandArgs,{cwd:root,stdio:'inherit',windowsHide:true});
  child.on('error',reject);child.on('exit',code=>code===0?resolve():reject(new Error(`${path.basename(command)} exited ${code}`)));
});
function findBlender(){
  const explicit=value('--blender',process.env.BLENDER_BIN);
  if(explicit){assert.ok(existsSync(explicit),'Configured Blender executable is missing.');return explicit;}
  const base=path.join(process.env.ProgramFiles||'C:\\Program Files','Blender Foundation');
  if(existsSync(base))for(const folder of readdirSync(base).sort().reverse()){
    const candidate=path.join(base,folder,'blender.exe');if(existsSync(candidate))return candidate;
  }
  throw new Error('Blender is required to author modular wheels; pass --blender PATH.');
}
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
const {MeshoptDecoder,MeshoptSimplifier}=requireTool('meshoptimizer');
const functions=requireTool('@gltf-transform/functions');
const sharp=requireTool('sharp');
await MeshoptDecoder.ready;
await MeshoptSimplifier.ready;
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

const surfaceCleanup=await prepareImportedCarSurfaces(document,sourceNode,{cliPath:cli,iterations:26,maxDisplacement:.018});
const originalIndices=primitive.getIndices().getArray(),paintTriangleKeys=new Set();
for(let face=0;face<surfaceCleanup.paintTriangleMask.length;face++)if(surfaceCleanup.paintTriangleMask[face]) {
  paintTriangleKeys.add(`${originalIndices[face*3]},${originalIndices[face*3+1]},${originalIndices[face*3+2]}`);
}
const material=primitive.getMaterial(),colour=material.getBaseColorTexture();
const textureHash=createHash('sha256').update(colour.getImage()).digest('hex');
const clearcoat=document.createExtension(KHRMaterialsClearcoat);
const finishes=await createImportedCarMaterials(document,material,{sharp,clearcoatExtension:clearcoat});
const glazing=addImportedCarWindows(document,{scene,buffer,clearcoatExtension:clearcoat});
const partition=await partitionImportedCar(document,sourceNode,{cliPath:cli});
const roofbox=replaceImportedCarRoofbox(document,partition.nodes.find(node=>node.getExtras().partId==='roof-box'),{clearcoatExtension:clearcoat});
const {geometryStats:paint}=finishImportedCarPaint(document,partition.nodes,{paintTriangleKeys,paintMaterial:finishes.paint,clearcoatExtension:clearcoat});
const materials=finishImportedCarComponents(document,partition.nodes,finishes);
mesh.dispose();primitive.dispose();
const calibration=calibrateImportedCar(document);
const runningGearRemoval=removeImportedRunningGear(document);
const topology=await optimizeImportedCarTopology(document,{functions,simplifier:MeshoptSimplifier});
const anchors=Object.fromEntries(Object.entries(partition.anchors).map(([part,candidates])=>[part,candidates.map(({position,normal})=>({position:mapImportedCarPoint(position),normal:mapImportedCarNormal(position,normal)}))]));

mkdirSync(directory,{recursive:true});mkdirSync(working,{recursive:true});
const bodyFile=path.join(working,'body-for-blender.glb'),wheelFile=path.join(wheelWorking,'modular-wheels.glb');
await io.write(bodyFile,document);
if(!args.includes('--reuse-wheels'))await run(findBlender(),['--background','--factory-startup','--python',path.join(root,'scripts','build_modular_wheels.py'),'--','--body',bodyFile,'--out-dir',wheelWorking]);
assert.ok(existsSync(wheelFile),'Build the Blender parts before using --reuse-wheels.');
const wheelDocument=await io.read(wheelFile),map=functions.mergeDocuments(document,wheelDocument);
for(const sourceScene of wheelDocument.getRoot().listScenes()){
  const mergedScene=map.get(sourceScene);
  for(const child of [...mergedScene.listChildren()])scene.addChild(child);
  mergedScene.dispose();
}
const batching=batchWheelComponents(document,functions);
await document.transform(functions.unpartition(),functions.prune());
const modularWheels={...JSON.parse(readFileSync(path.join(wheelWorking,'modular-wheels.json'),'utf8')),removedImportedGeometry:runningGearRemoval,batching};
const renderedPrimitives=()=>modelRoot.listNodes().flatMap(node=>node.getMesh()?.listPrimitives()??[]);
topology.importedBodyTriangles=topology.trianglesAfter;
topology.trianglesAfter=renderedPrimitives().reduce((sum,p)=>sum+p.getIndices().getCount()/3,0);
topology.modularTriangles=topology.trianglesAfter-topology.importedBodyTriangles;
anchors.wheels=[1,-1].map(side=>({position:[1.4,.323,side*.915],normal:[0,0,side]}));
anchors['brake-kit']=[1,-1].map(side=>({position:[-1.496,.338,side*.8765],normal:[0,0,side]}));
const rawFile=path.join(working,'car-uncompressed.glb'),output=path.join(working,'s6-c5.glb');
await io.write(rawFile,document);
await new Promise((resolve,reject)=>{
  const child=spawn(process.execPath,[cli,'meshopt',rawFile,output,'--level','medium','--quantize-position','16','--quantize-normal','14','--quantize-texcoord','16'],{cwd:root,stdio:'inherit',windowsHide:true});
  child.on('error',reject);child.on('exit',code=>code===0?resolve():reject(new Error(`Meshopt exited ${code}`)));
});
const exported=await io.read(output),exportedRoot=exported.getRoot();
const finalScene=exportedRoot.getDefaultScene()||exportedRoot.listScenes()[0],bounds=getBounds(finalScene);
const primitives=exportedRoot.listNodes().flatMap(node=>node.getMesh()?.listPrimitives()??[]);
const parts=[...new Set(exportedRoot.listNodes().map(node=>node.getExtras().partId).filter(Boolean))].sort();
assert.equal(digest(input),sourceHash);assert.equal(digest(garage),garageHash);
assert.ok(exportedRoot.listTextures().some(texture=>createHash('sha256').update(texture.getImage()).digest('hex')===textureHash),'The original colour atlas must remain embedded.');
// Fallback reflection probe (the viewer normally captures the real garage).
// Regenerate with make-car-environment.mjs; older releases are only a source for the first copy.
if(!existsSync(path.join(directory,'paint-studio.hdr'))){
  const probe=['imported-v3','reference-v2'].map(name=>path.join(root,'public','car-releases',name,'paint-studio.hdr')).find(existsSync);
  assert.ok(probe,'Run node scripts/make-car-environment.mjs to create paint-studio.hdr.');
  copyFileSync(probe,path.join(directory,'paint-studio.hdr'));
}
const manifest={release,url:`/car-releases/${release}/s6-c5.glb`,source:{file:'User-provided model.glb; full-detail normalized copy',sha256:sourceHash,colourAtlasSha256:textureHash},coordinates:{unit:'metres',up:'+Y',vehicleNose:'+X',driverSide:'+Z',ground:0},car:{file:`/car-releases/${release}/s6-c5.glb`,bytes:readFileSync(output).length,sha256:digest(output),meshes:exportedRoot.listMeshes().length,drawCalls:primitives.length,triangles:primitives.reduce((sum,p)=>sum+p.getIndices().getCount()/3,0),bounds,parts,compression:'Meshopt medium; 16-bit positions, 14-bit normals, 16-bit UVs'},anchors,glazing:{panes:glazing.panes,triangles:glazing.triangles},partition:{parts:partition.parts,sourceTriangles:partition.sourceTriangles,classification:partition.classification},surfaceCleanup:surfaceCleanup.stats,paint,roofbox,materials,topology,modularWheels,calibration,garageSha256:garageHash,notes:['Uploaded car body retained; running gear reconstructed as editable Blender parts.','Original colour texture and source files preserved.','Geometry calibrated locally around wheels; no blanket horizontal stretch.','Untextured pearl paint with physical clearcoat; separate rubber, alloy, chrome, lamp and cabin finishes.','Built from the full-detail upload; duplicate and zero-area faces removed; one bounded simplification with locked borders.','Tailgate window released as opaque privacy glass; side panes sit 9 mm behind the aperture lips.','Separate road/track tyres, rims, drilled discs, calipers, pads and backing plates.']};
writeFileSync(path.join(working,'manifest.json'),JSON.stringify(manifest,null,2)+'\n');
if(args.includes('--publish')){
  copyFileSync(output,path.join(directory,'s6-c5.glb'));
  copyFileSync(path.join(working,'manifest.json'),path.join(directory,'manifest.json'));
}
console.log(JSON.stringify({release,bytes:manifest.car.bytes,triangles:manifest.car.triangles,drawCalls:manifest.car.drawCalls,bounds,parts,calibration},null,2));
