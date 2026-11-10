// Real workshop reflections without a per-frame cost. The garage is rendered
// once into a cube map from the car's position (again only when the light level
// settles on a new value). Paint, glass and chrome then mirror the actual neon
// tubes, ceiling strips and walls; the floor uses the same capture with a box
// projection so reflections stay attached to the room while the camera moves.
import * as THREE from 'three';

export const REFLECTION_ORIGIN = Object.freeze([0, 1.05, 0]);

/** Inner wall, floor and ceiling planes of the room around the car. */
export function measureRoom(garage, origin = REFLECTION_ORIGIN) {
  const raycaster = new THREE.Raycaster(), start = new THREE.Vector3(), direction = new THREE.Vector3();
  const meshes = [];
  garage.traverse(object => { if (object.isMesh && object.visible) meshes.push(object); });
  // Props stand in front of the walls, so the farthest hit of a fan of rays is the wall.
  const reach = (axis, sign, fallback) => {
    let far = 0;
    for (const height of [2.6, 4.2, 5.6]) for (const offset of [-6, -3, 0, 3, 6]) {
      start.set(origin[0], height, origin[2]);
      if (axis === 'x') start.z += offset; else start.x += offset;
      direction.set(axis === 'x' ? sign : 0, 0, axis === 'z' ? sign : 0);
      raycaster.set(start, direction); raycaster.far = 40;
      const hits = raycaster.intersectObjects(meshes, false);
      if (hits.length) far = Math.max(far, hits[hits.length - 1].distance);
    }
    return far > 3 ? far : fallback;
  };
  let ceiling = 7;
  raycaster.set(start.set(origin[0] + 1.7, 1, origin[2] + 2.3), direction.set(0, 1, 0)); raycaster.far = 30;
  const up = raycaster.intersectObjects(meshes, false);
  if (up.length) ceiling = 1 + up[up.length - 1].distance;
  return new THREE.Box3(
    new THREE.Vector3(origin[0] - reach('x', -1, 14), 0, origin[2] - reach('z', -1, 14)),
    new THREE.Vector3(origin[0] + reach('x', 1, 14), ceiling, origin[2] + reach('z', 1, 14)),
  );
}

/**
 * Render the room once and prefilter it. `hidden` objects (the car and its
 * contact shadow) are left out; `emitters` are briefly driven harder so tubes
 * keep a bright core in glossy paint instead of clipping to wall brightness.
 */
export function captureGarageReflections({ renderer, scene, origin = REFLECTION_ORIGIN, size = 512, hidden = [], emitters = [], emitterBoost = 2.4 }) {
  const target = new THREE.WebGLCubeRenderTarget(size, { type: THREE.HalfFloatType, generateMipmaps: false });
  const camera = new THREE.CubeCamera(.3, 80, target);
  camera.position.fromArray(origin);
  const visibility = hidden.map(object => object.visible), intensity = emitters.map(material => material.emissiveIntensity);
  const shadowUpdate = renderer.shadowMap.needsUpdate, previousTarget = renderer.getRenderTarget();
  hidden.forEach(object => { object.visible = false; });
  emitters.forEach(material => { material.emissiveIntensity *= emitterBoost; });
  const pmrem = new THREE.PMREMGenerator(renderer);
  try {
    camera.update(renderer, scene);
    return pmrem.fromCubemap(target.texture);
  } finally {
    hidden.forEach((object, index) => { object.visible = visibility[index]; });
    emitters.forEach((material, index) => { material.emissiveIntensity = intensity[index]; });
    renderer.setRenderTarget(previousTarget);
    // The capture ran without the car; its shadow must be drawn again.
    renderer.shadowMap.needsUpdate = shadowUpdate || renderer.shadowMap.enabled;
    target.dispose(); pmrem.dispose();
  }
}

/** Parallax-correct a material's environment lookups to the measured room. */
export function addBoxProjection(material, room, origin = REFLECTION_ORIGIN) {
  const previousCompile = material.onBeforeCompile, previousKey = material.customProgramCacheKey();
  const uniforms = { roomMin: { value: room.min.clone() }, roomMax: { value: room.max.clone() }, roomProbe: { value: new THREE.Vector3(...origin) } };
  material.onBeforeCompile = (shader, renderer) => {
    previousCompile.call(material, shader, renderer);
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vRoomWorld;')
      .replace('#include <project_vertex>', '#include <project_vertex>\nvRoomWorld=(modelMatrix*vec4(transformed,1.0)).xyz;');
    const lookup = THREE.ShaderChunk.envmap_physical_pars_fragment.replace(
      'reflectVec = transformDirectionByInverseViewMatrix( reflectVec, viewMatrix );',
      `reflectVec = transformDirectionByInverseViewMatrix( reflectVec, viewMatrix );
			{
				vec3 roomFar=mix(roomMin,roomMax,step(vec3(0.0),reflectVec));
				vec3 roomT=(roomFar-vRoomWorld)/(abs(reflectVec)*sign(reflectVec+vec3(1e-6))+vec3(1e-6));
				float roomHit=max(0.0,min(min(roomT.x,roomT.y),roomT.z));
				reflectVec=normalize(vRoomWorld+reflectVec*roomHit-roomProbe);
			}`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vRoomWorld;\nuniform vec3 roomMin;\nuniform vec3 roomMax;\nuniform vec3 roomProbe;')
      .replace('#include <envmap_physical_pars_fragment>', lookup);
  };
  material.customProgramCacheKey = () => `${previousKey}-room-projection-v1`;
  material.needsUpdate = true;
  return uniforms;
}
