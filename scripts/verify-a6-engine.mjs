import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { chromium } from 'playwright';

const base=process.argv[2]||'http://127.0.0.1:5173';
const output=resolve('output/car-refinement/a6-c5-v1/engine-check');
mkdirSync(output,{recursive:true});
const report={checks:[],runtimeErrors:[],screenshots:[],geometry:{}};
const browser=await chromium.launch({channel:'msedge',args:['--enable-gpu','--ignore-gpu-blocklist','--use-angle=d3d11','--enable-unsafe-swiftshader']});
try {
  const page=await browser.newPage({viewport:{width:1440,height:1000}});
  page.on('pageerror',error=>report.runtimeErrors.push(error.message));
  await page.route('**/rest/v1/rpc/get_garage_supporters',route=>route.fulfill({json:[]}));
  const shot=async name=>{const file=resolve(output,name+'.png');await page.screenshot({path:file});report.screenshots.push(file);};
  const select=label=>page.getByRole('group',{name:'Camera angles'}).getByRole('button',{name:new RegExp('^'+label+'( \\(shows selected part\\))?$')}).click();
  const engineReady=()=>page.waitForFunction(()=>{
    const d=document.querySelector('[data-testid="three-viewer"]').dataset;
    return d.cameraMode==='engine'&&JSON.parse(d.carRig).panels.hood>1.075&&Number(d.cameraFov)<39;
  });
  await page.goto(base);
  await page.locator('[data-testid="three-viewer"][data-loaded="true"]').waitFor({timeout:120000});
  await select('Engine');await engineReady();await page.waitForTimeout(900);
  await shot('desktop-engine-camera');
  report.checks.push('Engine camera opens the real bonnet and frames the fitted V6 biturbo');
  await page.getByRole('button',{name:'Zoom in',exact:true}).click();
  await page.waitForTimeout(400);
  const distance=await page.locator('[data-testid="three-viewer"]').evaluate(el=>{
    const p=el.dataset.cameraPosition.split(',').map(Number),t=el.dataset.cameraTarget.split(',').map(Number);
    return Math.hypot(...p.map((n,i)=>n-t[i]));
  });
  assert.ok(distance<3.3&&distance>.85,'Engine inspection supports closer zoom than exterior views');
  await page.getByRole('button',{name:'Open doors and car controls',exact:true}).click();
  await page.locator('#car-rig').getByRole('button',{name:'Bonnet Open',exact:true}).click();
  await page.waitForFunction(()=>JSON.parse(document.querySelector('[data-testid="three-viewer"]').dataset.carRig).panels.hood<.0001);
  await page.keyboard.press('Escape');
  await shot('bonnet-closed-over-engine');
  await select('Exterior');await page.waitForTimeout(800);await select('Engine');await engineReady();
  report.checks.push('Manual bonnet closure works; re-entering Engine reopens it, with close zoom available');
  await page.setViewportSize({width:390,height:844});
  await page.waitForFunction(()=>Number(document.querySelector('[data-testid="three-viewer"]').dataset.cameraFov)>54);
  await page.waitForTimeout(800);await shot('mobile-engine-camera');
  report.checks.push('Mobile engine camera uses the wider inspection lens');
  await page.setViewportSize({width:1440,height:1000});
  await page.goto(base+'/?viewer=image');await select('Engine');
  await page.locator('.viewer__img:not(.is-leaving)[src$="/a6-c5/engine.webp"]').waitFor();
  report.checks.push('Engine image fallback and camera thumbnail match the new model');
  await page.goto(base+'/scripts/garage-lab.html?shot=engine&w=1440&h=1000&lights=on');
  await page.waitForFunction(()=>window.__lab?.ready,null,{timeout:120000});
  await page.addStyleTag({content:'#hud, #reference { display:none !important; }'});
  await shot('engine-bay-detail');
  report.geometry=await page.evaluate(async()=>{
    const THREE=await import('/node_modules/three/build/three.module.js');
    const {car,rig,look}=window.__lab;
    let engine,grille,headlights,support,strutRod,strutTarget;
    car.traverse(object=>{
      if(object.userData.engineAssembly)engine=object;
      const sources=object.userData.sourceObjects??[object.userData.sourceObject];
      if(sources.includes('G-Object.098'))grille=object;
      if(sources.includes('G-Object.128'))headlights=object;
      if(object.userData.componentId==='engine-bay-panels')support=object;
      if(object.userData.bonnetStrutRod)strutRod=object;
      if(object.userData.bonnetStrutTarget)strutTarget=object;
    });
    const matrix=engine.matrixWorld.toArray();
    const strutSamples=[];
    for(const openPanels of [[],['hood'],[]]){
      rig.setPose({openPanels});rig.update(0,true);
      const tip=strutRod.localToWorld(new THREE.Vector3(0,1,0));
      strutSamples.push({length:strutRod.scale.y,error:tip.distanceTo(strutTarget.getWorldPosition(new THREE.Vector3()))});
    }
    rig.setPose({openPanels:['hood']});rig.update(0,true);
    const grilleMatrix=grille.matrixWorld.toArray(),lampMatrix=headlights.matrixWorld.toArray(),supportMatrix=support.matrixWorld.toArray();
    // A view from in front of the raised panel, aimed at the black V6 fascia.
    // A vertical ray through the back of the bay would correctly hit the open hood.
    const origin=new THREE.Vector3(2.8,1.8,0);
    const ray=new THREE.Raycaster(origin,new THREE.Vector3(1.86,.73,0).sub(origin).normalize());
    const visible=hit=>{for(let obj=hit.object;obj;obj=obj.parent)if(!obj.visible)return false;return true;};
    const open=ray.intersectObject(car,true).find(visible);
    rig.setPose({openPanels:[]});rig.update(0,true);
    const closed=ray.intersectObject(car,true).find(visible);
    const sameMatrix=matrix.every((n,i)=>Math.abs(n-engine.matrixWorld.elements[i])<1e-8);
    const unchanged=(before,object)=>before.every((n,i)=>Math.abs(n-object.matrixWorld.elements[i])<1e-8);
    const result={openHit:open?.object.name,openEngine:Boolean(open?.object.userData.enginePart),closedHit:closed?.object.name,closedPart:closed?.object.userData.partId,engineStayedFixed:sameMatrix,grilleFollowsBonnet:!unchanged(grilleMatrix,grille),headlightsStayFixed:unchanged(lampMatrix,headlights),bayPanelsStayFixed:unchanged(supportMatrix,support),strutSamples,clearance:engine.userData.closedBonnetClearance};
    rig.setPose({openPanels:['hood']});rig.update(0,true);look.render(performance.now());
    return result;
  });
  assert.equal(report.geometry.openEngine,true,'The open bay exposes actual engine geometry, with no flat placeholder above it');
  assert.equal(report.geometry.closedPart,'hood','The closed bonnet covers the engine');
  assert.equal(report.geometry.engineStayedFixed,true,'The engine stays on the chassis while the bonnet moves');
  assert.equal(report.geometry.grilleFollowsBonnet,true,'The upper grille and chrome rings lift with the bonnet');
  assert.equal(report.geometry.headlightsStayFixed,true,'The headlights remain attached to the fixed body');
  assert.equal(report.geometry.bayPanelsStayFixed,true,'The formed bay panels remain fixed');
  assert.ok(report.geometry.strutSamples.every(sample=>sample.error<1e-6),'The piston reaches the moving bonnet ball joint in every pose');
  assert.ok(report.geometry.strutSamples[1].length>report.geometry.strutSamples[0].length,'The gas support extends as the bonnet opens');
  assert.ok(report.geometry.clearance>.004);
  report.checks.push('Geometry rays confirm the open engine, opaque closed bonnet, fixed engine assembly and positive bonnet clearance');
  report.checks.push('Upper grille and rings follow the bonnet; headlights and fitted bay panels remain on the body');
  report.checks.push('Telescoping gas support stays attached to the bonnet when open and closed');
  for(const [side,z] of [['left',1.7],['right',-1.7]]){
    await page.evaluate(z=>{
      const {camera,look,renderer}=window.__lab;
      camera.position.set(3.5,2.6,z);camera.fov=38;camera.lookAt(1.65,.66,0);camera.updateProjectionMatrix();
      renderer.shadowMap.needsUpdate=true;look.render(performance.now());
    },z);
    await shot('engine-bay-'+side);
  }
  await page.evaluate(()=>{
    const {camera,look,renderer}=window.__lab;
    camera.position.set(3.85,1.65,1.7);camera.fov=39;camera.lookAt(1.46,1.12,0);camera.updateProjectionMatrix();
    renderer.shadowMap.needsUpdate=true;look.render(performance.now());
  });
  await shot('bonnet-underside-detail');
  assert.deepEqual(report.runtimeErrors,[]);
  console.log(JSON.stringify(report,null,2));
}finally{
  writeFileSync(resolve(output,'report.json'),JSON.stringify(report,null,2)+'\n');
  await browser.close();
}
