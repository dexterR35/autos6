import * as THREE from 'three';

// Linear RGB, shared by the tubes, Audi sign, light spill and reflections.
export const NEON_BLUE = [0.006, 0.11, 1];
export const NEON_RED = [1, 0.012, 0.035];

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
    shader.vertexShader = shader.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vNeonWorld;\nvarying vec3 vNeonNormal;').replace('#include <project_vertex>', '#include <project_vertex>\nvNeonWorld=(modelMatrix*vec4(transformed,1.0)).xyz;\nvNeonNormal=normalize(mat3(modelMatrix)*objectNormal);');
    shader.fragmentShader = shader.fragmentShader.replace('#include <common>', `#include <common>
      varying vec3 vNeonWorld;
      varying vec3 vNeonNormal;
      uniform float neonLevel;
      uniform vec4 neonSources[${sources.length}];
      uniform vec3 neonExtents[${sources.length}];
      uniform vec3 neonColors[${sources.length}];`);
    shader.fragmentShader = shader.fragmentShader.replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
      vec3 neonSurface=vec3(0.0);
      vec3 neonNormal=normalize(vNeonNormal);
      ${floor ? 'vec3 neonReflection=reflect(normalize(vNeonWorld-cameraPosition),vec3(0.0,1.0,0.0));' : ''}
      for(int n=0;n<${sources.length};n++) {
        vec3 delta=vNeonWorld-neonSources[n].xyz;
        vec3 nearest=delta-clamp(delta,-neonExtents[n],neonExtents[n]);
        float d=length(nearest);
        float reach=neonSources[n].w;
        float falloff=pow(max(0.0,1.0-d/reach),2.0)/(1.0+0.18*d*d);
        float facing=max(0.0,dot(neonNormal,-nearest/max(d,0.001)));
        neonSurface+=neonColors[n]*falloff*facing*${floor ? '0.38' : '1.6'};
        ${floor ? `
        if(neonReflection.y>0.001 && neonSources[n].y>vNeonWorld.y) {
          float t=(neonSources[n].y-vNeonWorld.y)/neonReflection.y;
          vec2 hit=vNeonWorld.xz+neonReflection.xz*t;
          vec2 extent=max(neonExtents[n].xz,vec2(0.025));
          vec2 outside=max(abs(hit-neonSources[n].xz)-extent,vec2(0.0));
          float blur=0.10+0.045*t;
          float highlight=exp(-dot(outside,outside)/(blur*blur));
          float locality=pow(max(0.0,1.0-length(delta.xz)/(reach*1.7)),2.0);
          float ripple=0.78+0.22*sin(vNeonWorld.x*21.0+sin(vNeonWorld.z*9.0));
          neonSurface+=neonColors[n]*highlight*locality*ripple*1.45/(1.0+0.025*t*t);
        }` : ''}
      }
      totalEmissiveRadiance+=neonSurface*neonLevel;`);
  };
  material.customProgramCacheKey = () => `${previousKey}-neon-${floor ? 'floor' : 'wall'}-${sources.length}-v1`;
  material.needsUpdate = true;
}
