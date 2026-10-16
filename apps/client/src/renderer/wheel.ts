import * as THREE from 'three';
import { RimStyle, TireStyle } from './carLook.js';

/**
 * Realistic procedural wheel with the axle along local X:
 *  - lathe-profiled tire (rounded shoulders, bulged sidewall) with a procedural tread texture
 *    used as color + bump map, and a raised sidewall ring,
 *  - deep rim: barrel, polished lip and one of several spoke styles,
 *  - hub cap with lug nuts, drilled brake disc (spins) and a caliper (does not spin).
 * `spin` rotates with the wheel; `fixed` (caliper) stays with the suspension pivot.
 */
export interface WheelParts {
  spin: THREE.Group;
  fixed: THREE.Group;
  dispose(): void;
}

export interface WheelMaterials {
  tire: THREE.MeshStandardMaterial;
  rim: THREE.MeshStandardMaterial;
  barrel: THREE.MeshStandardMaterial;
  disc: THREE.MeshStandardMaterial;
  accent: THREE.Material;
  dispose(): void;
}

const treadCache = new Map<TireStyle, THREE.CanvasTexture>();

function treadTexture(style: TireStyle): THREE.CanvasTexture {
  const cached = treadCache.get(style);
  if (cached) return cached;
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 128; // u = around the tire, v = across the profile
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#9a9a9a';
  ctx.fillRect(0, 0, 256, 128);
  ctx.fillStyle = '#2a2a2a';
  if (style === 'street') {
    for (let x = 0; x < 256; x += 16) {
      ctx.fillRect(x, 34, 3, 60); // lateral sipes
      ctx.beginPath(); // diagonal grooves
      ctx.moveTo(x, 34); ctx.lineTo(x + 10, 50); ctx.lineTo(x + 13, 50); ctx.lineTo(x + 3, 34); ctx.fill();
      ctx.beginPath();
      ctx.moveTo(x, 94); ctx.lineTo(x + 10, 78); ctx.lineTo(x + 13, 78); ctx.lineTo(x + 3, 94); ctx.fill();
    }
    ctx.fillRect(0, 60, 256, 4); // circumferential grooves
    ctx.fillRect(0, 70, 256, 4);
  } else if (style === 'offroad') {
    for (let x = 0; x < 256; x += 32) {
      ctx.fillRect(x, 28, 12, 72);
      ctx.fillRect(x + 16, 28, 16, 30);
      ctx.fillRect(x + 16, 70, 16, 30);
    }
  } else {
    ctx.fillRect(0, 63, 256, 2); // slick: one fine wear line
  }
  // sidewall ribs (outer bands of v)
  ctx.fillStyle = '#5a5a5a';
  for (let x = 0; x < 256; x += 4) {
    ctx.fillRect(x, 6, 1, 14);
    ctx.fillRect(x, 108, 1, 14);
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = THREE.RepeatWrapping;
  t.repeat.set(style === 'offroad' ? 6 : 8, 1);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  treadCache.set(style, t);
  return t;
}

export function createWheelMaterials(rimColor: string, accent: THREE.Material, tire: TireStyle): WheelMaterials {
  const tread = treadTexture(tire);
  const m: WheelMaterials = {
    tire: new THREE.MeshStandardMaterial({ color: 0x2a2b2e, map: tread, bumpMap: tread, bumpScale: tire === 'offroad' ? 6 : 3, roughness: 0.92 }),
    rim: new THREE.MeshStandardMaterial({ color: rimColor, metalness: 0.95, roughness: 0.22 }),
    barrel: new THREE.MeshStandardMaterial({ color: 0x3a3d44, metalness: 0.9, roughness: 0.4, side: THREE.DoubleSide }),
    disc: new THREE.MeshStandardMaterial({ color: 0x7c7f86, metalness: 0.85, roughness: 0.35 }),
    accent,
    dispose: () => {
      m.tire.dispose();
      m.rim.dispose();
      m.barrel.dispose();
      m.disc.dispose();
    },
  };
  return m;
}

/** Build one wheel. `side` = +1 for the left (+X) side, -1 for the right; spokes face outward. */
export function createWheel(radius: number, width: number, side: number, style: RimStyle, mats: WheelMaterials): WheelParts {
  const geoms: THREE.BufferGeometry[] = [];
  const g = <T extends THREE.BufferGeometry>(x: T) => (geoms.push(x), x);
  const spin = new THREE.Group();
  const fixed = new THREE.Group();
  const mesh = (geom: THREE.BufferGeometry, mat: THREE.Material, parent: THREE.Object3D = spin) => {
    const m = new THREE.Mesh(g(geom), mat);
    m.castShadow = true;
    parent.add(m);
    return m;
  };
  const R = radius;
  const rRim = R * 0.66;
  const hw = width / 2;
  const out = side * hw; // outer face x

  // Tire: lathe profile (x = radius, y = axle) revolved around Y, then turned so the axle is X.
  const prof: THREE.Vector2[] = [];
  const N = 14;
  for (let i = 0; i <= N; i++) {
    const a = -Math.PI / 2 + (i / N) * Math.PI; // -90..90 deg across the tread
    const shoulder = 0.28 * width;
    const yy = Math.sin(a) * hw;
    const bulge = Math.cos(a);
    prof.push(new THREE.Vector2(rRim + (R - rRim) * Math.pow(bulge, 0.35) - (1 - bulge) * 0.004, yy * (1 - 0.06 * bulge) + (Math.abs(yy) > hw - shoulder ? 0 : 0)));
  }
  const tireGeom = new THREE.LatheGeometry(prof, 48);
  tireGeom.rotateZ(Math.PI / 2);
  mesh(tireGeom, mats.tire);

  // Barrel (inner rim surface) + polished outer lip
  const barrel = new THREE.CylinderGeometry(rRim * 0.98, rRim * 0.98, width * 0.92, 32, 1, true);
  barrel.rotateZ(Math.PI / 2);
  mesh(barrel, mats.barrel);
  const lip = new THREE.TorusGeometry(rRim * 0.97, R * 0.035, 8, 40);
  lip.rotateY(Math.PI / 2);
  mesh(lip, mats.rim).position.x = out * 0.9;

  // Spokes on the outer face, slightly recessed (concave)
  const face = out * 0.62;
  const spokeLen = rRim * 0.92;
  const addSpoke = (angle: number, w: number, depth: number, twist = 0) => {
    const s = mesh(new THREE.BoxGeometry(depth, spokeLen, w), mats.rim);
    s.geometry.translate(0, spokeLen / 2, 0);
    s.rotation.x = angle;
    s.rotation.y = twist;
    s.position.x = face;
  };
  if (style === 'sport') {
    for (let k = 0; k < 5; k++) addSpoke((k / 5) * Math.PI * 2, R * 0.16, width * 0.18);
  } else if (style === 'mesh') {
    for (let k = 0; k < 10; k++) {
      const a = (k / 10) * Math.PI * 2;
      addSpoke(a + 0.09, R * 0.06, width * 0.12);
      addSpoke(a - 0.09, R * 0.06, width * 0.12);
    }
  } else if (style === 'turbine') {
    for (let k = 0; k < 12; k++) addSpoke((k / 12) * Math.PI * 2, R * 0.1, width * 0.1, side * 0.5);
  } else {
    const dish = new THREE.CylinderGeometry(rRim * 0.93, rRim * 0.93, width * 0.08, 32);
    dish.rotateZ(Math.PI / 2);
    mesh(dish, mats.rim).position.x = face;
    for (let k = 0; k < 6; k++) {
      const hole = new THREE.CylinderGeometry(R * 0.07, R * 0.07, width * 0.1, 14);
      hole.rotateZ(Math.PI / 2);
      const a = (k / 6) * Math.PI * 2;
      const h = mesh(hole, mats.barrel);
      h.position.set(face + side * 0.002, Math.cos(a) * rRim * 0.6, Math.sin(a) * rRim * 0.6);
    }
  }

  // Hub cap + lug nuts
  const hub = new THREE.CylinderGeometry(R * 0.2, R * 0.24, width * 0.22, 20);
  hub.rotateZ(Math.PI / 2);
  mesh(hub, mats.accent).position.x = face + side * width * 0.05;
  for (let k = 0; k < 5; k++) {
    const nut = new THREE.CylinderGeometry(R * 0.03, R * 0.03, width * 0.08, 6);
    nut.rotateZ(Math.PI / 2);
    const a = (k / 5) * Math.PI * 2;
    mesh(nut, mats.rim).position.set(face + side * width * 0.13, Math.cos(a) * R * 0.13, Math.sin(a) * R * 0.13);
  }

  // Brake disc (spins) and caliper (fixed to the pivot)
  const disc = new THREE.CylinderGeometry(rRim * 0.78, rRim * 0.78, width * 0.08, 28);
  disc.rotateZ(Math.PI / 2);
  mesh(disc, mats.disc).position.x = side * width * 0.1;
  const caliper = mesh(new THREE.BoxGeometry(width * 0.22, R * 0.28, R * 0.42), mats.accent, fixed);
  caliper.position.set(side * width * 0.16, rRim * 0.55, -rRim * 0.35);
  caliper.rotation.x = 0.55;

  return { spin, fixed, dispose: () => geoms.forEach((x) => x.dispose()) };
}
