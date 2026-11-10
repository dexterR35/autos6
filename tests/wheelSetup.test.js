import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { applyWheelSetup, DEFAULT_WHEEL_SETUP, normalizeWheelSetup } from '../src/lib/wheelSetup.js';

describe('modular wheel configuration', () => {
  it('changes only rim and caliper paint and swaps real tyre meshes at all four corners', () => {
    const root = new THREE.Group(), rim = new THREE.MeshPhysicalMaterial({ name: 'S6.Modular.RimPaint | change wheel colour' });
    const caliper = new THREE.MeshPhysicalMaterial({ name: 'S6.Modular.CaliperPaint | change brake colour' });
    const rubber = new THREE.MeshStandardMaterial({ name: 'S6.Modular.TyreRubber', color: '#121417' });
    const originalRubber = rubber.color.clone(), road = [], track = [];
    for (let corner = 0; corner < 4; corner++) {
      root.add(new THREE.Mesh(new THREE.BoxGeometry(), rim), new THREE.Mesh(new THREE.BoxGeometry(), caliper));
      for (const [variant, list] of [['road', road], ['track', track]]) {
        const tyre = new THREE.Mesh(new THREE.TorusGeometry(), rubber);
        tyre.userData.tyreVariant = variant; root.add(tyre); list.push(tyre);
      }
    }
    applyWheelSetup(root, { rimColor: '#a67c46', caliperColor: '#2365cc', tyre: 'track' });
    expect(rim.color.getHexString()).toBe('a67c46');
    expect(caliper.color.getHexString()).toBe('2365cc');
    expect(rubber.color).toEqual(originalRubber);
    expect(road.every(object => !object.visible)).toBe(true);
    expect(track.every(object => object.visible)).toBe(true);
    applyWheelSetup(root, DEFAULT_WHEEL_SETUP);
    expect(road.every(object => object.visible)).toBe(true);
    expect(track.every(object => !object.visible)).toBe(true);
  });

  it('rejects malformed saved colours and unsupported tyre identifiers', () => {
    for (const value of [null, {}, { rimColor: 'red', caliperColor: '#xyzxyz', tyre: 'missing' }]) expect(normalizeWheelSetup(value)).toEqual(DEFAULT_WHEEL_SETUP);
    expect(normalizeWheelSetup({ rimColor: '#ABCDEF', tyre: 'track' })).toEqual({ ...DEFAULT_WHEEL_SETUP, rimColor: '#ABCDEF', tyre: 'track' });
  });
});
