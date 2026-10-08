// Night-workshop look for the exported garage: practical neon lighting, a wet
// reflective floor, procedural masonry and HDR bloom. The GLB carries geometry
// and flat PBR values only, so everything the Blender shaders and Cycles lights
// supplied is rebuilt here for the browser.
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { meshComponents } from './meshComponents.js';

// With ~30 point and spot lights, most of them out of reach of any given pixel,
// skip the BRDF for lights whose attenuated colour is zero there. The result is
// identical (their contribution is exactly zero); only the wasted work goes.
const DIRECT_LIGHT = 'RE_Direct( directLight, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );';
if (!THREE.ShaderChunk.lights_fragment_begin.includes(`if ( directLight.visible ) ${DIRECT_LIGHT}`)) {
  THREE.ShaderChunk.lights_fragment_begin = THREE.ShaderChunk.lights_fragment_begin
    .replaceAll(DIRECT_LIGHT, `if ( directLight.visible ) ${DIRECT_LIGHT}`);
}

// Emissive tubes are HDR: well above 1.0 so only they reach the bloom threshold.
const PRACTICALS = [
  { kind: 'blue', test: /cobalt blue neon/i, color: [0.006, 0.11, 1], strength: 7, budget: 4, power: 0.9, reach: 4 },
  { kind: 'red', test: /crimson neon/i, color: [1, 0.02, 0.05], strength: 8, budget: 3, power: 0.8, reach: 3.5 },
  // The exported 'warm fluorescent' wall tubes are lit cool white, like the ceiling tubes.
  { kind: 'tube', test: /warm fluorescent/i, color: [0.92, 0.96, 1], strength: 5.5, budget: 3, power: 1.5, reach: 5 },
  { kind: 'bulb', test: /tungsten worklamp/i, color: [1, 0.5, 0.2], strength: 5.2, budget: 2, power: 0.8, reach: 3.5 },
];

// Ceiling work lights. Off is the dim neon mood of the references; on floods the
// room and the car with cool white fluorescent light, row by row with a tube flicker.
const CEILING = {
  off: { emissive: new THREE.Color(1, 0.84, 0.66), strength: 3, sky: new THREE.Color('#7b8fb8'), fill: 0.26, environment: 0.65, carEnvironment: 2.2 },
  on: { emissive: new THREE.Color(0.92, 0.96, 1), strength: 5.6, sky: new THREE.Color('#e4ebff'), fill: 0.85, environment: 0.5, carEnvironment: 1.35, light: 75 },
  // Starter flicker of a fluorescent tube, one step per 55 ms.
  flicker: [0.9, 0, 0, 0.7, 0.15, 0, 1, 0.45, 1],
  step: 55,
  fade: 240,
};

const NOISE_GLSL = /* glsl */ `
varying vec3 vLookWorld;
varying vec3 vLookNormal;
float lookHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
vec2 lookHash2(vec2 p) {
  return fract(sin(vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3)))) * 43758.5453);
}
float lookNoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(lookHash(i), lookHash(i + vec2(1.0, 0.0)), u.x),
             mix(lookHash(i + vec2(0.0, 1.0)), lookHash(i + vec2(1.0, 1.0)), u.x), u.y);
}
float lookFbm(vec2 p) {
  float value = 0.0;
  float amplitude = 0.5;
  for (int i = 0; i < 4; i++) {
    value += amplitude * lookNoise(p);
    p = p * 2.03 + 11.7;
    amplitude *= 0.5;
  }
  return value;
}
// Height-field bump without tangents (the same construction as three's bumpmap).
vec3 lookBump(vec3 surfaceNormal, float height, float strength) {
  vec3 dpdx = dFdx(-vViewPosition);
  vec3 dpdy = dFdy(-vViewPosition);
  vec3 r1 = cross(dpdy, surfaceNormal);
  vec3 r2 = cross(surfaceNormal, dpdx);
  float det = dot(dpdx, r1);
  vec3 gradient = sign(det) * (dFdx(height) * r1 + dFdy(height) * r2) * strength;
  return normalize(abs(det) * surfaceNormal - gradient);
}
`;

