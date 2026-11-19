import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { safeMediaUrl } from '../lib/safeMedia.js';

const MAX_BYTES = 30 * 1024 * 1024;

function dispose(root) {
  root?.traverse((o) => {
    o.geometry?.dispose();
    for (const m of [o.material].flat().filter(Boolean)) {
      Object.values(m).forEach((v) => { if (v?.isTexture) v.dispose(); });
      m.dispose();
    }
  });
}

/**
 * Orbitable preview of one part's GLB (loaded lazily, only when a visitor asks for it).
 * Export models as .glb; Meshopt compression is supported (see docs/PART-FUNDING.md).
 */
export default function PartModelViewer({ src, name }) {
  const mountRef = useRef(null);
  const [state, setState] = useState({ phase: 'loading', progress: 0 });

  useEffect(() => {
    const url = safeMediaUrl(src);
    const mount = mountRef.current;
    if (!url || !mount) { setState({ phase: 'error' }); return undefined; }
    const abort = new AbortController();
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

    let renderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'low-power' });
    } catch {
      setState({ phase: 'error', message: '3D preview is not supported on this device.' });
      return undefined;
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    mount.appendChild(renderer.domElement);
    renderer.domElement.setAttribute('aria-hidden', 'true');

    const scene = new THREE.Scene();
    const pmrem = new THREE.PMREMGenerator(renderer);
    const envTarget = pmrem.fromScene(new RoomEnvironment(), 0.04);
    scene.environment = envTarget.texture;
    const key = new THREE.DirectionalLight(0xffffff, 1.6);
    key.position.set(3, 5, 4);
    scene.add(key, new THREE.HemisphereLight(0xdfe8ff, 0x1a1c22, 0.6));

    const camera = new THREE.PerspectiveCamera(35, 1, 0.01, 1000);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.enablePan = false;
    controls.autoRotate = !reduced;
    controls.autoRotateSpeed = 1.2;
    controls.addEventListener('start', () => { controls.autoRotate = false; });

    const resize = () => {
      const { clientWidth: w, clientHeight: h } = mount;
      if (!w || !h) return;
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    };
    const observer = new ResizeObserver(resize);
    observer.observe(mount);
    resize();

    let frame = 0;
    let model = null;
    const tick = () => {
      frame = requestAnimationFrame(tick);
      controls.update();
      renderer.render(scene, camera);
    };

    (async () => {
      try {
        const res = await fetch(url, { signal: abort.signal });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        if (Number(res.headers.get('content-length')) > MAX_BYTES) throw new Error('Model is too large to preview.');
        const buffer = await res.arrayBuffer();
        if (buffer.byteLength > MAX_BYTES) throw new Error('Model is too large to preview.');
        const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
        const gltf = await loader.parseAsync(buffer, new URL('.', new URL(url, window.location.href)).href);
        if (abort.signal.aborted) { dispose(gltf.scene); return; }
        model = gltf.scene;
        // Centre and frame the part whatever units it was exported in.
        const box = new THREE.Box3().setFromObject(model);
        const size = box.getSize(new THREE.Vector3());
        const center = box.getCenter(new THREE.Vector3());
        model.position.sub(center);
        scene.add(model);
        const radius = Math.max(size.length() / 2, 1e-3);
        const dist = radius / Math.sin(THREE.MathUtils.degToRad(camera.fov / 2));
        camera.near = dist / 100;
        camera.far = dist * 100;
        camera.position.set(dist * 0.7, dist * 0.45, dist * 0.75);
        camera.updateProjectionMatrix();
        controls.minDistance = radius * 1.1;
        controls.maxDistance = dist * 3;
        controls.target.set(0, 0, 0);
        setState({ phase: 'ready' });
        tick();
      } catch (err) {
        if (err?.name === 'AbortError') return;
        setState({ phase: 'error', message: err?.message?.includes('too large') ? err.message : 'Could not load the 3D model.' });
      }
    })();

    return () => {
      abort.abort();
      cancelAnimationFrame(frame);
      observer.disconnect();
      controls.dispose();
      dispose(model);
      envTarget.dispose();
      pmrem.dispose();
      renderer.dispose();
      renderer.domElement.remove();
    };
  }, [src]);

  return (
    <div className="part-model" role="img" aria-label={`3D model of ${name}. Drag to rotate, scroll or pinch to zoom.`}>
      <div ref={mountRef} className="part-model__canvas" />
      {state.phase === 'loading' && <p className="part-model__msg">Loading 3D model…</p>}
      {state.phase === 'error' && <p className="part-model__msg" role="alert">{state.message ?? 'Could not load the 3D model.'}</p>}
      {state.phase === 'ready' && <p className="part-model__hint" aria-hidden="true">Drag to rotate · scroll to zoom</p>}
    </div>
  );
}
