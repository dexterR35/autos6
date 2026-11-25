import * as THREE from 'three';

export const RIG_PANELS = Object.freeze([
  ['door-fl', 'Front left door'], ['door-fr', 'Front right door'],
  ['door-rl', 'Rear left door'], ['door-rr', 'Rear right door'],
  ['hood', 'Bonnet'], ['tailgate', 'Tailgate'],
]);
export const DEFAULT_CAR_POSE = Object.freeze({ openPanels: [], steering: 0, wheelRotation: 0 });
const unitAxis = value => new THREE.Vector3().fromArray(value).normalize();
const visible = object => {
  for (let parent = object; parent; parent = parent.parent) if (!parent.visible) return false;
  return true;
};

/** Drive exported joints. The source meshes remain in their own local space. */
export function createCarRig(root) {
  const panels = [], steering = [], rolling = [], struts = [], dynamicMeshes = [];
  const joints = new Set(), raycaster = new THREE.Raycaster();
  const quaternion = new THREE.Quaternion(), endpoint = new THREE.Vector3();
  const strutAxis = new THREE.Vector3(0, 1, 0);
  let strutTarget;
  root.traverse(object => {
    const data = object.userData;
    if (data.bonnetStrutTarget) strutTarget = object;
    if (data.bonnetStrut) {
      let rod;
      object.traverse(child => { if (child.userData.bonnetStrutRod) rod = child; });
      if (rod) {
        struts.push({ object, rod });
        joints.add(object);
      }
    }
    if (data.articulationId && data.hingeAxis && Number.isFinite(data.openAngle)) {
      panels.push({ object, id: data.articulationId, axis: unitAxis(data.hingeAxis), angle: data.openAngle, rest: object.quaternion.clone(), value: 0 });
      joints.add(object);
    }
    if (data.assemblyId && data.maxSteer > 0) {
      steering.push({ object, axis: unitAxis(data.steeringAxis), rest: object.quaternion.clone(), value: 0 });
      joints.add(object);
    }
    if (data.rollingId) {
      rolling.push({ object, axis: unitAxis(data.rollingAxis), rest: object.quaternion.clone(), value: 0 });
      joints.add(object);
    }
  });
  root.traverse(object => {
    if (!object.isMesh) return;
    for (let parent = object; parent; parent = parent.parent) {
      if (!joints.has(parent)) continue;
      // Exclude moving geometry from the static world-space triangle index.
      // Raycast it in its current transform, including throughout an animation.
      object.userData.rigDynamic = true;
      dynamicMeshes.push(object);
      break;
    }
  });
  let target = DEFAULT_CAR_POSE;
  function setPose(pose) {
    target = {
      openPanels: new Set(pose.openPanels ?? []),
      steering: THREE.MathUtils.degToRad(THREE.MathUtils.clamp(Number(pose.steering) || 0, -30, 30)),
      wheelRotation: THREE.MathUtils.degToRad(THREE.MathUtils.clamp(Number(pose.wheelRotation) || 0, 0, 360)),
    };
  }
  setPose(DEFAULT_CAR_POSE);
  let initialized = false;
  function update(delta, immediate = false) {
    let moving = false, changed = false;
    const blend = immediate ? 1 : 1 - Math.exp(-12 * Math.min(delta, .05));
    for (const [items, goal] of [[panels, joint => target.openPanels.has(joint.id) ? joint.angle : 0], [steering, () => target.steering], [rolling, () => target.wheelRotation]]) {
      for (const joint of items) {
        const desired = goal(joint), difference = desired - joint.value;
        if (Math.abs(difference) < 1e-8) continue;
        changed = true;
        joint.value = immediate || Math.abs(difference) < .0005 ? desired : joint.value + difference * blend;
        moving ||= Math.abs(desired - joint.value) > 1e-8;
        quaternion.setFromAxisAngle(joint.axis, joint.value);
        joint.object.quaternion.copy(joint.rest).multiply(quaternion);
      }
    }
    if (changed || !initialized) {
      root.updateMatrixWorld(true);
      if (strutTarget) for (const { object, rod } of struts) {
        strutTarget.getWorldPosition(endpoint);
        object.parent.worldToLocal(endpoint);
        endpoint.sub(object.position);
        rod.scale.y = endpoint.length();
        object.quaternion.setFromUnitVectors(strutAxis, endpoint.normalize());
      }
      root.updateMatrixWorld(true);
      initialized = true;
    }
    return { moving, changed };
  }
  return {
    setPose, update,
    panels: panels.map(({ id }) => id),
    intersect(ray, far = Infinity) {
      raycaster.ray.copy(ray);
      raycaster.far = far;
      return raycaster.intersectObjects(dynamicMeshes.filter(visible), false)[0] ?? null;
    },
    snapshot() {
      return { panels: Object.fromEntries(panels.map(j => [j.id, j.value])), steering: steering.map(j => j.value), wheelRotation: rolling.map(j => j.value) };
    },
  };
}