function addWorldVaryings(shader) {
  shader.vertexShader = shader.vertexShader
    .replace('#include <common>', '#include <common>\nvarying vec3 vLookWorld;\nvarying vec3 vLookNormal;')
    .replace('#include <project_vertex>', `#include <project_vertex>
      vLookWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;
      vLookNormal = normalize(mat3(modelMatrix) * objectNormal);`);
  shader.fragmentShader = shader.fragmentShader.replace('#include <common>', `#include <common>\n${NOISE_GLSL}`);
}

/** Concrete-block masonry, matching the Blender brick shader (0.85 × 0.42 m blocks). */
function masonry(material) {
  material.color.setRGB(0.062, 0.061, 0.058);
  material.roughness = 0.9;
  material.metalness = 0;
  material.customProgramCacheKey = () => 'garage-masonry';
  material.onBeforeCompile = (shader) => {
    addWorldVaryings(shader);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <color_fragment>', `#include <color_fragment>
        vec2 wallUv = abs(vLookNormal.x) > 0.5 ? vLookWorld.zy : vLookWorld.xy;
        vec2 brickSize = vec2(0.85, 0.42);
        float row = floor(wallUv.y / brickSize.y);
        vec2 cell = vec2(wallUv.x / brickSize.x + mod(row, 2.0) * 0.5, wallUv.y / brickSize.y);
        vec2 within = fract(cell) ;
        vec2 edge = min(within, 1.0 - within) * brickSize;
        float mortar = 1.0 - smoothstep(0.007, 0.02, min(edge.x, edge.y));
        float block = lookHash(floor(cell));
        float grime = lookFbm(wallUv * vec2(1.3, 0.9));
        float speck = lookNoise(wallUv * 38.0);
        // Darker staining near the floor and under shelves, like the reference.
        float soot = smoothstep(2.6, 0.0, vLookWorld.y) * 0.35;
        float tone = (0.55 + 0.65 * block) * (0.55 + 0.8 * grime) * (0.82 + 0.3 * speck) * (1.0 - soot);
        diffuseColor.rgb *= mix(tone, 0.28, mortar);
        float masonryHeight = (1.0 - mortar) * 0.8 + speck * 0.2;`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
        roughnessFactor = clamp(roughnessFactor - 0.2 * (1.0 - grime) * (1.0 - mortar), 0.45, 1.0);`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
        normal = lookBump(normal, masonryHeight, 0.014);`);
  };
  material.needsUpdate = true;
}

/**
 * Wet cracked concrete. A planar mirror of the scene is sampled with vertical
 * streaking, ripple distortion and a puddle mask, then added over the lit slab.
 */
function wetFloorMaterial(reflection) {
  const material = new THREE.MeshStandardMaterial({ color: new THREE.Color(0.014, 0.016, 0.02), roughness: 0.5, metalness: 0 });
  material.name = 'Garage | wet cracked concrete | web';
  material.envMapIntensity = 0.35;
  material.customProgramCacheKey = () => 'garage-wet-floor';
  material.onBeforeCompile = (shader) => {
    shader.uniforms.tReflection = { value: reflection.texture };
    shader.uniforms.uReflectionMatrix = { value: reflection.textureMatrix };
    shader.uniforms.uReflectionStrength = reflection.strength;
    // Floor helpers go after the shared noise, which addWorldVaryings inserts first.
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
        #include <garage_floor_helpers>`);
    addWorldVaryings(shader);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <garage_floor_helpers>', `
        uniform sampler2D tReflection;
        uniform mat4 uReflectionMatrix;
        uniform float uReflectionStrength;
        // Voronoi edge distance (Quilez): irregular slabs with hairline cracks.
        vec3 lookVoronoi(vec2 x) {
          vec2 n = floor(x);
          vec2 f = fract(x);
          vec2 mg = vec2(0.0);
          vec2 mr = vec2(0.0);
          float md = 8.0;
          for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) {
            vec2 g = vec2(float(i), float(j));
            vec2 r = g + lookHash2(n + g) - f;
            float d = dot(r, r);
            if (d < md) { md = d; mr = r; mg = g; }
          }
          md = 8.0;
          for (int j = -2; j <= 2; j++) for (int i = -2; i <= 2; i++) {
            vec2 g = mg + vec2(float(i), float(j));
            vec2 r = g + lookHash2(n + g) - f;
            if (dot(mr - r, mr - r) > 0.00001) md = min(md, dot(0.5 * (mr + r), normalize(r - mr)));
          }
          return vec3(md, n + mg);
        }`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        vec2 floorUv = vLookWorld.xz;
        // Fine detail fades with distance instead of shimmering on far pixels.
        float footprint = length(fwidth(floorUv));
        float detail = 1.0 - smoothstep(0.015, 0.08, footprint);
        vec3 slab = lookVoronoi(floorUv * 2.4 + lookNoise(floorUv * 3.1) * 0.55);
        float crackWidth = 0.016 + 0.018 * lookNoise(floorUv * 9.0);
        float crack = (1.0 - smoothstep(crackWidth - footprint * 1.2, crackWidth + footprint * 1.2, slab.x))
          * (0.5 + 0.5 * lookNoise(floorUv * 1.7)) * mix(0.35, 1.0, detail);
        float slabTone = 0.8 + 0.4 * lookHash(slab.yz);
        float puddle = smoothstep(0.3, 0.56, lookFbm(floorUv * 0.32 + vec2(3.1, 7.4)));
        float grain = mix(0.5, lookNoise(floorUv * 23.0), detail);
        diffuseColor.rgb *= slabTone * (0.75 + 0.5 * grain) * (1.0 - 0.45 * crack) * mix(1.0, 0.5, puddle);`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
        roughnessFactor = mix(0.58, 0.16, puddle) + crack * 0.3;`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
        normal = lookBump(normal, (1.0 - crack) * 0.6 + grain * 0.4 * (1.0 - puddle), 0.004 * detail);`)
      // Fill lights are not real fixtures: keep their direct highlights soft on the
      // floor. Real fixtures appear through the planar reflection instead.
      .replace('#include <lights_fragment_end>', `#include <lights_fragment_end>
        reflectedLight.directSpecular *= 0.3;`)
      .replace('#include <opaque_fragment>', `
        {
          vec4 projected = uReflectionMatrix * vec4(vLookWorld, 1.0);
          vec2 reflectionUv = projected.xy / projected.w;
          float ripple = lookNoise(floorUv * vec2(1.4, 9.0)) - 0.5;
          reflectionUv += vec2(ripple * 0.0015, (lookNoise(floorUv * 11.0 + 17.0) - 0.5) * 0.004) * mix(1.0, 0.3, puddle);
          // Wet concrete stretches reflections toward the viewer into soft columns.
          // Per-pixel jittered taps on a mip-blurred mirror avoid stepped copies.
          float spread = mix(0.09, 0.028, puddle);
          float blur = mix(2.4, 0.6, puddle);
          float jitter = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715)))) - 0.5;
          vec3 mirrored = vec3(0.0);
          float total = 0.0;
          for (int i = -6; i <= 6; i++) {
            float t = (float(i) + jitter) / 6.0;
            float weight = exp(-t * t * 2.2);
            vec2 offset = vec2(t * t * t * 0.004, t * spread);
            mirrored += textureLod(tReflection, reflectionUv + offset, blur + abs(t) * 1.2).rgb * weight;
            total += weight;
          }
          mirrored /= total;
          float facing = saturate(dot(normal, normalize(vViewPosition)));
          float fresnel = 0.04 + 0.96 * pow(1.0 - facing, 5.0);
          float wetness = mix(0.4, 1.0, puddle) * (1.0 - crack * 0.5);
          outgoingLight += mirrored * uReflectionStrength * wetness * mix(0.4, 1.0, fresnel);
        }
        #include <opaque_fragment>`);
  };
  return material;
}

