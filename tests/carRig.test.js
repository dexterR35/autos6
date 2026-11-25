import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { createCarRig, DEFAULT_CAR_POSE } from '../src/lib/carRig.js';
import { RayIndex } from '../src/lib/rayIndex.js';

function fixture() {
  const car = new THREE.Group();
  const door = new THREE.Group();
  door.userData = { articulationId: 'door-fl', hingeAxis: [0, 1, 0], openAngle: Math.PI / 2 };
  const skin = new THREE.Mesh(new THREE.BoxGeometry(1, 1, .05), new THREE.MeshBasicMaterial());
  skin.position.x = -.5;
  door.add(skin); car.add(door);
  const axle = new THREE.Group();
  axle.position.set(1.4, .317, .8);
  axle.userData = { assemblyId: 'wheel-fl', maxSteer: Math.PI / 6, steeringAxis: [0, 1, 0] };
  const rolling = new THREE.Group();
  rolling.userData = { rollingId: 'FL', rollingAxis: [0, 0, 1] };
  const rim = new THREE.Mesh(new THREE.BoxGeometry(.5, .5, .1), new THREE.MeshBasicMaterial());
  const caliper = new THREE.Mesh(new THREE.BoxGeometry(.05, .1, .08), new THREE.MeshBasicMaterial());
  caliper.position.x = -.1;
  rolling.add(rim); axle.add(rolling, caliper); car.add(axle);
  const rig = createCarRig(car);
  return { car, door, skin, axle, rolling, rim, caliper, rig };
}

describe('A6 articulation', () => {
  it('opens a complete door around its hinge and closes it without geometry drift', () => {
    const { skin, door, rig } = fixture();
    const positions = new Float32Array(skin.geometry.attributes.position.array);
    rig.setPose({ ...DEFAULT_CAR_POSE, openPanels: ['door-fl'] });
    rig.update(0, true);
    expect(skin.getWorldPosition(new THREE.Vector3()).z).toBeCloseTo(.5);
    expect(door.position.toArray()).toEqual([0, 0, 0]);
    rig.setPose(DEFAULT_CAR_POSE); rig.update(0, true);
    expect(skin.getWorldPosition(new THREE.Vector3()).toArray()).toEqual([-.5, 0, 0]);
    expect(skin.geometry.attributes.position.array).toEqual(positions);
  });

  it('turns rotating wheel parts without rotating the caliper, and steers both together', () => {
    const { car, rim, caliper, axle, rig } = fixture();
    const originalCaliper = caliper.getWorldQuaternion(new THREE.Quaternion());
    rig.setPose({ ...DEFAULT_CAR_POSE, wheelRotation: 90 }); rig.update(0, true);
    expect(caliper.getWorldQuaternion(new THREE.Quaternion()).angleTo(originalCaliper)).toBeCloseTo(0);
    expect(rim.getWorldQuaternion(new THREE.Quaternion()).angleTo(originalCaliper)).toBeCloseTo(Math.PI / 2);
    rig.setPose({ ...DEFAULT_CAR_POSE, wheelRotation: 90, steering: 30 }); rig.update(0, true);
    expect(caliper.getWorldQuaternion(new THREE.Quaternion()).angleTo(axle.quaternion)).toBeCloseTo(0);
    expect(axle.position.toArray()).toEqual([1.4, .317, .8]);
    car.updateMatrixWorld(true);
    expect(rim.getWorldPosition(new THREE.Vector3()).distanceTo(axle.position)).toBeCloseTo(0);
  });

  it('picks a moving door in its current position and excludes hidden alternatives', () => {
    const { car, skin, rig } = fixture();
    const index = new RayIndex([car]);
    rig.setPose({ ...DEFAULT_CAR_POSE, openPanels: ['door-fl'] }); rig.update(0, true);
    const ray = new THREE.Ray(new THREE.Vector3(2, 0, .5), new THREE.Vector3(-1, 0, 0));
    expect(index.meshes).not.toContain(skin);
    expect(rig.intersect(ray, 5)?.object).toBe(skin);
    skin.visible = false;
    expect(rig.intersect(ray, 5)).toBeNull();
  });

  it('eases to a finite pose and snaps immediately for reduced motion', () => {
    const { rig } = fixture();
    rig.setPose({ openPanels: ['door-fl'], steering: 900, wheelRotation: NaN });
    expect(rig.update(1 / 60).moving).toBe(true);
    for (let i = 0; i < 100; i++) rig.update(1 / 60);
    expect(rig.update(1 / 60).moving).toBe(false);
    expect(rig.snapshot().panels['door-fl']).toBeCloseTo(Math.PI / 2);
    expect(rig.snapshot().steering[0]).toBeCloseTo(Math.PI / 6);
    rig.setPose(DEFAULT_CAR_POSE);
    expect(rig.update(0, true).moving).toBe(false);
    expect(rig.snapshot().panels['door-fl']).toBe(0);
  });

  it('keeps a telescoping gas support attached through opening and closing, including a rotated car', () => {
    const car = new THREE.Group();
    car.position.set(3, 0, -2); car.rotation.y = .7;
    const hood = new THREE.Group();
    hood.position.set(1.08, .916, 0);
    hood.userData = { articulationId: 'hood', hingeAxis: [0, 0, 1], openAngle: 1.08 };
    const target = new THREE.Object3D();
    target.position.set(.60, -.07, -.635); target.userData.bonnetStrutTarget = true;
    hood.add(target); car.add(hood);
    const strut = new THREE.Group(), rod = new THREE.Group();
    strut.position.set(1.16, .748, -.682); strut.userData.bonnetStrut = true;
    rod.userData.bonnetStrutRod = true;
    const mesh = new THREE.Mesh(new THREE.CylinderGeometry(.005, .005, 1));
    mesh.position.y = .5; rod.add(mesh); strut.add(rod); car.add(strut);
    const rig = createCarRig(car);
    const lengths = [];
    for (const openPanels of [[], ['hood'], []]) {
      rig.setPose({ openPanels }); rig.update(0, true);
      const tip = rod.localToWorld(new THREE.Vector3(0, 1, 0));
      expect(tip.distanceTo(target.getWorldPosition(new THREE.Vector3()))).toBeLessThan(1e-8);
      lengths.push(rod.scale.y);
    }
    expect(lengths[1]).toBeGreaterThan(lengths[0]);
    expect(lengths[2]).toBeCloseTo(lengths[0]);
    expect(mesh.userData.rigDynamic).toBe(true);
  });
});
