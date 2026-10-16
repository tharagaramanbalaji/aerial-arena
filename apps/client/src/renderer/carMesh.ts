import * as THREE from 'three';
import { CAR_CONFIG, Team, TransformSnapshot } from '@aerial-arena/shared';
import { CustomCarModel, instantiateCustomCar } from './customCarModel.js';
import { BOOST_GRADIENTS, CarLook, DEFAULT_LOOK, TEAM_BOOST } from './carLook.js';
import { createWheel, createWheelMaterials } from './wheel.js';

export interface CarVisualState {
  boosting: boolean;
  supersonic: boolean;
  steer: number;
  demoed: boolean;
  /** Per-wheel suspension length (FL, FR, BL, BR) when known (local sim); rest pose otherwise. */
  wheelLengths?: readonly number[];
}

export interface CarVisual {
  root: THREE.Group;
  team: Team;
  /** Neon boost gradient [core, mid, outer] used by the flame and exhaust particles. */
  boostColors: [THREE.Color, THREE.Color, THREE.Color];
  update(t: TransformSnapshot, state: CarVisualState, dt: number): void;
  /** World position of the boost nozzle. */
  nozzleWorld(out: THREE.Vector3): THREE.Vector3;
  /** World positions of the rear tire contact points (for supersonic streaks). */
  rearWheelsWorld(outL: THREE.Vector3, outR: THREE.Vector3): void;
  destroy(): void;
}

export const TEAM_PAINT: Record<Team, { primary: number; secondary: number; glow: number }> = {
  blue: { primary: 0x1d5cff, secondary: 0x7fd3ff, glow: 0x4aa8ff },
  orange: { primary: 0xff6a0f, secondary: 0xffd166, glow: 0xff9a3a },
};

const C = CAR_CONFIG;
const BODY_HALF = 0.31; // m, half width of the painted body (wheels sit outboard of it)

/**
 * Original compact "battle car" sized to the RL Octane hitbox (1.2 x 0.87 x 0.39 m).
 * Local frame: forward +Z, up +Y, left +X. The body origin sits restHeight above the floor.
 */