/** Planar mirror for the floor at y = 0, using the oblique clip plane from three's Reflector. */
class PlanarReflection {
  constructor(scale) {
    this.scale = scale;
    this.target = new THREE.WebGLRenderTarget(1, 1, {
      type: THREE.HalfFloatType, depthBuffer: true, generateMipmaps: true, minFilter: THREE.LinearMipmapLinearFilter,
    });
    this.texture = this.target.texture;
    this.textureMatrix = new THREE.Matrix4();
    this.strength = { value: 1 };
    this.camera = new THREE.PerspectiveCamera();
    this.plane = new THREE.Plane();
    this.clip = new THREE.Vector4();
    this.q = new THREE.Vector4();
    this.view = new THREE.Vector3();
    this.lookAt = new THREE.Vector3();
    this.cameraPosition = new THREE.Vector3();
    this.rotation = new THREE.Matrix4();
    this.normal = new THREE.Vector3(0, 1, 0);
    this.origin = new THREE.Vector3(0, 0, 0);
  }

  setSize(width, height) {
    this.target.setSize(Math.max(1, Math.round(width * this.scale)), Math.max(1, Math.round(height * this.scale)));
  }

  update(renderer, scene, camera, hidden) {
    const { normal, origin, view, lookAt, cameraPosition, rotation } = this;
    cameraPosition.setFromMatrixPosition(camera.matrixWorld);
    view.subVectors(origin, cameraPosition);
    if (view.dot(normal) > 0) return;
    view.reflect(normal).negate().add(origin);
    rotation.extractRotation(camera.matrixWorld);
    lookAt.set(0, 0, -1).applyMatrix4(rotation).add(cameraPosition);
    const target = new THREE.Vector3().subVectors(origin, lookAt).reflect(normal).negate().add(origin);
    const mirror = this.camera;
    mirror.position.copy(view);
    mirror.up.set(0, 1, 0).applyMatrix4(rotation).reflect(normal);
    mirror.lookAt(target);
    mirror.far = camera.far;
    mirror.near = camera.near;
    mirror.updateMatrixWorld();
    mirror.projectionMatrix.copy(camera.projectionMatrix);
    this.textureMatrix.set(0.5, 0, 0, 0.5, 0, 0.5, 0, 0.5, 0, 0, 0.5, 0.5, 0, 0, 0, 1)
      .multiply(mirror.projectionMatrix).multiply(mirror.matrixWorldInverse);
    this.plane.setFromNormalAndCoplanarPoint(normal, origin).applyMatrix4(mirror.matrixWorldInverse);
    const { clip, q } = this;
    clip.set(this.plane.normal.x, this.plane.normal.y, this.plane.normal.z, this.plane.constant);
    const projection = mirror.projectionMatrix.elements;
    q.x = (Math.sign(clip.x) + projection[8]) / projection[0];
    q.y = (Math.sign(clip.y) + projection[9]) / projection[5];
    q.z = -1;
    q.w = (1 + projection[10]) / projection[14];
    clip.multiplyScalar(2 / clip.dot(q));
    projection[2] = clip.x;
    projection[6] = clip.y;
    projection[10] = clip.z + 1 - 0.003;
    projection[14] = clip.w;

    hidden.forEach((object) => { object.visible = false; });
    const previousTarget = renderer.getRenderTarget();
    renderer.setRenderTarget(this.target);
    renderer.clear();
    renderer.render(scene, mirror);
    renderer.setRenderTarget(previousTarget);
    hidden.forEach((object) => { object.visible = true; });
  }

