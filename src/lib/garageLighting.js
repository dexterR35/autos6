// A single scene pass with bounded lights and precomputed workshop reflections.
// No full-scene cubemap capture, fog, full-screen bloom or live floor mirror.
import * as THREE from 'three';
import { HDRLoader } from 'three/addons/loaders/HDRLoader.js';
import { meshComponents } from './meshComponents.js';
import { lightingUrl } from './modelAssets.js';
import { NEON_BLUE, NEON_RED, selectNeonSources, addNeonSurfaceResponse } from './neonLighting.js';

function contactShadow() {
  const canvas=document.createElement('canvas');canvas.width=128;canvas.height=64;
  const context=canvas.getContext('2d');
  const gradient=context.createRadialGradient(64,32,2,64,32,64);
  gradient.addColorStop(0,'rgba(0,0,0,.8)');gradient.addColorStop(1,'rgba(0,0,0,0)');
  context.setTransform(1,0,0,.5,0,16);context.fillStyle=gradient;context.fillRect(0,-32,128,128);
  const texture=new THREE.CanvasTexture(canvas);texture.colorSpace=THREE.SRGBColorSpace;
  const mesh=new THREE.Mesh(new THREE.PlaneGeometry(6.4,3.2),new THREE.MeshBasicMaterial({map:texture,transparent:true,depthWrite:false,toneMapped:false}));
  mesh.rotation.x=-Math.PI/2;mesh.position.y=.006;mesh.renderOrder=1;mesh.name='Car contact shadow';
  return mesh;
}

function floorMaterial() {
  const material=new THREE.MeshStandardMaterial({color:'#1d2229',roughness:.27,metalness:.22,envMapIntensity:.8});
  material.name='Garage floor | lightweight';
  material.onBeforeCompile=(shader)=>{
    shader.vertexShader=shader.vertexShader.replace('#include <common>','#include <common>\nvarying vec3 vFloorWorld;').replace('#include <project_vertex>','#include <project_vertex>\nvFloorWorld=(modelMatrix*vec4(transformed,1.0)).xyz;');
    shader.fragmentShader=shader.fragmentShader.replace('#include <common>','#include <common>\nvarying vec3 vFloorWorld;').replace('#include <color_fragment>',`#include <color_fragment>
      vec2 slabUv=vFloorWorld.xz*1.45;
      slabUv.x+=mod(floor(slabUv.y),2.0)*0.5;
      vec2 edge=min(fract(slabUv),1.0-fract(slabUv));
      float seam=1.0-smoothstep(0.005,0.005+max(fwidth(slabUv.x),fwidth(slabUv.y)),min(edge.x,edge.y));
      float grain=fract(sin(dot(floor(slabUv),vec2(127.1,311.7)))*43758.5453);
      diffuseColor.rgb*=mix(0.82,1.13,grain)*(1.0-seam*0.48);`)
      .replace('#include <lights_fragment_end>','#include <lights_fragment_end>\nreflectedLight.directSpecular*=0.65;');
  };
  material.customProgramCacheKey=()=> 'garage-floor-lightweight-v1';
  return material;
}

const PRACTICALS=[
  {kind:'blue',test:/cobalt blue neon|truss LED strip.*blue/i,color:NEON_BLUE,strength:7},
  {kind:'red',test:/crimson neon/i,color:NEON_RED,strength:7.5},
  {test:/warm fluorescent/i,color:[.92,.96,1],strength:3.5},
  {test:/tungsten worklamp/i,color:[1,.5,.2],strength:3.2},
];

