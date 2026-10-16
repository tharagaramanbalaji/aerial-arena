import * as THREE from 'three';
import { GLTF, GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { CAR_CONFIG, Team } from '@aerial-arena/shared';

/**
 * Optional user-supplied car model.
 *
 * Drop a binary glTF at `apps/client/public/models/car.glb` (served as /models/car.glb).
 * An optional `apps/client/public/models/car.json` tweaks the fit:
 * {
 *   "file": "car.glb",            // model file name inside /models
 *   "rotationY": 0,               // degrees; use 180 / 90 / -90 if the model doesn't face +Z
 *   "length": 1.3,                // target length in meters (auto-scales); ignored if "scale" is set
 *   "scale": null,                // explicit uniform scale
 *   "offset": [0, 0, 0],          // extra translation in meters after fitting
 *   "paintMaterials": ["Body"],   // material names (substring, case-insensitive) recolored per team
 *   "wheelNodes": ["Wheel"],      // node names (substring) spun with speed; names with "front"/"FL"/"FR" also steer
 *   "nozzle": [0, 0.07, -0.6]     // boost flame position in car space (default: rear-center of the model)
 * }
 * Collision is unchanged: the model is purely visual and is fitted to the RL-sized hitbox.
 * Use uncompressed GLB/glTF (Draco/Meshopt-compressed files are not supported). Only use models
 * you have the rights to.
 */
export interface CustomCarConfig {
  file: string;
  rotationY: number;
  length: number;
  scale: number | null;
  offset: [number, number, number];
  paintMaterials: string[];
  /** Textured materials blended toward the team color by tintStrength (0..1). */
  tintMaterials: string[];
  tintStrength: number;
  wheelNodes: string[];
  nozzle: [number, number, number] | null;
}

export interface CustomCarModel {
  gltf: GLTF;
  config: CustomCarConfig;
}

export interface CustomCarInstance {
  object: THREE.Group;
  wheels: { node: THREE.Object3D; base: THREE.Quaternion; front: boolean }[];
  nozzle: THREE.Vector3;
  dispose(): void;
}

const DEFAULTS: CustomCarConfig = {
  file: 'car.glb',
  rotationY: 0,
  length: 1.3,
  scale: null,
  offset: [0, 0, 0],
  paintMaterials: ['paint', 'body', 'primary', 'team'],
  tintMaterials: [],
  tintStrength: 0.35,
  wheelNodes: ['wheel', 'tire', 'tyre'],
  nozzle: null,
};

const TEAM_COLOR: Record<Team, number> = { blue: 0x1d5cff, orange: 0xff6a0f };

/** Fetches /models/car.json + the model. Resolves to null when no model is installed. */
export async function loadCustomCarModel(): Promise<CustomCarModel | null> {
  let config = { ...DEFAULTS };
  try {
    const res = await fetch('/models/car.json', { cache: 'no-cache' });
    if (res.ok && !(res.headers.get('content-type') ?? '').includes('text/html')) {
      config = { ...config, ...(await res.json()) };
    }
  } catch {
    /* no config: use defaults */
  }
  const url = `/models/${config.file}`;
  try {
    const head = await fetch(url, { method: 'HEAD', cache: 'no-cache' });
    // The dev server answers unknown paths with index.html, so check the content type too.
    if (!head.ok || (head.headers.get('content-type') ?? '').includes('text/html')) return null;
    const gltf = await new GLTFLoader().loadAsync(url);
    console.info(`[Aerial Arena] Using custom car model ${url}`);
    return { gltf, config };
  } catch (err) {
    console.warn(`[Aerial Arena] Could not load custom car model ${url}; using the built-in car.`, err);
    return null;
  }
}

/** Clone, fit to the car hitbox, sit on the ground, and recolor for a team. */
export function instantiateCustomCar(model: CustomCarModel, team: Team): CustomCarInstance {
  const { config } = model;
  const object = new THREE.Group();
  const fit = new THREE.Group();
  const scene = model.gltf.scene.clone(true);
  fit.add(scene);
  fit.rotation.y = THREE.MathUtils.degToRad(config.rotationY);
  object.add(fit);

  const owned: THREE.Material[] = [];
  const matches = (name: string, list: string[]) => list.some((s) => name.toLowerCase().includes(s.toLowerCase()));
  scene.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    const recolor = (m: THREE.Material) => {
      const name = m.name ?? '';
      const paint = matches(name, config.paintMaterials);
      const tint = !paint && matches(name, config.tintMaterials);
      if (!paint && !tint) return m;
      const c = m.clone() as THREE.MeshStandardMaterial;
      if ('color' in c) {
        if (paint) c.color.set(TEAM_COLOR[team]);
        else c.color.set(0xffffff).lerp(new THREE.Color(TEAM_COLOR[team]), config.tintStrength);
      }
      owned.push(c);
      return c;
    };
    mesh.material = Array.isArray(mesh.material) ? mesh.material.map(recolor) : recolor(mesh.material);
  });

  // Fit: scale to the target length, center on the hitbox, put the lowest point on the floor.
  object.updateMatrixWorld(true);
  let box = new THREE.Box3().setFromObject(object);
  const size = box.getSize(new THREE.Vector3());
  const scale = config.scale ?? (size.z > 1e-6 ? config.length / size.z : 1);
  fit.scale.setScalar(scale);
  object.updateMatrixWorld(true);
  box = new THREE.Box3().setFromObject(object);
  const center = box.getCenter(new THREE.Vector3());
  fit.position.set(
    -center.x + config.offset[0],
    -box.min.y - CAR_CONFIG.restHeight + config.offset[1],
    -center.z + CAR_CONFIG.hitboxOffsetForward + config.offset[2]
  );
  object.updateMatrixWorld(true);
  box = new THREE.Box3().setFromObject(object);

  // Names ending in a digit (e.g. "Mesh3") must match exactly so "Mesh1" doesn't catch "Mesh10".
  const isWheel = (name: string) =>
    config.wheelNodes.some((w) => (/\d$/.test(w) ? name.toLowerCase() === w.toLowerCase() : name.toLowerCase().includes(w.toLowerCase())));
  const found: THREE.Object3D[] = [];
  scene.traverse((o) => {
    if (o !== scene && isWheel(o.name) && !found.some((w) => isAncestor(w, o))) found.push(o);
  });
  const carCenterZ = (box.min.z + box.max.z) / 2;
  const wheels: CustomCarInstance['wheels'] = [];
  for (const node of found) {
    // Re-pivot: move off-center wheel geometry so the node spins about the wheel's own center.
    const mesh = node as THREE.Mesh;
    if (mesh.isMesh) {
      mesh.geometry = mesh.geometry.clone();
      mesh.geometry.computeBoundingBox();
      const c = mesh.geometry.boundingBox!.getCenter(new THREE.Vector3());
      mesh.geometry.translate(-c.x, -c.y, -c.z);
      mesh.position.add(c.multiply(mesh.scale).applyQuaternion(mesh.quaternion));
      mesh.updateMatrixWorld(true);
    }
    const wc = new THREE.Box3().setFromObject(node).getCenter(new THREE.Vector3());
    const front = /front|fl\b|fr\b|_f_|\.f\b/i.test(node.name) || wc.z > carCenterZ;
    wheels.push({ node, base: node.quaternion.clone(), front });
  }

  const nozzle = config.nozzle
    ? new THREE.Vector3(...config.nozzle)
    : new THREE.Vector3(0, THREE.MathUtils.lerp(box.min.y, box.max.y, 0.35), box.min.z - 0.02);

  return { object, wheels, nozzle, dispose: () => owned.forEach((m) => m.dispose()) };
}

function isAncestor(a: THREE.Object3D, b: THREE.Object3D): boolean {
  for (let p = b.parent; p; p = p.parent) if (p === a) return true;
  return false;
}