  dispose() { this.target.dispose(); }
}

/** Fixtures of one emissive mesh, merged until the light budget fits. */
function emissiveClusters(mesh, budget) {
  const clusters = meshComponents(mesh);
  // Touching pieces (the four interlocking rings) form one fixture.
  for (let merged = true; merged;) {
    merged = false;
    for (let i = 0; i < clusters.length && !merged; i++) {
      const grown = clusters[i].clone().expandByScalar(0.12);
      for (let j = i + 1; j < clusters.length; j++) {
        if (grown.intersectsBox(clusters[j])) { clusters[i].union(clusters[j]); clusters.splice(j, 1); merged = true; break; }
      }
    }
  }
  const centre = (box) => box.getCenter(new THREE.Vector3());
  while (clusters.length > budget) {
    let best = [0, 1, Infinity];
    for (let i = 0; i < clusters.length; i++) {
      for (let j = i + 1; j < clusters.length; j++) {
        const distance = centre(clusters[i]).distanceTo(centre(clusters[j]));
        if (distance < best[2]) best = [i, j, distance];
      }
    }
    // Neighbouring fixtures share one light; a light between distant fixtures
    // would hang in empty space, so drop the smallest fixture's light instead.
    if (best[2] > 2.2) break;
    clusters[best[0]].union(clusters[best[1]]);
    clusters.splice(best[1], 1);
  }
  const extent = (box) => box.getSize(new THREE.Vector3()).length();
  return clusters.sort((a, b) => extent(b) - extent(a)).slice(0, budget);
}