/** Builds the built-in car, or wraps a user-supplied model (see customCarModel.ts) when given. */
export function createCarMesh(team: Team, custom: CustomCarModel | null = null, look: CarLook = DEFAULT_LOOK): CarVisual {
  const root = new THREE.Group();
  const body = new THREE.Group(); // everything except wheels
  root.add(body);
  const disposables: { dispose(): void }[] = [];
  const track = <T extends { dispose(): void }>(d: T): T => {
    disposables.push(d);
    return d;
  };
  const paint = TEAM_PAINT[team];

  // Team primary stays the body color (readability); the finish changes how it reads.
  const finish = {
    gloss: { metalness: 0.35, roughness: 0.3, clearcoat: 1, clearcoatRoughness: 0.06, iridescence: 0 },
    matte: { metalness: 0.05, roughness: 0.78, clearcoat: 0, clearcoatRoughness: 1, iridescence: 0 },
    metallic: { metalness: 0.85, roughness: 0.24, clearcoat: 0.6, clearcoatRoughness: 0.1, iridescence: 0 },
    pearl: { metalness: 0.3, roughness: 0.2, clearcoat: 1, clearcoatRoughness: 0.05, iridescence: 0.7 },
  }[look.finish];
  const paintMat = track(new THREE.MeshPhysicalMaterial({ color: paint.primary, ...finish }));
  const accentMat = track(
    new THREE.MeshPhysicalMaterial({ color: look.accent, metalness: 0.3, roughness: 0.35, clearcoat: 0.6, emissive: look.accent, emissiveIntensity: 0.12 })
  );
  const boostHex = look.boost === 'team' ? TEAM_BOOST[team] : BOOST_GRADIENTS[look.boost];
  const boostColors = boostHex.map((h) => new THREE.Color(h)) as [THREE.Color, THREE.Color, THREE.Color];
  const trimMat = track(new THREE.MeshStandardMaterial({ color: 0x15171c, roughness: 0.55, metalness: 0.3 }));
  const glassMat = track(new THREE.MeshPhysicalMaterial({ color: 0x0a1424, metalness: 0.4, roughness: 0.05, clearcoat: 1 }));
  const headMat = track(new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xfff3c4, emissiveIntensity: 2.5 }));
  const tailMat = track(new THREE.MeshStandardMaterial({ color: 0xff2a2a, emissive: 0xff1a1a, emissiveIntensity: 2.2 }));
  const nozzleGlowMat = track(new THREE.MeshStandardMaterial({ color: 0x222222, emissive: paint.glow, emissiveIntensity: 0.4 }));

  const add = (geom: THREE.BufferGeometry, mat: THREE.Material, parent: THREE.Object3D = body, shadow = true) => {
    track(geom);
    const m = new THREE.Mesh(geom, mat);
    m.castShadow = shadow;
    m.receiveShadow = shadow;
    parent.add(m);
    return m;
  };

  /**
   * Extrude a side profile given as (z, y) pairs, centered across X with the given width.
   * `taper` narrows the shape toward the roof (tumblehome) and the nose.
   */
  const profile = (pts: [number, number][], width: number, bevel: number, taper = { top: 0.16, nose: 0.14 }) => {
    const shape = new THREE.Shape(pts.map(([z, y]) => new THREE.Vector2(z, y)));
    const g = new THREE.ExtrudeGeometry(shape, {
      depth: width - bevel * 2,
      bevelEnabled: true,
      bevelThickness: bevel,
      bevelSize: bevel,
      bevelSegments: 3,
      curveSegments: 6,
    });
    g.rotateY(-Math.PI / 2); // shape x -> car z, extrusion -> car -x
    g.translate((width - bevel * 2) / 2, 0, 0);
    const pos = g.attributes.position;
    const ss = (a: number, b: number, x: number) => {
      const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
      return t * t * (3 - 2 * t);
    };
    for (let i = 0; i < pos.count; i++) {
      const y = pos.getY(i);
      const z = pos.getZ(i);
      const k = 1 - taper.top * ss(0.04, 0.42, y) - taper.nose * ss(0.4, 0.8, z);
      pos.setX(i, pos.getX(i) * k);
    }
    g.computeVertexNormals();
    return g;
  };

  // Main body shell (low nose, rising rear deck)
  add(
    profile(
      [
        [-0.5, -0.07], [-0.54, 0.08], [-0.52, 0.23], [-0.33, 0.27], [0.3, 0.25], [0.56, 0.19],
        [0.74, 0.11], [0.78, 0.03], [0.73, -0.06], [0.55, -0.08], [-0.4, -0.08],
      ],
      BODY_HALF * 2,
      0.05
    ),
    paintMat
  );
  // Cabin glass + roof
  add(profile([[-0.34, 0.25], [-0.2, 0.41], [0.07, 0.43], [0.18, 0.41], [0.34, 0.24]], 0.54, 0.03, { top: 0.22, nose: 0 }), glassMat);
  add(profile([[-0.19, 0.405], [-0.16, 0.445], [0.07, 0.455], [0.12, 0.43]], 0.46, 0.02, { top: 0.12, nose: 0 }), paintMat);
  // Dark lower skirt for a two-tone silhouette
  add(profile([[-0.49, -0.075], [-0.52, 0.03], [0.74, 0.0], [0.72, -0.065], [0.55, -0.085], [-0.4, -0.085]], BODY_HALF * 2 + 0.012, 0.03, { top: 0, nose: 0.14 }), trimMat);
  // Side stripes
  for (const s of [-1, 1]) {
    if (look.decal === 'stripe') {
      const stripe = add(new THREE.BoxGeometry(0.012, 0.045, 0.95), accentMat);
      stripe.position.set(s * (BODY_HALF * 0.962 + 0.004), 0.13, 0.12);
    } else if (look.decal === 'racing') {
      // twin racing stripes over hood, roof and deck
      for (const [z0, z1, y, tilt] of [[0.3, 0.74, 0.215, -0.33], [-0.17, 0.08, 0.458, 0.02], [-0.5, -0.32, 0.252, 0.12]] as const) {
        const st = add(new THREE.BoxGeometry(0.05, 0.006, z1 - z0), accentMat);
        st.position.set(s * 0.06, y, (z0 + z1) / 2);
        st.rotation.x = tilt;
      }
    }
    const intake = add(new THREE.BoxGeometry(0.014, 0.08, 0.18), trimMat);
    intake.position.set(s * (BODY_HALF + 0.004), 0.05, -0.18);
  }
  // Hood vent + accent arrow
  const hood = add(new THREE.BoxGeometry(0.3, 0.012, 0.22), accentMat);
  hood.position.set(0, 0.24, 0.47);
  hood.rotation.x = -0.25;
  // Front splitter + rear diffuser
  add(new THREE.BoxGeometry(0.66, 0.04, 0.16), trimMat).position.set(0, -0.07, 0.68);
  add(new THREE.BoxGeometry(0.58, 0.08, 0.1), trimMat).position.set(0, -0.03, -0.5);
  // Lights
  for (const s of [-1, 1]) {
    add(new THREE.BoxGeometry(0.14, 0.035, 0.02), headMat, body, false).position.set(s * 0.21, 0.1, 0.765);
    add(new THREE.BoxGeometry(0.16, 0.04, 0.02), tailMat, body, false).position.set(s * 0.23, 0.17, -0.545);
  }
  // Rear wing
  const wing = add(new THREE.BoxGeometry(0.78, 0.025, 0.17), accentMat);
  wing.position.set(0, 0.37, -0.44);
  wing.rotation.x = 0.12;
  for (const s of [-1, 1]) {
    const strut = add(new THREE.BoxGeometry(0.03, 0.12, 0.06), trimMat);
    strut.position.set(s * 0.25, 0.3, -0.45);
    const plate = add(new THREE.BoxGeometry(0.02, 0.1, 0.2), paintMat);
    plate.position.set(s * 0.39, 0.37, -0.44);
  }
  // Booster nozzle
  const nozzle = add(new THREE.CylinderGeometry(0.075, 0.09, 0.08, 20, 1, true), trimMat);
  nozzle.rotation.x = Math.PI / 2;
  nozzle.position.set(0, 0.07, -0.56);
  const nozzleCore = add(new THREE.CircleGeometry(0.07, 20), nozzleGlowMat, body, false);
  nozzleCore.position.set(0, 0.07, -0.545);
  nozzleCore.rotation.y = Math.PI;

  // Wheels at the physics suspension hard points
  interface WheelVis { pivot: THREE.Group; spin: THREE.Group; radius: number; hardY: number; front: boolean }
  const wheels: WheelVis[] = [];
  const wheelMats = createWheelMaterials(look.rimColor, accentMat, look.tire);
  disposables.push(wheelMats);
  const wheelDefs = [
    { def: C.frontWheels, side: 1, front: true },
    { def: C.frontWheels, side: -1, front: true },
    { def: C.backWheels, side: 1, front: false },
    { def: C.backWheels, side: -1, front: false },
  ];
  for (const { def, side, front } of wheelDefs) {
    const pivot = new THREE.Group();
    const spin = new THREE.Group();
    pivot.add(spin);
    const width = front ? 0.15 : 0.17;
    const wheelX = side * (BODY_HALF + width / 2 - 0.02);
    const parts = createWheel(def.radius, width, side, look.rimStyle, wheelMats);
    disposables.push(parts);
    spin.add(parts.spin);
    pivot.add(parts.fixed);
    pivot.position.set(wheelX, 0, def.forward);
    root.add(pivot);
    // Fender arch over the top half of each wheel (theta 0..PI maps to +Y after the Z rotation)
    const arch = add(new THREE.CylinderGeometry(def.radius + 0.045, def.radius + 0.045, width + 0.03, 20, 1, true, 0, Math.PI), paintMat);
    arch.rotation.z = Math.PI / 2;
    arch.position.set(wheelX, -C.restHeight + def.radius + 0.01, def.forward);
    wheels.push({ pivot, spin, radius: def.radius, hardY: def.up, front });
  }

  // Boost flame: neon gradient plumes (white-hot core -> mid -> outer color), flickering.
  const flame = new THREE.Group();
  flame.position.set(0, 0.07, -0.58);
  const plume = (radius: number, length: number, intensity: number) => {
    const geom = track(new THREE.ConeGeometry(radius, length, 24, 8, true));
    const mat = track(createFlameMaterial(boostColors, length / 2, intensity));
    const m = new THREE.Mesh(geom, mat);
    m.rotation.x = -Math.PI / 2;
    m.position.z = -length / 2;
    flame.add(m);
    return mat;
  };
  const flameMats = [plume(0.1, 0.95, 0.9), plume(0.055, 0.5, 1.3)];
  flame.visible = false;
  body.add(flame);

  // User-supplied model replaces the built-in body and wheels (flame stays).
  const nozzleLocal = new THREE.Vector3(0, 0.07, -0.6);
  const customInst = custom ? instantiateCustomCar(custom, team) : null;
  if (customInst) {
    for (const child of [...body.children]) if (child !== flame) body.remove(child);
    for (const w of wheels) root.remove(w.pivot);
    wheels.length = 0;
    body.add(customInst.object);
    nozzleLocal.copy(customInst.nozzle).add(new THREE.Vector3(0, 0, -0.02));
    flame.position.copy(nozzleLocal);
    disposables.push({ dispose: customInst.dispose });
  }
  const qSpin = new THREE.Quaternion();
  const qSteer = new THREE.Quaternion();
  const AXIS_X = new THREE.Vector3(1, 0, 0);
  const AXIS_Y = new THREE.Vector3(0, 1, 0);

  let spinAngle = 0;
  let steerVis = 0;

  const update = (t: TransformSnapshot, s: CarVisualState, dt: number) => {
    root.visible = !s.demoed;
    if (s.demoed) return;
    root.position.set(t.x, t.y, t.z);
    root.quaternion.set(t.qx, t.qy, t.qz, t.qw);

    // Forward speed in the car frame
    const q = root.quaternion;
    const fx = 2 * (q.x * q.z + q.w * q.y);
    const fy = 2 * (q.y * q.z - q.w * q.x);
    const fz = 1 - 2 * (q.x * q.x + q.y * q.y);
    const vFwd = t.vx * fx + t.vy * fy + t.vz * fz;
    spinAngle += (vFwd / 0.14) * dt;
    steerVis += (s.steer * 0.45 - steerVis) * Math.min(1, dt * 14);

    const restLen = C.restHeight + C.frontWheels.up;
    wheels.forEach((w, i) => {
      const len = s.wheelLengths?.[i] ?? restLen;
      w.pivot.position.y = w.hardY - Math.min(len, restLen + 0.03) + w.radius;
      w.spin.rotation.x = spinAngle;
      w.pivot.rotation.y = w.front ? -steerVis : 0;
    });
    if (customInst) {
      qSpin.setFromAxisAngle(AXIS_X, spinAngle);
      for (const w of customInst.wheels) {
        qSteer.setFromAxisAngle(AXIS_Y, w.front ? -steerVis : 0);
        w.node.quaternion.copy(w.base).multiply(qSteer).multiply(qSpin);
      }
    }

    flame.visible = s.boosting;
    nozzleGlowMat.emissiveIntensity = s.boosting ? 4 : 0.4;
    for (const fm of flameMats) fm.uniforms.uTime.value += dt;
    if (s.boosting) {
      const f = 0.85 + Math.random() * 0.35;
      flame.scale.set(1, 1, f * (s.supersonic ? 1.35 : 1));
    }
  };

  const nozzleWorld = (out: THREE.Vector3) => out.copy(nozzleLocal).applyMatrix4(root.matrixWorld);
  const rearX = BODY_HALF + 0.17 / 2 - 0.02;
  const rearL = new THREE.Vector3(rearX, -C.restHeight + 0.02, C.backWheels.forward);
  const rearR = new THREE.Vector3(-rearX, -C.restHeight + 0.02, C.backWheels.forward);
  const rearWheelsWorld = (outL: THREE.Vector3, outR: THREE.Vector3) => {
    outL.copy(rearL).applyMatrix4(root.matrixWorld);
    outR.copy(rearR).applyMatrix4(root.matrixWorld);
  };

  nozzleGlowMat.emissive.copy(boostColors[1]);
  return {
    root,
    team,
    boostColors,
    update,
    nozzleWorld,
    rearWheelsWorld,
    destroy: () => disposables.forEach((d) => d.dispose()),
  };
}

