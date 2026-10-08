import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { RayIndex } from '../src/lib/rayIndex.js';

function scene() {
  const root = new THREE.Group();
  const material = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide });
  const random = (() => { let seed = 7; return () => ((seed = (seed * 16807) % 2147483647) / 2147483647); })();
  for (let i = 0; i < 40; i++) {
    const geometry = i % 2 ? new THREE.SphereGeometry(0.2 + random(), 12, 8) : new THREE.BoxGeometry(random() + 0.1, random() + 0.1, random() + 0.1);
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(random() * 16 - 8, random() * 4, random() * 16 - 8);
    mesh.rotation.set(random() * 3, random() * 3, random() * 3);
    root.add(mesh);
  }
  const instanced = new THREE.InstancedMesh(new THREE.BoxGeometry(0.3, 0.3, 0.3), material, 20);
  for (let i = 0; i < 20; i++) instanced.setMatrixAt(i, new THREE.Matrix4().makeTranslation(i - 10, 1, 0));
  root.add(instanced);
  root.updateMatrixWorld(true);
  return root;
}

describe('RayIndex', () => {
  it('matches three.js raycasting for the nearest hit and its object', () => {
    const root = scene();
    const index = new RayIndex([root]);
    const raycaster = new THREE.Raycaster();
    let hits = 0;
    for (let i = 0; i < 400; i++) {
      const origin = new THREE.Vector3(Math.sin(i) * 12, 1 + Math.cos(i * 0.7) * 2, Math.cos(i * 1.3) * 12);
      const target = new THREE.Vector3(Math.sin(i * 2.1) * 6, Math.sin(i * 0.3) * 2 + 1, Math.cos(i * 1.7) * 6);
      raycaster.set(origin, target.sub(origin).normalize());
      const expected = raycaster.intersectObject(root, true)[0];
      const actual = index.intersect(raycaster.ray);
      expect(Boolean(actual)).toBe(Boolean(expected));
      if (!expected) continue;
      hits++;
      expect(actual.distance).toBeCloseTo(expected.distance, 4);
      expect(actual.object).toBe(expected.object);
    }
    expect(hits).toBeGreaterThan(100);
  });

  it('respects the far limit and reports any hit for occlusion', () => {
    const root = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial());
    root.updateMatrixWorld(true);
    const index = new RayIndex([root]);
    const ray = new THREE.Ray(new THREE.Vector3(0, 0, 5), new THREE.Vector3(0, 0, -1));
    expect(index.intersect(ray, 4.6, true)).not.toBeNull();
    expect(index.intersect(ray, 4.4, true)).toBeNull();
    expect(index.intersect(ray).distance).toBeCloseTo(4.5, 6);
  });
});