function masonry(material) {
  material.color.setRGB(.062,.061,.058);material.roughness=.9;material.metalness=0;
  material.onBeforeCompile=shader=>{
    shader.vertexShader=shader.vertexShader.replace('#include <common>','#include <common>\nvarying vec3 vBrickWorld;\nvarying vec3 vBrickNormal;').replace('#include <project_vertex>','#include <project_vertex>\nvBrickWorld=(modelMatrix*vec4(transformed,1.0)).xyz;\nvBrickNormal=normalize(mat3(modelMatrix)*objectNormal);');
    shader.fragmentShader=shader.fragmentShader.replace('#include <common>','#include <common>\nvarying vec3 vBrickWorld;\nvarying vec3 vBrickNormal;').replace('#include <color_fragment>',`#include <color_fragment>
      vec2 brickUv=abs(vBrickNormal.x)>0.5?vBrickWorld.zy:vBrickWorld.xy;
      vec2 cell=brickUv/vec2(.85,.42);cell.x+=mod(floor(cell.y),2.0)*.5;
      vec2 brickEdge=min(fract(cell),1.0-fract(cell))*vec2(.85,.42);
      float joint=1.0-smoothstep(.007,.018,min(brickEdge.x,brickEdge.y));
      float blockTone=fract(sin(dot(floor(cell),vec2(127.1,311.7)))*43758.5453);
      diffuseColor.rgb*=mix(.72,1.12,blockTone)*(1.0-joint*.72);`);
  };
  material.customProgramCacheKey=()=> 'garage-masonry-lightweight-v1';
}

