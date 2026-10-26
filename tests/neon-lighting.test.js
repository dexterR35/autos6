import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { NEON_BLUE, NEON_RED, selectNeonSources, addNeonSurfaceResponse, addNeonTubeProfile } from '../src/lib/neonLighting.js';

const source=(kind,x,sign=false)=>({kind,sign,center:new THREE.Vector3(x,3,-12),halfSize:new THREE.Vector3(.04,1,.04),reach:8,color:kind==='blue'?NEON_BLUE:NEON_RED});
describe('localized neon lighting',()=>{
  it('reserves both colours and the Audi sign before spreading lights around the room',()=>{
    const sign=source('blue',4,true),red=source('red',2);
    const selected=selectNeonSources([source('blue',0),sign,red,source('red',-13),source('blue',13)],4);
    expect(selected[0]).toBe(sign);expect(selected[1]).toBe(red);
    expect(selected.some(s=>s.center.x===-13)).toBe(true);
    expect(selected).toHaveLength(4);
  });
  it('adds bounded surface falloff and camera-dependent floor highlights without replacing existing shaders',()=>{
    const material=new THREE.MeshStandardMaterial();
    material.onBeforeCompile=shader=>{shader.fragmentShader+='\n// existing masonry';};
    material.customProgramCacheKey=()=> 'existing-floor';
    const level={value:1};
    addNeonSurfaceResponse(material,[source('blue',0),source('red',4)],level,{floor:true});
    const shader={uniforms:{},vertexShader:'#include <common>\n#include <project_vertex>',fragmentShader:'#include <common>\n#include <emissivemap_fragment>'};
    material.onBeforeCompile(shader);
    expect(shader.uniforms.neonLevel).toBe(level);
    expect(shader.uniforms.neonSources.value).toHaveLength(2);
    expect(shader.uniforms.neonAxes.value[0].toArray()).toEqual([0,1,0,.96]);
    expect(shader.uniforms.neonSigns.value).toEqual([0,0]);
    expect(shader.fragmentShader).toContain('max(0.0,1.0-d/reach)');
    expect(shader.fragmentShader).toContain('cameraPosition');
    expect(shader.fragmentShader).toContain('// existing masonry');
    expect(material.customProgramCacheKey()).toContain('existing-floor');
    material.dispose();
  });
  it('reflects the Audi ring openings and tube length rather than solid fixture boxes',()=>{
    const sign=source('blue',4,true);
    sign.halfSize.set(1.3,.4,.035);
    const material=new THREE.MeshStandardMaterial();
    addNeonSurfaceResponse(material,[sign],{value:1},{floor:true});
    const shader={uniforms:{},vertexShader:'#include <common>\n#include <project_vertex>',fragmentShader:'#include <common>\n#include <emissivemap_fragment>'};
    material.onBeforeCompile(shader);
    expect(shader.uniforms.neonSigns.value).toEqual([1]);
    expect(shader.fragmentShader).toContain('neonRingDistance(hit.xy');
    expect(shader.fragmentShader).toContain('tubeAxis*segment');
    expect(shader.fragmentShader).not.toContain('vec2 outside=');
    material.dispose();
  });
  it('adds a glass core without replacing existing emissive shader work',()=>{
    const material=new THREE.MeshStandardMaterial();
    material.onBeforeCompile=shader=>{shader.fragmentShader+='\n// previous emissive';};
    material.customProgramCacheKey=()=> 'existing-glass';
    addNeonTubeProfile(material);
    const shader={fragmentShader:'#include <emissivemap_fragment>'};
    material.onBeforeCompile(shader);
    expect(shader.fragmentShader).toContain('float neonCore=');
    expect(shader.fragmentShader).toContain('// previous emissive');
    expect(material.customProgramCacheKey()).toContain('existing-glass');
    material.dispose();
  });
});
