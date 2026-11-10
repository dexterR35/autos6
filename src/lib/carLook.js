// Showroom finishes for the Audi, applied to the materials of the released GLB.
// Values in the file stay plain glTF PBR; everything here is the extra that
// glTF cannot describe: pearl colour travel, metallic flake under the clearcoat
// and glass that keeps its reflections while staying see-through.
import * as THREE from 'three';

const PAINT = /deep blue pearl paint/i, GLASS = /(windscreen|privacy) glass/i, CHROME = /polished chrome/i;
const GLOSS_BLACK = /gloss black roof box/i, LENS = /lamp lenses/i, RUBBER = /tyre rubber/i, TRIM = /detailed trim/i;
const REAR_GLASS = /tailgate privacy glass/i;

function chain(material, key, patch) {
  const previousCompile = material.onBeforeCompile, previousKey = material.customProgramCacheKey();
  material.onBeforeCompile = (shader, renderer) => { previousCompile.call(material, shader, renderer); patch(shader); };
  material.customProgramCacheKey = () => `${previousKey}-${key}`;
  material.needsUpdate = true;
}

/** Deep base coat, sharp clearcoat, fine flake visible only up close. */
export function finishPaint(material) {
  // Colour, metalness and roughness come from the released GLB.
  material.clearcoat = 1; material.clearcoatRoughness = Math.min(material.clearcoatRoughness, .03);
  material.userData.carFinish = 'paint';
  chain(material, 'pearl-paint-v1', shader => {
    shader.vertexShader = shader.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vPaintLocal;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvPaintLocal=position;');
    shader.fragmentShader = shader.fragmentShader.replace('#include <common>', `#include <common>
      varying vec3 vPaintLocal;
      vec3 paintFlake(vec3 p){p=fract(p*vec3(.1031,.1030,.0973));p+=dot(p,p.yxz+33.33);return fract((p.xxy+p.yxx)*p.zyx)-.5;}`)
      // Pearl: the hue lifts towards violet-blue where the panel turns away.
      .replace('#include <color_fragment>', `#include <color_fragment>
      float paintFacing=clamp(dot(normalize(vNormal),normalize(vViewPosition)),0.0,1.0);
      diffuseColor.rgb=mix(diffuseColor.rgb,vec3(.030,.058,.20),pow(1.0-paintFacing,2.4)*.55);`)
      // Flake tilts only the base coat; the clearcoat keeps the true panel normal.
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
      vec3 flakeCell=vPaintLocal*2400.0;
      float flakeFade=1.0-smoothstep(.25,.8,max(fwidth(flakeCell.x),max(fwidth(flakeCell.y),fwidth(flakeCell.z))));
      normal=normalize(normal+paintFlake(floor(flakeCell))*.07*flakeFade);`);
  });
}

/** Tinted glazing: reflections stay opaque, the pane itself stays transparent. */
export function finishGlass(material) {
  const privacy = /privacy/i.test(material.name);
  material.color.setRGB(privacy ? .012 : .020, privacy ? .016 : .030, privacy ? .018 : .028);
  material.opacity = privacy ? .80 : .30;
  material.metalness = 0; material.roughness = .025; material.clearcoat = 0;
  material.ior = 1.52; material.specularIntensity = 1;
  material.transparent = true; material.depthWrite = false; material.side = THREE.DoubleSide;
  material.userData.carFinish = 'glass';
  chain(material, 'glass-reflection-v1', shader => {
    shader.fragmentShader = shader.fragmentShader.replace('#include <opaque_fragment>', `
      diffuseColor.a=clamp(diffuseColor.a+dot(totalSpecular,vec3(.2126,.7152,.0722))*1.6,0.0,1.0);
      #include <opaque_fragment>`);
  });
}

/** Upgrade every finish of the loaded car. Safe to call once per loaded model. */
export function finishCarMaterials(car) {
  const seen = new Set(), finished = { paint: [], glass: [], all: [] };
  car.traverse(object => {
    if (!object.isMesh) return;
    for (const material of [object.material].flat().filter(Boolean)) {
      if (seen.has(material) || !material.isMeshStandardMaterial) continue;
      seen.add(material); finished.all.push(material);
      const name = material.name;
      if (PAINT.test(name)) { finishPaint(material); finished.paint.push(material); }
      else if (GLASS.test(name)) { finishGlass(material); finished.glass.push(material); }
      else if (REAR_GLASS.test(name)) { material.roughness = .03; material.envMapIntensity = 1; }
      else if (CHROME.test(name)) { material.metalness = 1; material.roughness = .07; }
      else if (GLOSS_BLACK.test(name)) { material.roughness = .22; material.clearcoat = 1; material.clearcoatRoughness = .03; }
      else if (LENS.test(name)) { material.roughness = .12; material.clearcoat = 1; material.clearcoatRoughness = .03; }
      else if (RUBBER.test(name)) { material.roughness = .9; material.metalness = 0; }
      else if (TRIM.test(name)) { material.userData.carFinish = 'trim'; }
    }
    // Draw glass after the cabin so panes blend over seats, not the other way round.
    if ([object.material].flat().some(material => material?.userData.carFinish === 'glass')) object.renderOrder = 2;
  });
  return finished;
}