export function createGarageLook({renderer,scene,camera,compact=false}) {
  renderer.toneMapping=THREE.NeutralToneMapping;renderer.toneMappingExposure=1;
  renderer.shadowMap.enabled=!compact;renderer.shadowMap.type=THREE.PCFShadowMap;
  renderer.shadowMap.autoUpdate=false;renderer.shadowMap.needsUpdate=true;renderer.info.autoReset=false;
  scene.background=new THREE.Color('#080c13');scene.fog=null;
  const base=new THREE.Group();base.name='Garage look | bounded lighting';
  const hemisphere=new THREE.HemisphereLight('#d8e5ff','#101522',.8);base.add(hemisphere);
  const dimmable=[];
  const addLight=(light)=>{dimmable.push({light,intensity:light.intensity});base.add(light);return light;};
  for(const x of compact?[0]:[-6,0,6]) {
    const light=addLight(new THREE.PointLight('#f2f6ff',compact?100:85,22,2));light.position.set(x,5.1,-1.5);
  }
  const key=addLight(new THREE.SpotLight('#e6eeff',145,20,.85,.8,1.6));
  key.position.set(.4,6.7,1.6);key.target.position.set(0,0,0);key.castShadow=!compact;
  key.shadow.mapSize.set(1024,1024);key.shadow.bias=-.00015;key.shadow.normalBias=.03;base.add(key.target);
  const fill=addLight(new THREE.PointLight('#7aa5ff',26,16,2));fill.position.set(-3.2,4.2,3.6);
  if(!compact){const rim=addLight(new THREE.PointLight('#b3a3ff',20,16,2));rim.position.set(2,4,-5);}
  scene.add(base);
  const practicalLights=new THREE.Group();practicalLights.name='Garage look | practical lights';scene.add(practicalLights);
  const ceilingMaterials=[],state={level:1,from:1,since:0,instant:true};
  const neonLevel={value:1};
  let probe=null,disposed=false;

  async function loadEnvironment(signal) {
    const response=await fetch(lightingUrl(),{signal});
    if(!response.ok)throw new Error('Workshop lighting could not load.');
    const data=new HDRLoader().parse(await response.arrayBuffer());
    if(signal?.aborted||disposed)throw new DOMException('Cancelled','AbortError');
    const texture=new THREE.DataTexture(data.data,data.width,data.height,THREE.RGBAFormat,data.type);
    Object.assign(texture,{colorSpace:data.colorSpace,minFilter:data.minFilter,magFilter:data.magFilter,generateMipmaps:false,flipY:true,mapping:THREE.EquirectangularReflectionMapping,needsUpdate:true});
    const pmrem=new THREE.PMREMGenerator(renderer);
    try{probe=pmrem.fromEquirectangular(texture);scene.environment=probe.texture;}
    finally{texture.dispose();pmrem.dispose();}
  }

  function attach({car,garage}) {
    garage.updateMatrixWorld(true);
    const sources=[],surfaces=new Map(),seenMaterials=new Set();
    garage.traverse(object=>{
      if(!object.isMesh)return;
      object.castShadow=false;object.receiveShadow=!compact;
      for(const material of [object.material].flat().filter(Boolean)) {
        if(object.userData.ceilingRow!==undefined){ceilingMaterials.push(material);continue;}
        if(object.userData.surface==='floor'||/wet concrete/i.test(material.name)){object.material=floorMaterial();surfaces.set(object.material,true);material.dispose();continue;}
        if(/aged concrete block/i.test(material.name) && !seenMaterials.has(material)){masonry(material);surfaces.set(material,false);}
        seenMaterials.add(material);
        if(/midnight blue enamel/i.test(material.name)){material.color.setRGB(.018,.058,.21);material.metalness=.35;material.roughness=.38;}
        const practical=PRACTICALS.find(p=>p.test.test(material.name));
        if(!practical)continue;
        material.color.setRGB(0,0,0);material.emissive.setRGB(...practical.color);material.emissiveIntensity=practical.strength;
        // Keep the neon cores saturated instead of tone-mapping blue into lavender/white.
        if(practical.kind){material.toneMapped=false;material.emissiveIntensity=1.5;}
        if(!practical.kind)continue;
        const sign=/Audi neon rings/i.test(object.name);
        const boxes=sign?[new THREE.Box3().setFromObject(object)]:meshComponents(object);
        for(const box of boxes) {
          const center=box.getCenter(new THREE.Vector3());
          const halfSize=box.getSize(new THREE.Vector3()).multiplyScalar(.5);
          // The extension overlays the original four rings; use one combined sign emitter.
          if(!sign&&halfSize.x>.22&&halfSize.x<.55&&Math.abs(halfSize.x-halfSize.y)<.08&&halfSize.z<.1)continue;
          sources.push({center,halfSize,color:practical.color,kind:practical.kind,sign,reach:sign?7:8.5});
        }
      }
    });
    const selected=selectNeonSources(sources,compact?12:20);
    surfaces.forEach((floor,material)=>addNeonSurfaceResponse(material,selected,neonLevel,{floor}));
    for(const source of selectNeonSources(sources,compact?4:8)) {
      const light=new THREE.PointLight(new THREE.Color(...source.color),source.sign?75:65,source.reach,2);
      light.position.copy(source.center);
      // Move a wall-mounted source into the room, away from the wall's back face.
      if(Math.abs(light.position.x)>12)light.position.x-=Math.sign(light.position.x)*.18;
      if(Math.abs(light.position.z)>12)light.position.z-=Math.sign(light.position.z)*.18;
      light.name=source.sign?'Practical | Audi blue':'Practical | neon '+source.kind;
      practicalLights.add(light);dimmable.push({light,intensity:light.intensity});
    }
    scene.add(contactShadow());
    car.traverse(object=>{
      if(!object.isMesh)return;
      object.castShadow=!compact;object.receiveShadow=!compact;
      for(const material of [object.material].flat().filter(Boolean))if(material.isMeshStandardMaterial)material.envMapIntensity=1.35;
    });
    applyLevel(state.level);renderer.shadowMap.needsUpdate=true;
  }
  function applyLevel(level) {
    neonLevel.value=level;
    hemisphere.intensity=THREE.MathUtils.lerp(.26,.8,level);
    dimmable.forEach(({light,intensity})=>{light.intensity=intensity*level;});
    ceilingMaterials.forEach(material=>{material.emissive.setRGB(.92,.96,1);material.emissiveIntensity=THREE.MathUtils.lerp(1.8,4,level);});
    scene.environmentIntensity=THREE.MathUtils.lerp(.3,.65,level);
  }
  function setLightLevel(value,instant=false) {
    state.from=state.level;state.level=THREE.MathUtils.clamp(value,.35,1);state.since=performance.now();state.instant=instant;
    if(instant)applyLevel(state.level);
  }
  function render(now=performance.now()) {
    const t=state.instant?1:Math.min(1,(now-state.since)/180);
    applyLevel(THREE.MathUtils.lerp(state.from,state.level,t*t*(3-2*t)));
    renderer.info.reset();renderer.render(scene,camera);return t<1;
  }
  function dispose(){disposed=true;probe?.dispose();base.traverse(object=>object.dispose?.());}
  return{attach,loadEnvironment,setSize(){},render,dispose,setLightLevel,get practicalLights(){return practicalLights;}};
}