function contactShadow() {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 128;
  const context = canvas.getContext('2d');
  const gradient = context.createRadialGradient(128, 64, 4, 128, 64, 128);
  gradient.addColorStop(0, 'rgba(0,0,0,0.88)');
  gradient.addColorStop(0.55, 'rgba(0,0,0,0.5)');
  gradient.addColorStop(1, 'rgba(0,0,0,0)');
  context.setTransform(1, 0, 0, 0.5, 0, 32);
  context.fillStyle = gradient;
  context.fillRect(0, -64, 256, 256);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(6.4, 3.2),
    new THREE.MeshBasicMaterial({ map: texture, transparent: true, depthWrite: false, toneMapped: false }),
  );
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.y = 0.006;
  mesh.renderOrder = 1;
  mesh.name = 'Car contact shadow';
  return mesh;
}

/**
 * Owns lighting, environment and the post-processing chain for one renderer.
 * Call attach() once both GLBs are in the scene, then render() per frame.
 */
export function createGarageLook({ renderer, scene, camera, compact = false }) {
  const disposables = [];
  const track = (item) => { disposables.push(item); return item; };
  // Khronos PBR Neutral keeps saturated neon blue and red in hue; ACES pushes bright
  // blue toward lavender-white, which made the Audi rings read pale.
  renderer.toneMapping = THREE.NeutralToneMapping;
  renderer.toneMappingExposure = 1.0;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  // The scene is static: render shadows once per change instead of per pass.
  renderer.shadowMap.autoUpdate = false;
  renderer.shadowMap.needsUpdate = true;
  // Count every pass of a frame (mirror, scene, bloom), not only the last quad.
  renderer.info.autoReset = false;

  scene.background = new THREE.Color('#05070c');
  scene.fog = new THREE.FogExp2('#06080f', 0.012);

  const pmrem = track(new THREE.PMREMGenerator(renderer));

  const base = new THREE.Group();
  base.name = 'Garage look | base lights';
  // Cool blue-grey night fill: the masonry stays readable away from the neon.
  const hemisphere = new THREE.HemisphereLight(CEILING.off.sky, '#0b0e18', CEILING.off.fill);
  base.add(hemisphere);
  // Ceiling work lights, at zero until switched on. A zero-intensity light costs
  // almost nothing (its BRDF is skipped) and keeping the light count fixed avoids
  // recompiling every shader when the switch is used.
  const ceilingLights = [];
  for (const x of [-7, 0, 7]) {
    for (const z of [-8.5, -1.5, 6.5]) {
      const light = new THREE.PointLight('#f2f6ff', 0, 15, 2);
      light.position.set(x, 5.1, z);
      light.name = 'Ceiling work light';
      ceilingLights.push(light);
      base.add(light);
    }
  }
  const key = new THREE.SpotLight('#e6eeff', 130, 18, 0.72, 0.75, 1.6);
  key.position.set(0.4, 6.7, 1.6);
  key.target.position.set(0, 0, 0);
  key.castShadow = true;
  key.shadow.mapSize.set(compact ? 1024 : 2048, compact ? 1024 : 2048);
  key.shadow.bias = -0.00015;
  key.shadow.normalBias = 0.03;
  key.shadow.radius = 4;
  base.add(key, key.target);
  const fill = new THREE.PointLight('#5b8fff', 22, 14, 2);
  fill.position.set(-3.2, 4.2, 3.6);
  const rim = new THREE.PointLight('#8a6cff', 14, 14, 2);
  rim.position.set(2, 4, -5);
  base.add(fill, rim);
  // Workshop bounce from the room side (the Blender scene's "Warm workshop bounce", now white)
  // area lights): the neon sits behind the cabinet fronts, so this lights them.
  const washes = [
    [[-8.5, 3.6, -10.6], [-8.5, 1.3, -14.2], '#eef2ff', 52], [[-4, 3.6, -10.6], [-4, 1.3, -14.2], '#eef2ff', 46],
    [[3.25, 3.6, -10.6], [3.25, 1.3, -14.2], '#eef2ff', 46], [[9, 3.6, -10.6], [9, 1.3, -14.2], '#a9c4ff', 32],
  ];
  // The same wash along the side walls, which the 360° orbit also shows.
  for (const side of [-1, 1]) {
    washes.push([[side * 10.3, 3.8, 7.2], [side * 13.8, 1.3, 7.2], '#eef2ff', 26]);
    if (!compact) washes.push([[side * 10.3, 3.8, -9], [side * 13.8, 1.6, -9], '#c7d4ff', 20]);
  }
  // Narrow and low: cabinets and lower shelves bright, the upper wall left to the neon.
  for (const [position, target, color, power] of washes) {
    const wash = new THREE.SpotLight(color, power, 10, 0.72, 0.85, 2);
    wash.position.set(...position);
    wash.target.position.set(...target);
    base.add(wash, wash.target);
  }
  scene.add(base);

  const reflection = new PlanarReflection(compact ? 0.4 : 0.6);
  track(reflection);
  const composer = new EffectComposer(renderer, new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: compact ? 2 : 4 }));
  composer.addPass(new RenderPass(scene, camera));
  // Tight, intense glow around the tubes rather than a room-wide haze.
  const bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), compact ? 0.9 : 1.1, 0, 5);
  // Threshold the brightest channel, not luminance: saturated blue neon has a low
  // luminance and would otherwise never glow, while white paint highlights would.
  bloom.materialHighPassFilter.fragmentShader = bloom.materialHighPassFilter.fragmentShader
    .replace('float v = luminance( texel.xyz );', 'float v = max( max( texel.r, texel.g ), texel.b );');
  bloom.materialHighPassFilter.needsUpdate = true;
  // Weight the fine mips: a glow that hugs each tube, as in the references, instead
  // of the wide levels that veil the whole room in haze.
  bloom.compositeMaterial.uniforms.bloomFactors.value = [1.0, 0.7, 0.32, 0.1, 0.03];
  composer.addPass(bloom);
  composer.addPass(new OutputPass());
  track(composer);

  let floor = null;
  let shadow = null;
  let practicalLights = null;
  let carMaterials = [];
  const ceiling = { on: false, instant: true, since: 0, rows: [], probes: { off: null, on: null }, probe: null };

  /** Applies the ceiling state for per-row levels (0 off, 1 on); returns the mean level. */
  function applyCeiling(levels) {
    let total = 0;
    ceiling.rows.forEach((row, index) => {
      const level = levels[index];
      row.level = level;
      row.material.emissive.lerpColors(CEILING.off.emissive, CEILING.on.emissive, level);
      row.material.emissiveIntensity = THREE.MathUtils.lerp(CEILING.off.strength, CEILING.on.strength, level);
      total += level;
    });
    const mean = ceiling.rows.length ? total / ceiling.rows.length : Number(ceiling.on);
    ceilingLights.forEach((light) => { light.intensity = CEILING.on.light * mean; });
    hemisphere.color.lerpColors(CEILING.off.sky, CEILING.on.sky, mean);
    hemisphere.intensity = THREE.MathUtils.lerp(CEILING.off.fill, CEILING.on.fill, mean);
    // Reflections switch to the lit-room probe halfway through the transition.
    const probe = mean >= 0.5 && ceiling.probes.on ? ceiling.probes.on : ceiling.probes.off;
    if (probe && probe !== ceiling.probe) {
      ceiling.probe = probe;
      scene.environment = probe.texture;
      carMaterials.forEach((material) => { material.envMap = probe.texture; });
    }
    scene.environmentIntensity = THREE.MathUtils.lerp(CEILING.off.environment, CEILING.on.environment, mean);
    const carEnvironment = THREE.MathUtils.lerp(CEILING.off.carEnvironment, CEILING.on.carEnvironment, mean);
    carMaterials.forEach((material) => { material.envMapIntensity = carEnvironment; });
    return mean;
  }

  /** Advances the switch transition; returns true while it still needs frames. */
  function advanceCeiling(now) {
    if (!ceiling.rows.length) return false;
    const elapsed = now - ceiling.since;
    let animating = false;
    const levels = ceiling.rows.map((row) => {
      if (ceiling.instant) return Number(ceiling.on);
      if (!ceiling.on) {
        const level = Math.max(0, row.from * (1 - elapsed / CEILING.fade));
        if (level > 0) animating = true;
        return level;
      }
      const step = Math.floor((elapsed - row.delay) / CEILING.step);
      if (step >= CEILING.flicker.length) return 1;
      animating = true;
      return step < 0 ? row.from : CEILING.flicker[step];
    });
    applyCeiling(levels);
    if (!animating) ceiling.instant = false;
    return animating;
  }

  /** Ceiling work lights on or off; instant skips the flicker and fade. */
  function setCeilingLights(on, instant = false) {
    if (on === ceiling.on && !instant) return;
    ceiling.on = on;
    ceiling.instant = instant;
    ceiling.since = performance.now();
    ceiling.rows.forEach((row) => { row.from = row.level; });
  }

  function attach({ car, garage }) {
    garage.updateMatrixWorld(true);
    practicalLights = new THREE.Group();
    practicalLights.name = 'Garage look | practical lights';
    const roomCentre = new THREE.Vector3(0, 0, -5);
    garage.traverse((object) => {
      if (!object.isMesh) return;
      object.castShadow = false;
      object.receiveShadow = true;
      const material = object.material;
      if (object.userData.ceilingRow !== undefined) {
        // Rows switch on one after another, with a little irregularity.
        const row = object.userData.ceilingRow;
        ceiling.rows.push({ material, delay: row * 150 + ((row * 37) % 5) * 22, level: 0, from: 0 });
        return;
      }
      if (object.userData.surface === 'floor' || /wet concrete/i.test(material.name)) {
        floor = object;
        object.material = wetFloorMaterial(reflection);
        material.dispose();
        return;
      }
      if (/aged concrete block/i.test(material.name)) { masonry(material); return; }
      // Lift columns read as blue painted steel in the references.
      if (/midnight blue enamel/i.test(material.name)) { material.color.setRGB(0.018, 0.058, 0.21); material.metalness = 0.35; material.roughness = 0.38; }
      if (/deep red powdercoat/i.test(material.name)) {
        const paint = new THREE.MeshPhysicalMaterial({ name: material.name, color: new THREE.Color(0.5, 0.012, 0.02), roughness: 0.34, metalness: 0.05, clearcoat: 1, clearcoatRoughness: 0.12 });
        object.material = paint;
        material.dispose();
        return;
      }
      const practical = PRACTICALS.find((entry) => entry.test.test(material.name));
      if (!practical) return;
      material.color.setRGB(0, 0, 0);
      material.emissive.setRGB(...practical.color);
      material.emissiveIntensity = object.userData.emissiveStrength ?? practical.strength;
      const budget = object.userData.lightBudget ?? practical.budget;
      for (const box of emissiveClusters(object, compact ? Math.ceil(budget / 2) : budget)) {
        const centre = box.getCenter(new THREE.Vector3());
        const size = box.getSize(new THREE.Vector3());
        const length = Math.max(size.x, size.y, size.z);
        const power = object.userData.lightPower ?? practical.power;
        const light = new THREE.PointLight(new THREE.Color(...practical.color), power * (1 + length * 1.4), object.userData.lightReach ?? practical.reach, 2);
        // Sit just in front of the fixture so the wall behind it is washed too.
        const out = roomCentre.clone().setY(centre.y).sub(centre).setY(0).normalize().multiplyScalar(0.45);
        light.position.copy(centre).add(out);
        light.name = `Practical | ${practical.kind}`;
        practicalLights.add(light);
      }
    });
    scene.add(practicalLights);

    shadow = contactShadow();
    scene.add(shadow);

    // Probes of the lit workshop: the garage gets soft bounce from them and the car's
    // paint, glass and chrome reflect the neon and cabinets around it. With the
    // ceiling lights off, the ceiling is left out (it would wash every wall); with
    // them on, it is the main source, and the paint shows rows of tube reflections.
    const capture = (lightsOn) => {
      const hidden = [car, shadow];
      if (!lightsOn) scene.traverse((object) => { if (object.userData.excludeFromProbe) hidden.push(object); });
      hidden.forEach((object) => { object.visible = false; });
      applyCeiling(ceiling.rows.map(() => Number(lightsOn)));
      reflection.strength.value = 0;
      const probe = track(pmrem.fromScene(scene, 0.03, 0.1, 60, { position: new THREE.Vector3(0, 2.2, -2.5), size: 256 }));
      hidden.forEach((object) => { object.visible = true; });
      reflection.strength.value = 1;
      return probe;
    };
    ceiling.probes.on = capture(true);
    ceiling.probes.off = capture(false);
    car.traverse((object) => {
      if (!object.isMesh) return;
      for (const material of [object.material].flat().filter(Boolean)) {
        if (!material.isMeshStandardMaterial) continue;
        carMaterials.push(material);
        // Point lights on mirror-smooth clearcoat and glass make pin-point highlights
        // far above the bloom threshold, which bloom inflates into white blobs. Cap
        // them; reflected neon (environment) still blooms like in the references.
        material.onBeforeCompile = (shader) => {
          shader.fragmentShader = shader.fragmentShader.replace('#include <lights_fragment_end>', `#include <lights_fragment_end>
            reflectedLight.directSpecular = min(reflectedLight.directSpecular, vec3(1.6));
            #ifdef USE_CLEARCOAT
              clearcoatSpecularDirect = min(clearcoatSpecularDirect, vec3(1.6));
            #endif`);
        };
        material.customProgramCacheKey = () => 'garage-car-highlights';
        material.needsUpdate = true;
      }
    });
    ceiling.probe = null;
    applyCeiling(ceiling.rows.map(() => Number(ceiling.on)));
    renderer.shadowMap.needsUpdate = true;
  }

  function setSize(width, height) {
    const ratio = renderer.getPixelRatio();
    composer.setPixelRatio(ratio);
    composer.setSize(width, height);
    reflection.setSize(width * ratio, height * ratio);
  }

  /** Renders one frame; returns true while a lighting transition needs more frames. */
  function render(now = performance.now()) {
    const animating = advanceCeiling(now);
    renderer.info.reset();
    if (floor) reflection.update(renderer, scene, camera, [floor, shadow]);
    composer.render();
    return animating;
  }

  function dispose() {
    disposables.forEach((item) => item.dispose());
    practicalLights?.traverse((light) => light.dispose?.());
    base.traverse((light) => light.dispose?.());
  }

  return { attach, setSize, render, dispose, setCeilingLights, get practicalLights() { return practicalLights; } };
}
