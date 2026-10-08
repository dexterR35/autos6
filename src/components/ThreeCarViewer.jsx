import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { RotateCcw, Plus, Minus, Warehouse } from 'lucide-react';
import HotspotButton from './HotspotButton.jsx';
import { cameraPreset, GARAGE_TARGET, findMeshPart, partAnchors3D } from '../lib/garage3d.js';

const ANCHORS = partAnchors3D();
const MODEL_URLS = ['/models/s6-c5.glb', '/models/garage.glb'];

function disposeObject(root) {
  const geometries = new Set();
  const materials = new Set();
  const textures = new Set();
  root?.traverse((object) => {
    object.shadow?.dispose();
    if (object.geometry) geometries.add(object.geometry);
    for (const material of [object.material].flat().filter(Boolean)) {
      materials.add(material);
      Object.values(material).forEach((value) => { if (value?.isTexture) textures.add(value); });
    }
  });
  const images = new Set();
  textures.forEach((texture) => {
    for (const data of [texture.source?.data].flat().filter(Boolean)) images.add(data);
    texture.dispose();
  });
  // GLTFLoader creates ImageBitmaps where supported; disposing a texture only frees
  // its GPU allocation, so release the corresponding CPU bitmap explicitly too.
  images.forEach((data) => { if (typeof data.close === 'function') data.close(); });
  materials.forEach((material) => material.dispose());
  geometries.forEach((geometry) => geometry.dispose());
}

// Fetch is abortable on unmount/retry. Every texture is embedded in the exported GLB.
async function loadGlb(url, loader, signal, onProgress) {
  const response = await fetch(url, { signal });
  if (!response.ok) throw new Error(`Could not load ${url} (${response.status}).`);
  const length = Number(response.headers.get('content-length'));
  let buffer;
  if (response.body && length > 0) {
    const reader = response.body.getReader();
    const chunks = [];
    let loaded = 0;
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      chunks.push(value);
      loaded += value.byteLength;
      onProgress(Math.min(0.9, loaded / length * 0.9));
    }
    const bytes = new Uint8Array(loaded);
    let offset = 0;
    chunks.forEach((chunk) => { bytes.set(chunk, offset); offset += chunk.byteLength; });
    buffer = bytes.buffer;
  } else {
    buffer = await response.arrayBuffer();
    onProgress(0.9);
  }
  if (signal.aborted) throw new DOMException('Loading cancelled', 'AbortError');
  const gltf = await loader.parseAsync(buffer, '/models/');
  onProgress(1);
  return gltf.scene;
}