function createFlameMaterial(colors: [THREE.Color, THREE.Color, THREE.Color], half: number, intensity: number): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    uniforms: {
      uCore: { value: colors[0] }, uMid: { value: colors[1] }, uOuter: { value: colors[2] },
      uTime: { value: 0 }, uHalf: { value: half }, uIntensity: { value: intensity },
    },
    vertexShader: /* glsl */ `
      uniform float uHalf; varying float vT; varying vec3 vN; varying vec3 vView;
      void main() {
        vT = 0.5 + position.y / (2.0 * uHalf); // 0 at the nozzle (cone base), 1 at the tip
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vN = normalize(mat3(modelMatrix) * normal);
        vView = cameraPosition - wp.xyz;
        gl_Position = projectionMatrix * viewMatrix * wp;
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uCore; uniform vec3 uMid; uniform vec3 uOuter; uniform float uTime; uniform float uIntensity;
      varying float vT; varying vec3 vN; varying vec3 vView;
      void main() {
        float t = clamp(vT, 0.0, 1.0);
        vec3 c = t < 0.3 ? mix(uCore, uMid, t / 0.3) : mix(uMid, uOuter, (t - 0.3) / 0.7);
        float flick = 0.7 + 0.3 * sin(t * 34.0 - uTime * 48.0) * sin(t * 13.0 + uTime * 21.0);
        float facing = pow(abs(dot(normalize(vN), normalize(vView))), 1.4);
        float a = pow(1.0 - t, 1.3) * facing * flick * uIntensity;
        gl_FragColor = vec4(c * a * 2.2, a);
      }`,
  });
}
