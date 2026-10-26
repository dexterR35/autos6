import * as THREE from 'three';

// Linear RGB, shared by the tubes, Audi sign, light spill and reflections.
export const NEON_BLUE = [0.006, 0.11, 1];
export const NEON_RED = [1, 0.012, 0.035];

// The GLB merges fixtures by material. Preserve each tube's direction rather than
// reflecting its bounding box as a square patch on the floor.
function sourceShape(source) {
  const extent = source.halfSize;
  const axis = extent.y >= extent.x && extent.y >= extent.z ? 1 : extent.x >= extent.z ? 0 : 2;
  const direction = new THREE.Vector3().setComponent(axis, 1);
  const radius = Math.max(0.012, Math.min(extent.x, extent.y, extent.z));
  return new THREE.Vector4(...direction.toArray(), Math.max(0, extent.getComponent(axis) - radius));
}

/** Give the round glass a bright centre and coloured edges in the existing pass. */
export function addNeonTubeProfile(material) {
  const previousCompile = material.onBeforeCompile;
  const previousKey = material.customProgramCacheKey();
  material.onBeforeCompile = (shader, renderer) => {
    previousCompile.call(material, shader, renderer);
    shader.fragmentShader = shader.fragmentShader.replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
      float neonCore=pow(max(0.0,dot(normal,normalize(vViewPosition))),6.0);
      float neonPeak=max(max(totalEmissiveRadiance.r,totalEmissiveRadiance.g),totalEmissiveRadiance.b);
      totalEmissiveRadiance=mix(totalEmissiveRadiance*0.72,mix(totalEmissiveRadiance,vec3(neonPeak),0.16),neonCore);`);
  };
  material.customProgramCacheKey = () => `${previousKey}-neon-glass-v1`;
  material.needsUpdate = true;
}

/** Keep both colours and spread the selected emitters around the entire room. */
export function selectNeonSources(sources, limit) {
  const selected = [];
  const remaining = [...sources];
  for (const kind of ['blue', 'red']) {
    const source = remaining.filter((s) => s.kind === kind).sort((a, b) => Number(b.sign) - Number(a.sign) || a.center.lengthSq() - b.center.lengthSq())[0];
    if (source && selected.length < limit) { selected.push(source); remaining.splice(remaining.indexOf(source), 1); }
  }
  while (selected.length < limit && remaining.length) {
    remaining.sort((a, b) => {
      const distance = (s) => Math.min(...selected.map((p) => p.center.distanceToSquared(s.center)));
      return distance(b) - distance(a);
    });
    selected.push(remaining.shift());
  }
  return selected;
}

/** Analytic nearby spill + rough planar highlights. No extra scene render or mirror. */
export function addNeonSurfaceResponse(material, sources, level, { floor = false } = {}) {
  if (!sources.length) return;
  const previousCompile = material.onBeforeCompile;
  const previousKey = material.customProgramCacheKey();
  material.onBeforeCompile = (shader, renderer) => {
    previousCompile.call(material, shader, renderer);
    shader.uniforms.neonLevel = level;
    shader.uniforms.neonSources = { value: sources.map((s) => new THREE.Vector4(...s.center.toArray(), s.reach)) };
    shader.uniforms.neonExtents = { value: sources.map((s) => s.halfSize) };
    shader.uniforms.neonColors = { value: sources.map((s) => new THREE.Color(...s.color)) };
    shader.uniforms.neonAxes = { value: sources.map(sourceShape) };
    shader.uniforms.neonSigns = { value: sources.map((s) => s.sign ? 1 : 0) };
    shader.vertexShader = shader.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vNeonWorld;\nvarying vec3 vNeonNormal;').replace('#include <project_vertex>', '#include <project_vertex>\nvNeonWorld=(modelMatrix*vec4(transformed,1.0)).xyz;\nvNeonNormal=normalize(mat3(modelMatrix)*objectNormal);');
    shader.fragmentShader = shader.fragmentShader.replace('#include <common>', `#include <common>
      varying vec3 vNeonWorld;
      varying vec3 vNeonNormal;
      uniform float neonLevel;
      uniform vec4 neonSources[${sources.length}];
      uniform vec3 neonExtents[${sources.length}];
      uniform vec3 neonColors[${sources.length}];
      uniform vec4 neonAxes[${sources.length}];
      uniform float neonSigns[${sources.length}];
      // Distance to the four interlocking rings in their wall plane. Keeping the
      // holes produces a recognizable Audi reflection instead of a solid block.
      float neonRingDistance(vec2 p, vec2 extent) {
        float radius=max(0.05,extent.y-0.025);
        float spacing=max(0.01,(extent.x-radius)*2.0/3.0);
        float ring=1000.0;
        for(int r=0;r<4;r++) {
          vec2 ringPoint=p-vec2((float(r)-1.5)*spacing,0.0);
          ring=min(ring,abs(length(ringPoint)-radius));
        }
        return max(0.0,ring-0.025);
      }`);
    shader.fragmentShader = shader.fragmentShader.replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
      vec3 neonSurface=vec3(0.0);
      vec3 neonNormal=normalize(vNeonNormal);
      ${floor ? 'vec3 neonReflection=reflect(normalize(vNeonWorld-cameraPosition),vec3(0.0,1.0,0.0));' : ''}
      for(int n=0;n<${sources.length};n++) {
        vec3 delta=vNeonWorld-neonSources[n].xyz;
        vec3 nearest=delta-clamp(delta,-neonExtents[n],neonExtents[n]);
        float d=length(nearest);
        if(neonSigns[n]>0.5) {
          float ring=neonRingDistance(delta.xy,neonExtents[n].xy);
          d=length(vec2(ring,delta.z));
        }
        float reach=neonSources[n].w;
        float falloff=pow(max(0.0,1.0-d/reach),2.0)/(1.0+0.18*d*d);
        float facing=max(0.0,dot(neonNormal,-normalize(nearest+vec3(0.00001))));
        // A small bright wash next to the glass and a softer spill farther away.
        float halo=exp(-d*d/0.13)*0.85+exp(-d*d/1.6)*0.18;
        neonSurface+=neonColors[n]*(falloff*${floor ? '0.3' : '0.9'}+halo)*facing;
        ${floor ? `
        if(neonReflection.y>0.001 && neonSources[n].y>vNeonWorld.y) {
          vec3 tubeAxis=neonAxes[n].xyz;
          float parallel=dot(neonReflection,tubeAxis);
          vec3 rayDelta=vNeonWorld-neonSources[n].xyz;
          float alongRay=dot(neonReflection,rayDelta);
          float alongTube=dot(tubeAxis,rayDelta);
          float segment=clamp((alongTube-parallel*alongRay)/max(0.0001,1.0-parallel*parallel),-neonAxes[n].w,neonAxes[n].w);
          vec3 tubePoint=neonSources[n].xyz+tubeAxis*segment;
          float t=max(0.0,dot(tubePoint-vNeonWorld,neonReflection));
          float reflectedDistance=length(vNeonWorld+neonReflection*t-tubePoint);
          if(neonSigns[n]>0.5 && abs(neonReflection.z)>0.001) {
            t=(neonSources[n].z-vNeonWorld.z)/neonReflection.z;
            vec3 hit=vNeonWorld+neonReflection*t-neonSources[n].xyz;
            reflectedDistance=neonRingDistance(hit.xy,neonExtents[n].xy);
          }
          float blur=0.055+0.012*t;
          float highlight=exp(-reflectedDistance*reflectedDistance/(blur*blur));
          float softReflection=exp(-reflectedDistance*reflectedDistance/(blur*blur*9.0))*0.2;
          float locality=pow(max(0.0,1.0-length(delta.xz)/(reach*1.7)),2.0);
          float ripple=0.88+0.12*sin(vNeonWorld.x*21.0+sin(vNeonWorld.z*9.0));
          neonSurface+=neonColors[n]*(highlight+softReflection)*locality*ripple*step(0.0,t)*1.55/(1.0+0.012*t*t);
        }` : ''}
      }
      totalEmissiveRadiance+=neonSurface*neonLevel;`);
  };
  material.customProgramCacheKey = () => `${previousKey}-neon-${floor ? 'floor' : 'wall'}-${sources.length}-v2`;
  material.needsUpdate = true;
}