/** A shared world for the actual car and garage; presets move only the camera. */
export default function ThreeCarViewer({
  viewId, resetKey = 0, partsById = {}, visiblePartIds, selectedPartId, hoveredPartId,
  onPartSelect, onPartHover, reservedRefs = [], overlayRefs = [], compact = false,
  currency = 'usd', onViewError, onFallback,
}) {
  const stageRef = useRef(null);
  const mountRef = useRef(null);
  const toolbarRef = useRef(null);
  const hintRef = useRef(null);
  const markersRef = useRef(new Map());
  const runtimeRef = useRef(null);
  const propsRef = useRef(null);
  propsRef.current = { viewId, compact, partsById, visiblePartIds, selectedPartId, onPartSelect, onPartHover, reservedRefs, overlayRefs, onViewError };
  const [attempt, setAttempt] = useState(0);
  const [status, setStatus] = useState({ state: 'loading', progress: 0 });
  const [garageView, setGarageView] = useState(false);

  useEffect(() => {
    const host = mountRef.current;
    const stage = stageRef.current;
    let disposed = false;
    let failed = false;
    let frameId = 0;
    let renderer;
    let controls;
    let resizeObserver;
    let environmentTarget;
    let environmentScene;
    let pmrem;
    let car;
    let tween;
    let width = 1;
    let height = 1;
    let sceneReady = false;
    let pointerStart = null;
    const occluders = [];
    const cleanups = [];
    const abortController = new AbortController();
    const scene = new THREE.Scene();
    scene.background = new THREE.Color('#080d16');
    scene.fog = new THREE.FogExp2('#0b1120', 0.018);
    const camera = new THREE.PerspectiveCamera(36, 1, 0.08, 90);
    const pointer = new THREE.Vector2();
    const raycaster = new THREE.Raycaster();
    const occlusionRay = new THREE.Raycaster();
    const point = new THREE.Vector3();
    const normal = new THREE.Vector3();
    const toCamera = new THREE.Vector3();
    const projected = new THREE.Vector3();
    const previousTarget = new THREE.Vector3();
    const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

    setStatus({ state: 'loading', progress: 0 });
    setGarageView(false);

    function fail(error) {
      if (disposed || failed || error?.name === 'AbortError') return;
      failed = true;
      abortController.abort();
      setStatus({ state: 'error', progress: 0 });
      propsRef.current.onViewError?.('3d');
      console.error('The 3D garage could not be displayed:', error);
    }

    function requestFrame() {
      if (!disposed && !failed && !document.hidden && !frameId) frameId = requestAnimationFrame(renderFrame);
    }

    function projectMarkers() {
      if (!car || !sceneReady) return;
      const current = propsRef.current;
      const bounds = stage.getBoundingClientRect();
      const covered = [...current.reservedRefs, ...current.overlayRefs, toolbarRef, hintRef]
        .map((ref) => ref?.current?.getBoundingClientRect()).filter((rect) => rect?.width && rect?.height);
      const occupied = [];
      const entries = [...markersRef.current.entries()].sort(([a], [b]) => Number(b === current.selectedPartId) - Number(a === current.selectedPartId));
      for (const [partId, element] of entries) {
        let screenPoint = null;
        const candidates = (ANCHORS[partId] ?? []).map((anchor) => {
          point.fromArray(anchor.position);
          normal.fromArray(anchor.normal);
          toCamera.copy(camera.position).sub(point).normalize();
          return { ...anchor, facing: normal.dot(toCamera), distance: camera.position.distanceTo(point) };
        }).sort((a, b) => b.facing - a.facing || a.distance - b.distance);
        for (const anchor of candidates) {
          if (anchor.facing < 0.04) continue;
          point.fromArray(anchor.position);
          projected.copy(point).project(camera);
          if (projected.z < -1 || projected.z > 1) continue;
          const x = (projected.x + 1) * 0.5 * width;
          const y = (1 - projected.y) * 0.5 * height;
          if (x < 24 || x > width - 24 || y < 24 || y > height - 24) continue;
          if (covered.some((rect) => x + bounds.left > rect.left - 22 && x + bounds.left < rect.right + 22 && y + bounds.top > rect.top - 22 && y + bounds.top < rect.bottom + 22)) continue;
          if (occupied.some((other) => Math.hypot(x - other.x, y - other.y) < 36)) continue;
          toCamera.copy(point).sub(camera.position);
          const distance = toCamera.length();
          occlusionRay.set(camera.position, toCamera.normalize());
          occlusionRay.far = Math.max(0, distance - 0.14);
          if (occlusionRay.intersectObjects(occluders, true).length) continue;
          screenPoint = { x, y };
          break;
        }
        element.style.display = screenPoint ? 'block' : 'none';
        if (screenPoint) {
          element.style.transform = `translate3d(${screenPoint.x.toFixed(1)}px, ${screenPoint.y.toFixed(1)}px, 0)`;
          occupied.push(screenPoint);
        }
      }
    }

    function renderFrame(time) {
      frameId = 0;
      if (disposed || failed || document.hidden) return;
      if (tween) {
        const t = Math.min(1, (time - tween.started) / tween.duration);
        const ease = 1 - (1 - t) ** 3;
        controls.target.lerpVectors(tween.fromTarget, tween.toTarget, ease);
        const spherical = new THREE.Spherical(
          THREE.MathUtils.lerp(tween.fromOrbit.radius, tween.toOrbit.radius, ease),
          THREE.MathUtils.lerp(tween.fromOrbit.phi, tween.toOrbit.phi, ease),
          THREE.MathUtils.lerp(tween.fromOrbit.theta, tween.toOrbit.theta, ease),
        );
        camera.position.setFromSpherical(spherical).add(controls.target);
        camera.fov = THREE.MathUtils.lerp(tween.fromFov, tween.toFov, ease);
        camera.updateProjectionMatrix();
        if (t >= 1) tween = null;
      }
      // Keep the inspection target in the workshop and the camera below its ceiling.
      // The azimuth stays unrestricted, so the complete horizontal orbit remains free.
      previousTarget.copy(controls.target);
      controls.target.x = THREE.MathUtils.clamp(controls.target.x, -8, 8);
      controls.target.y = THREE.MathUtils.clamp(controls.target.y, 0.2, 3.5);
      controls.target.z = THREE.MathUtils.clamp(controls.target.z, -10, 8);
      camera.position.add(previousTarget.sub(controls.target).negate());
      const distance = camera.position.distanceTo(controls.target);
      // A full orbit stays inside the side and back walls, including after a pan.
      controls.maxDistance = Math.min(12.5, 13.2 - Math.abs(controls.target.x), 14.1 + controls.target.z);
      controls.minPolarAngle = Math.max(0.12, Math.acos(THREE.MathUtils.clamp((6.4 - controls.target.y) / Math.max(0.1, distance), -1, 1)));
      const changed = controls.update();
      if (camera.position.y > 6.4) {
        camera.position.y = 6.4;
        camera.lookAt(controls.target);
      }
      renderer.render(scene, camera);
      stage.dataset.cameraPosition = camera.position.toArray().map((n) => n.toFixed(3)).join(',');
      stage.dataset.cameraTarget = controls.target.toArray().map((n) => n.toFixed(3)).join(',');
      stage.dataset.cameraFov = camera.fov.toFixed(2);
      stage.dataset.renderCalls = String(renderer.info.render.calls);
      stage.dataset.triangles = String(renderer.info.render.triangles);
      projectMarkers();
      if (tween || changed) requestFrame();
    }

    function flyTo(position, target, immediate = false, fov = 36) {
      // Flush momentum before applying a saved camera, so drag inertia cannot alter it.
      controls.enableDamping = false;
      controls.update();
      controls.enableDamping = !reducedMotion;
      tween = null;
      if (immediate || reducedMotion) {
        camera.position.fromArray(position);
        controls.target.fromArray(target);
        camera.fov = fov;
        camera.updateProjectionMatrix();
      } else {
        const toTarget = new THREE.Vector3(...target);
        const fromOrbit = new THREE.Spherical().setFromVector3(camera.position.clone().sub(controls.target));
        const toOrbit = new THREE.Spherical().setFromVector3(new THREE.Vector3(...position).sub(toTarget));
        // Travel around the car along the short arc instead of crossing through it.
        toOrbit.theta = fromOrbit.theta + THREE.MathUtils.euclideanModulo(toOrbit.theta - fromOrbit.theta + Math.PI, Math.PI * 2) - Math.PI;
        tween = {
          fromOrbit, toOrbit, fromTarget: controls.target.clone(), toTarget,
          fromFov: camera.fov, toFov: fov,
          started: performance.now(), duration: 620,
        };
      }
      requestFrame();
    }

    function reset() {
      const preset = cameraPreset(propsRef.current.viewId, propsRef.current.compact);
      setGarageView(false);
      flyTo(preset.position, preset.target);
    }

    function pick(event) {
      if (!sceneReady || !car) return null;
      const rect = renderer.domElement.getBoundingClientRect();
      pointer.set((event.clientX - rect.left) / rect.width * 2 - 1, -(event.clientY - rect.top) / rect.height * 2 + 1);
      raycaster.setFromCamera(pointer, camera);
      // Test the nearest surface only: never select a hidden part through the body.
      const hit = raycaster.intersectObjects(occluders, true)[0];
      const id = hit ? findMeshPart(hit.object) : null;
      const current = propsRef.current;
      return id && current.partsById[id] && (!current.visiblePartIds || current.visiblePartIds.has(id)) ? id : null;
    }

    function listen(target, type, handler, options) {
      target.addEventListener(type, handler, options);
      cleanups.push(() => target.removeEventListener(type, handler, options));
    }

    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'high-performance' });
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, propsRef.current.compact ? 1.25 : 1.5));
      renderer.outputColorSpace = THREE.SRGBColorSpace;
      renderer.toneMapping = THREE.ACESFilmicToneMapping;
      renderer.toneMappingExposure = 1.05;
      renderer.shadowMap.enabled = true;
      renderer.shadowMap.type = THREE.PCFSoftShadowMap;
      const canvas = renderer.domElement;
      canvas.className = 'three-canvas';
      canvas.tabIndex = 0;
      canvas.setAttribute('role', 'img');
      canvas.setAttribute('aria-label', 'Interactive 3D Audi S6 and garage. Drag to orbit, scroll to zoom, right-drag to pan. Arrow keys orbit, plus and minus zoom, Home resets.');
      host.appendChild(canvas);

      controls = new OrbitControls(camera, canvas);
      controls.enableDamping = !reducedMotion;
      controls.dampingFactor = 0.09;
      controls.rotateSpeed = 0.65;
      controls.zoomSpeed = 0.85;
      controls.panSpeed = 0.7;
      controls.minDistance = 3.3;
      controls.maxDistance = 12.5;
      controls.minPolarAngle = 0.12;
      controls.maxPolarAngle = Math.PI / 2 - 0.025;
      controls.screenSpacePanning = true;
      const initial = cameraPreset(propsRef.current.viewId, propsRef.current.compact);
      camera.position.fromArray(initial.position);
      controls.target.fromArray(initial.target);
      controls.update();
      controls.addEventListener('change', requestFrame);
      controls.addEventListener('start', () => { tween = null; requestFrame(); });

      pmrem = new THREE.PMREMGenerator(renderer);
      environmentScene = new RoomEnvironment();
      environmentTarget = pmrem.fromScene(environmentScene, 0.04);
      scene.environment = environmentTarget.texture;
      scene.environmentIntensity = 0.55;
      scene.environmentRotation.set(0, Math.PI / 4, 0.15);
      scene.add(new THREE.HemisphereLight('#b8d3ff', '#111525', 0.4));
      const key = new THREE.DirectionalLight('#e3edff', 2.1);
      key.position.set(3, 8, 5);
      key.castShadow = true;
      key.shadow.mapSize.set(1024, 1024);
      key.shadow.camera.left = -6;
      key.shadow.camera.right = 6;
      key.shadow.camera.top = 6;
      key.shadow.camera.bottom = -6;
      key.shadow.normalBias = 0.035;
      key.shadow.bias = -0.0001;
      key.shadow.radius = 3;
      scene.add(key);
      const fill = new THREE.PointLight('#599dff', 45, 16, 2);
      fill.position.set(-3, 3, 3);
      scene.add(fill);
      const rim = new THREE.PointLight('#a575ff', 38, 16, 2);
      rim.position.set(2, 4, -5);
      scene.add(rim);
      const floor = new THREE.Mesh(new THREE.PlaneGeometry(30, 30), new THREE.ShadowMaterial({ color: '#02040a', opacity: 0.3 }));
      floor.rotation.x = -Math.PI / 2;
      floor.position.y = 0.009;
      floor.receiveShadow = true;
      scene.add(floor);

      function resize() {
        width = Math.max(1, host.clientWidth);
        height = Math.max(1, host.clientHeight);
        renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, window.matchMedia?.('(max-width: 900px)').matches ? 1.25 : 1.5));
        camera.aspect = width / height;
        camera.updateProjectionMatrix();
        renderer.setSize(width, height, false);
        requestFrame();
      }
      resizeObserver = new ResizeObserver(resize);
      resizeObserver.observe(host);
      resize();

      listen(canvas, 'webglcontextlost', (event) => { event.preventDefault(); fail(new Error('WebGL context lost. Retry to restore the garage.')); });
      listen(canvas, 'pointerdown', (event) => {
        pointerStart = { id: event.pointerId, x: event.clientX, y: event.clientY, moved: false, primary: event.isPrimary, button: event.button };
        propsRef.current.onPartHover?.(null);
      });
      listen(canvas, 'pointermove', (event) => {
        if (pointerStart) {
          if (event.pointerId !== pointerStart.id || Math.hypot(event.clientX - pointerStart.x, event.clientY - pointerStart.y) > 5) pointerStart.moved = true;
          return;
        }
        if (event.pointerType === 'touch') return;
        const partId = pick(event);
        canvas.style.cursor = partId ? 'pointer' : 'grab';
        propsRef.current.onPartHover?.(partId);
      });
      listen(canvas, 'pointerup', (event) => {
        const start = pointerStart;
        pointerStart = null;
        if (!start || !start.primary || start.moved || start.button !== 0 || event.pointerId !== start.id) return;
        const partId = pick(event);
        if (partId) propsRef.current.onPartSelect?.(partId, { source: 'hotspot' });
      });
      listen(canvas, 'pointercancel', () => { pointerStart = null; });
      listen(canvas, 'pointerleave', () => { propsRef.current.onPartHover?.(null); });
      listen(canvas, 'keydown', (event) => {
        const step = Math.PI / 18;
        const actions = {
          ArrowLeft: () => controls.rotateLeft(step), ArrowRight: () => controls.rotateLeft(-step),
          ArrowUp: () => controls.rotateUp(step), ArrowDown: () => controls.rotateUp(-step),
          '+': () => controls.dollyIn(1 / 1.16), '=': () => controls.dollyIn(1 / 1.16),
          '-': () => controls.dollyOut(1 / 1.16), _: () => controls.dollyOut(1 / 1.16), Home: reset,
        };
        if (!actions[event.key]) return;
        event.preventDefault();
        event.stopPropagation();
        tween = null;
        actions[event.key]();
        requestFrame();
      });
      listen(document, 'visibilitychange', () => {
        if (document.hidden) { cancelAnimationFrame(frameId); frameId = 0; }
        else requestFrame();
      });

      runtimeRef.current = {
        reset, invalidate: requestFrame,
        zoom: (direction) => { tween = null; direction > 0 ? controls.dollyIn(1 / 1.2) : controls.dollyOut(1 / 1.2); requestFrame(); },
        showGarage: (enabled) => {
          setGarageView(enabled);
          if (enabled) flyTo([6.5, 4.4, 8.1], GARAGE_TARGET, false, 50);
          else reset();
        },
      };

      const progress = [0, 0];
      const loader = new GLTFLoader();
      Promise.all(MODEL_URLS.map(async (url, index) => {
        const model = await loadGlb(url, loader, abortController.signal, (fraction) => {
          progress[index] = fraction;
          if (!disposed && !failed) setStatus({ state: 'loading', progress: Math.floor((progress[0] + progress[1]) / 2 * 95) });
        });
        if (disposed || failed) { disposeObject(model); return; }
        model.traverse((object) => {
          if (!object.isMesh) return;
          object.castShadow = index === 0;
          object.receiveShadow = true;
          for (const material of [object.material].flat().filter(Boolean)) {
            if (/paint|pearl|clearcoat|roof box/i.test(material.name)) {
              material.roughness = Math.min(material.roughness ?? 0.19, 0.19);
              material.metalness = Math.min(material.metalness ?? 0.55, 0.55);
              if ('clearcoat' in material) { material.clearcoat = 1; material.clearcoatRoughness = 0.055; }
              material.envMapIntensity = 1.1;
            }
          }
        });
        scene.add(model);
        occluders.push(model);
        if (index === 0) car = model;
        requestFrame();
      })).then(() => {
        if (disposed || failed) return;
        sceneReady = true;
        setStatus({ state: 'ready', progress: 100 });
        propsRef.current.onViewError?.(null);
        scene.updateMatrixWorld(true);
        requestFrame();
      }).catch(fail);
      requestFrame();
    } catch (error) {
      fail(error);
    }

    return () => {
      disposed = true;
      runtimeRef.current = null;
      abortController.abort();
      cancelAnimationFrame(frameId);
      resizeObserver?.disconnect();
      cleanups.forEach((cleanup) => cleanup());
      controls?.dispose();
      disposeObject(scene);
      environmentScene?.dispose();
      environmentTarget?.dispose();
      pmrem?.dispose();
      renderer?.dispose();
      renderer?.domElement.remove();
      markersRef.current.forEach((marker) => { marker.style.display = 'none'; });
    };
  }, [attempt]);

  useEffect(() => { runtimeRef.current?.reset(); }, [viewId, resetKey, compact]);
  useEffect(() => { runtimeRef.current?.invalidate(); }, [selectedPartId, visiblePartIds, hoveredPartId, status.state, reservedRefs, overlayRefs]);

  const ready = status.state === 'ready';
  const selectPart = (id) => onPartSelect?.(id, { source: 'hotspot' });
  return (
    <div ref={stageRef} className="viewer viewer--three" data-testid="three-viewer" data-renderer="three" data-view-id={viewId} data-loaded={ready}>
      <div ref={mountRef} className="three-canvas-mount" />
      {status.state === 'loading' && (
        <div className="three-loading" role="status" aria-live="polite">
          <span>Opening your 3D garage</span>
          <progress max="100" value={status.progress} aria-label="Loading 3D car and garage" />
          <small>{status.progress < 90 ? 'Loading the Audi and garage…' : 'Polishing the final details…'} {status.progress}%</small>
        </div>
      )}
      {status.state === 'error' && (
        <div className="three-error" role="alert">
          <strong>The 3D garage could not open.</strong>
          <p>Please retry, or use the rendered photos while 3D is unavailable.</p>
          <div>
            <button type="button" onClick={() => setAttempt((value) => value + 1)}>Retry 3D</button>
            {onFallback && <button type="button" onClick={onFallback}>View rendered photos</button>}
          </div>
        </div>
      )}
      {ready && (
        <>
          <div className="three-hotspots">
            {Object.keys(ANCHORS).filter((id) => partsById[id] && (!visiblePartIds || visiblePartIds.has(id))).map((id) => (
              <div className="three-hotspot-anchor" key={id} ref={(element) => { if (element) markersRef.current.set(id, element); else markersRef.current.delete(id); }}>
                <HotspotButton part={partsById[id]} point={{ x: 0, y: 0 }} selected={id === selectedPartId} active={id === (hoveredPartId ?? selectedPartId)} onSelect={selectPart} onHover={(partId) => onPartHover?.(partId)} currency={currency} />
              </div>
            ))}
          </div>
          <div ref={toolbarRef} className="three-toolbar" role="group" aria-label="3D camera controls">
            <button type="button" onClick={() => runtimeRef.current?.reset()} title="Reset view"><RotateCcw aria-hidden="true" /><span>Reset view</span></button>
            <button type="button" onClick={() => runtimeRef.current?.zoom(1)} aria-label="Zoom in" title="Zoom in"><Plus aria-hidden="true" /></button>
            <button type="button" onClick={() => runtimeRef.current?.zoom(-1)} aria-label="Zoom out" title="Zoom out"><Minus aria-hidden="true" /></button>
            <button type="button" className={garageView ? 'is-active' : ''} aria-pressed={garageView} onClick={() => runtimeRef.current?.showGarage(!garageView)} title="Garage view"><Warehouse aria-hidden="true" /><span>Garage view</span></button>
          </div>
          <p ref={hintRef} className="three-hint">{compact ? 'Drag to orbit · Pinch to zoom · Two fingers to pan' : 'Drag to orbit · Scroll to zoom · Right-drag to pan'}</p>
        </>
      )}
    </div>
  );
}
