import * as THREE from 'three';
import { BOOST_PADS, BoostPadSnapshot } from '@aerial-arena/shared';

/**
 * Neon boost pads (visual only; pickup logic lives in game-core).
 *  - Big pads: octagonal machined base, four neon-edged claw arms, glowing core well with
 *    flame petals, animated light beam, plasma orb and a cooldown ring.
 *  - Small pads: instanced hex base, neon ring, glowing core, short beam and cooldown ring.
 */
export interface PadVisuals {
  root: THREE.Group;
  update(snapshots: BoostPadSnapshot[] | null, dt: number): void;
  destroy(): void;
}

/** Visual scale of the pad props (pickup radii are unchanged and live in game-core). */
const BIG_SCALE = 0.6;
const SMALL_SCALE = 0.72;
const NEON = new THREE.Color(1.0, 0.45, 0.05);
const HOT = new THREE.Color(1.0, 0.82, 0.25);

export function createBoostPadVisuals(): PadVisuals {
  const root = new THREE.Group();
  const disposables: { dispose(): void }[] = [];
  const track = <T extends { dispose(): void }>(d: T): T => {
    disposables.push(d);
    return d;
  };

  // ------------------------------------------------------------- materials
  const plate = track(createTechPlateTexture());
  const metalMat = track(
    new THREE.MeshStandardMaterial({ color: 0x3a404c, map: plate, bumpMap: plate, bumpScale: 2.5, metalness: 0.85, roughness: 0.38 })
  );
  const darkMetal = track(new THREE.MeshStandardMaterial({ color: 0x1a1d24, metalness: 0.9, roughness: 0.3 }));
  const neonMat = track(new THREE.MeshStandardMaterial({ color: 0x331100, emissive: NEON, emissiveIntensity: 2.0 }));
  const neonDim = track(new THREE.MeshStandardMaterial({ color: 0x1a0d05, emissive: NEON, emissiveIntensity: 0.25 }));
  const coreTex = track(createCoreTexture());
  const coreOn = track(new THREE.MeshStandardMaterial({ color: 0x000000, emissive: 0xffffff, emissiveMap: coreTex, emissiveIntensity: 1.5 }));
  const coreOff = track(new THREE.MeshStandardMaterial({ color: 0x15100a, emissive: 0xffffff, emissiveMap: coreTex, emissiveIntensity: 0.12 }));
  const petalMat = track(
    new THREE.MeshStandardMaterial({ color: 0x000000, emissive: HOT, emissiveIntensity: 1.8, transparent: true, opacity: 0.85, side: THREE.DoubleSide })
  );
  const beamMat = track(createBeamMaterial());
  const orbMat = track(createPlasmaMaterial());
  const ringMat = track(createCooldownRingMaterial());
  const decalTex = track(createGlowDecalTexture());
  const decalMat = track(
    new THREE.MeshBasicMaterial({ map: decalTex, color: NEON, transparent: true, opacity: 0.28, blending: THREE.AdditiveBlending, depthWrite: false })
  );
  const haloTex = track(createHaloTexture());
  const haloMat = track(new THREE.SpriteMaterial({ map: haloTex, color: 0xffa040, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));

  const bigDefs = BOOST_PADS.filter((p) => p.type === 'big');
  const smallDefs = BOOST_PADS.filter((p) => p.type === 'small');

  // ------------------------------------------------------------- big pads
  interface Big {
    id: number;
    group: THREE.Group;
    orb: THREE.Mesh;
    halo: THREE.Sprite;
    beam: THREE.Mesh;
    core: THREE.Mesh;
    rim: THREE.Mesh;
    edges: THREE.Mesh[];
    petals: THREE.Group;
    phase: number;
    active: boolean;
  }
  const bigBase = track(new THREE.CylinderGeometry(1.45, 1.62, 0.12, 8));
  const bigWell = track(new THREE.CylinderGeometry(0.9, 0.9, 0.03, 40));
  const bigRim = track(new THREE.TorusGeometry(1.32, 0.05, 8, 64));
  bigRim.rotateX(Math.PI / 2);
  const armGeom = track(createArmGeometry());
  const edgeGeom = track(new THREE.BoxGeometry(0.035, 0.035, 0.95));
  const petalGeom = track(createPetalGeometry());
  const bigBeam = track(new THREE.CylinderGeometry(0.42, 0.62, 2.6, 32, 1, true));
  bigBeam.translate(0, 1.3, 0);
  const orbGeom = track(new THREE.SphereGeometry(0.55, 48, 32));
  const decalGeom = track(new THREE.PlaneGeometry(1, 1));
  decalGeom.rotateX(-Math.PI / 2);
  const bigs: Big[] = [];
  for (const def of bigDefs) {
    const g = new THREE.Group();
    g.position.set(def.x, 0, def.z);
    g.scale.setScalar(BIG_SCALE);
    g.rotation.y = Math.PI / 8;
    const base = new THREE.Mesh(bigBase, metalMat);
    base.position.y = 0.06;
    base.receiveShadow = base.castShadow = true;
    const well = new THREE.Mesh(bigWell, coreOn);
    well.position.y = 0.13;
    const rim = new THREE.Mesh(bigRim, neonMat);
    rim.position.y = 0.13;
    const edges: THREE.Mesh[] = [];
    for (let k = 0; k < 4; k++) {
      const a = (k / 4) * Math.PI * 2 + Math.PI / 4;
      const arm = new THREE.Mesh(armGeom, darkMetal);
      arm.position.set(Math.sin(a) * 1.55, 0, Math.cos(a) * 1.55);
      arm.rotation.y = a;
      arm.castShadow = arm.receiveShadow = true;
      g.add(arm);
      for (const side of [-1, 1]) {
        const edge = new THREE.Mesh(edgeGeom, neonMat);
        edge.position.set(Math.sin(a) * 1.6 + Math.cos(a) * side * 0.19, 0.2, Math.cos(a) * 1.6 - Math.sin(a) * side * 0.19);
        edge.rotation.y = a;
        edge.rotation.x = -0.18;
        g.add(edge);
        edges.push(edge);
      }
    }
    const petals = new THREE.Group();
    for (let k = 0; k < 6; k++) {
      const p = new THREE.Mesh(petalGeom, petalMat);
      const a = (k / 6) * Math.PI * 2;
      p.position.set(Math.sin(a) * 0.62, 0.14, Math.cos(a) * 0.62);
      p.rotation.y = a;
      petals.add(p);
    }
    const beam = new THREE.Mesh(bigBeam, beamMat);
    beam.position.y = 0.12;
    const orb = new THREE.Mesh(orbGeom, orbMat);
    orb.position.y = 1.55;
    const halo = new THREE.Sprite(haloMat);
    halo.scale.set(3.4, 3.4, 1);
    halo.position.y = 1.55;
    const decal = new THREE.Mesh(decalGeom, decalMat);
    decal.scale.set(6, 1, 6);
    decal.position.y = 0.015;
    g.add(base, well, rim, petals, beam, orb, halo, decal);
    root.add(g);
    bigs.push({ id: def.id, group: g, orb, halo, beam, core: well, rim, edges, petals, phase: Math.random() * 6, active: true });
  }

  // ------------------------------------------------------------- small pads (instanced)
  const n = smallDefs.length;
  const inst = (geom: THREE.BufferGeometry, mat: THREE.Material, shadow = false) => {
    geom.scale(SMALL_SCALE, SMALL_SCALE, SMALL_SCALE);
    const m = new THREE.InstancedMesh(track(geom), mat, n);
    m.receiveShadow = shadow;
    m.frustumCulled = false;
    root.add(m);
    return m;
  };
  const smallBase = inst(new THREE.CylinderGeometry(0.8, 0.88, 0.07, 6), metalMat, true);
  const smallRing = inst(new THREE.TorusGeometry(0.6, 0.035, 8, 48).rotateX(Math.PI / 2), neonMat);
  const smallRingOff = inst(new THREE.TorusGeometry(0.6, 0.035, 8, 48).rotateX(Math.PI / 2), neonDim);
  const smallCoreOn = inst(new THREE.CylinderGeometry(0.44, 0.44, 0.03, 32), coreOn);
  const smallCoreOff = inst(new THREE.CylinderGeometry(0.44, 0.44, 0.03, 32), coreOff);
  const smallBeam = inst(new THREE.CylinderGeometry(0.2, 0.42, 0.7, 24, 1, true).translate(0, 0.35, 0), beamMat);
  const smallDecal = inst(decalGeom.clone(), decalMat);
  // Cooldown rings for all pads share one instanced mesh with a per-instance progress attribute.
  const ringGeom = track(new THREE.RingGeometry(0.0, 1.0, 64, 1));
  ringGeom.rotateX(-Math.PI / 2);
  const allRings = new THREE.InstancedMesh(ringGeom, ringMat, BOOST_PADS.length);
  allRings.frustumCulled = false;
  const progressAttr = new THREE.InstancedBufferAttribute(new Float32Array(BOOST_PADS.length).fill(1), 1);
  ringGeom.setAttribute('aProgress', progressAttr);
  root.add(allRings);

  const m4 = new THREE.Matrix4();
  const hidden = new THREE.Matrix4().makeScale(0, 0, 0);
  const place = (mesh: THREE.InstancedMesh, i: number, x: number, y: number, z: number, s = 1, sy = 1) =>
    mesh.setMatrixAt(i, m4.compose(new THREE.Vector3(x, y, z), new THREE.Quaternion(), new THREE.Vector3(s, sy, s)));
  const smallIndex = new Map<number, number>();
  smallDefs.forEach((d, i) => {
    smallIndex.set(d.id, i);
    place(smallBase, i, d.x, 0.035 * SMALL_SCALE, d.z);
    place(smallRing, i, d.x, 0.075 * SMALL_SCALE, d.z);
    smallRingOff.setMatrixAt(i, hidden);
    place(smallCoreOn, i, d.x, 0.075 * SMALL_SCALE, d.z);
    smallCoreOff.setMatrixAt(i, hidden);
    place(smallBeam, i, d.x, 0.07 * SMALL_SCALE, d.z);
    place(smallDecal, i, d.x, 0.012 * SMALL_SCALE, d.z, 2.6);
  });
  const ringIndex = new Map<number, number>();
  BOOST_PADS.forEach((d, i) => {
    ringIndex.set(d.id, i);
    const r = d.type === 'big' ? 1.12 * BIG_SCALE : 0.74 * SMALL_SCALE;
    place(allRings, i, d.x, d.type === 'big' ? 0.135 * BIG_SCALE : 0.08 * SMALL_SCALE, d.z, r);
  });
  const smallActive = new Array(n).fill(true);

  // ------------------------------------------------------------- behaviour
  let time = 0;
  const update = (snaps: BoostPadSnapshot[] | null, dt: number) => {
    time += dt;
    beamMat.uniforms.uTime.value = time;
    orbMat.uniforms.uTime.value = time;
    ringMat.uniforms.uTime.value = time;
    neonMat.emissiveIntensity = 2.0 + Math.sin(time * 3.2) * 0.4;

    let dirty = false;
    if (snaps) {
      for (const s of snaps) {
        const def = BOOST_PADS[s.id];
        if (!def) continue;
        const ri = ringIndex.get(s.id)!;
        const prog = s.active ? 1 : 1 - s.cooldownRemaining / def.cooldownSec;
        if (Math.abs(progressAttr.array[ri] - prog) > 1e-3) {
          progressAttr.array[ri] = prog;
          progressAttr.needsUpdate = true;
        }
        if (def.type === 'big') {
          const b = bigs.find((x) => x.id === s.id)!;
          if (b.active !== s.active) {
            b.active = s.active;
            b.orb.visible = b.halo.visible = b.beam.visible = b.petals.visible = s.active;
            b.core.material = s.active ? coreOn : coreOff;
            b.rim.material = s.active ? neonMat : neonDim;
            for (const e of b.edges) e.material = s.active ? neonMat : neonDim;
          }
        } else {
          const i = smallIndex.get(s.id)!;
          if (smallActive[i] !== s.active) {
            smallActive[i] = s.active;
            dirty = true;
            if (s.active) {
              place(smallCoreOn, i, def.x, 0.075 * SMALL_SCALE, def.z);
              smallCoreOff.setMatrixAt(i, hidden);
              place(smallRing, i, def.x, 0.075 * SMALL_SCALE, def.z);
              smallRingOff.setMatrixAt(i, hidden);
              place(smallBeam, i, def.x, 0.07 * SMALL_SCALE, def.z);
              place(smallDecal, i, def.x, 0.012 * SMALL_SCALE, def.z, 2.6);
            } else {
              smallCoreOn.setMatrixAt(i, hidden);
              place(smallCoreOff, i, def.x, 0.075 * SMALL_SCALE, def.z);
              smallRing.setMatrixAt(i, hidden);
              place(smallRingOff, i, def.x, 0.075 * SMALL_SCALE, def.z);
              smallBeam.setMatrixAt(i, hidden);
              smallDecal.setMatrixAt(i, hidden);
            }
          }
        }
      }
    }
    if (dirty) {
      for (const m of [smallCoreOn, smallCoreOff, smallRing, smallRingOff, smallBeam, smallDecal]) m.instanceMatrix.needsUpdate = true;
    }
    for (const b of bigs) {
      if (!b.active) continue;
      const y = 1.55 + Math.sin(time * 2.0 + b.phase) * 0.12;
      b.orb.position.y = b.halo.position.y = y;
      b.orb.rotation.y += dt * 0.8;
      b.petals.rotation.y += dt * 0.6;
      const pulse = 1 + Math.sin(time * 5 + b.phase) * 0.06;
      b.halo.scale.set(3.4 * pulse, 3.4 * pulse, 1);
    }
  };

  return { root, update, destroy: () => disposables.forEach((d) => d.dispose()) };
}

// ===========================================================================
// geometry helpers
// ===========================================================================

/** Wedge-shaped claw arm: low at the outer end, rising toward the pad. */
function createArmGeometry(): THREE.BufferGeometry {
  const shape = new THREE.Shape();
  shape.moveTo(-0.5, 0);
  shape.lineTo(0.5, 0);
  shape.lineTo(0.42, 0.08);
  shape.lineTo(-0.38, 0.24);
  shape.lineTo(-0.5, 0.2);
  shape.closePath();
  const g = new THREE.ExtrudeGeometry(shape, { depth: 0.42, bevelEnabled: true, bevelSize: 0.02, bevelThickness: 0.02, bevelSegments: 2 });
  g.translate(0, 0, -0.21);
  g.rotateY(-Math.PI / 2); // shape x -> +z: the high (x = -0.5) end points toward the pad center
  g.computeVertexNormals();
  return g;
}

/** Curved flame petal leaning outward from the core. */
function createPetalGeometry(): THREE.BufferGeometry {
  const shape = new THREE.Shape();
  shape.moveTo(-0.11, 0);
  shape.quadraticCurveTo(-0.16, 0.25, -0.02, 0.5);
  shape.quadraticCurveTo(0.12, 0.28, 0.11, 0);
  shape.closePath();
  const g = new THREE.ShapeGeometry(shape, 8);
  g.rotateX(0.45); // lean outward (+z is radially outward once placed)
  return g;
}

// ===========================================================================
// procedural textures
// ===========================================================================

function createTechPlateTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const ctx = c.getContext('2d')!;
  const g = ctx.createRadialGradient(128, 128, 10, 128, 128, 128);
  g.addColorStop(0, '#9aa3b2');
  g.addColorStop(1, '#5d6574');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 256, 256);
  // brushed noise
  for (let i = 0; i < 4000; i++) {
    ctx.fillStyle = `rgba(${Math.random() < 0.5 ? '255,255,255' : '0,0,0'},0.05)`;
    ctx.fillRect(Math.random() * 256, Math.random() * 256, 1 + Math.random() * 6, 1);
  }
  // concentric grooves
  ctx.lineWidth = 3;
  ctx.strokeStyle = 'rgba(15,18,24,0.9)';
  for (const r of [40, 78, 112]) {
    ctx.beginPath();
    ctx.arc(128, 128, r, 0, Math.PI * 2);
    ctx.stroke();
  }
  // radial panel seams
  for (let k = 0; k < 8; k++) {
    const a = (k / 8) * Math.PI * 2 + Math.PI / 8;
    ctx.beginPath();
    ctx.moveTo(128 + Math.cos(a) * 40, 128 + Math.sin(a) * 40);
    ctx.lineTo(128 + Math.cos(a) * 128, 128 + Math.sin(a) * 128);
    ctx.stroke();
    // bolts
    for (const r of [60, 96]) {
      const x = 128 + Math.cos(a + 0.2) * r;
      const y = 128 + Math.sin(a + 0.2) * r;
      ctx.fillStyle = '#c9d1dc';
      ctx.beginPath();
      ctx.arc(x, y, 3.2, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#20242c';
      ctx.fillRect(x - 2, y - 0.5, 4, 1);
    }
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

function createCoreTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const ctx = c.getContext('2d')!;
  const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
  g.addColorStop(0, '#fff6d0');
  g.addColorStop(0.35, '#ffd23a');
  g.addColorStop(0.75, '#ff7a00');
  g.addColorStop(1, '#a02800');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 128, 128);
  ctx.strokeStyle = 'rgba(120,30,0,0.6)';
  ctx.lineWidth = 2;
  for (const r of [22, 38, 52]) {
    ctx.beginPath();
    ctx.arc(64, 64, r, 0, Math.PI * 2);
    ctx.stroke();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function createGlowDecalTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const ctx = c.getContext('2d')!;
  const g = ctx.createRadialGradient(64, 64, 8, 64, 64, 64);
  g.addColorStop(0, 'rgba(255,255,255,0.9)');
  g.addColorStop(0.4, 'rgba(255,255,255,0.35)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 128, 128);
  return new THREE.CanvasTexture(c);
}

function createHaloTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const ctx = c.getContext('2d')!;
  const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
  g.addColorStop(0, 'rgba(255,255,255,0.8)');
  g.addColorStop(0.25, 'rgba(255,255,255,0.3)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 128, 128);
  return new THREE.CanvasTexture(c);
}

// ===========================================================================
// shaders
// ===========================================================================

function createBeamMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    uniforms: { uTime: { value: 0 }, uColor: { value: new THREE.Color(1.0, 0.55, 0.12) } },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        vec4 p = vec4(position, 1.0);
        #ifdef USE_INSTANCING
          p = instanceMatrix * p;
        #endif
        gl_Position = projectionMatrix * modelViewMatrix * p;
      }`,
    fragmentShader: /* glsl */ `
      uniform float uTime; uniform vec3 uColor; varying vec2 vUv;
      void main() {
        float fade = pow(1.0 - vUv.y, 1.8);
        float bands = 0.55 + 0.45 * sin(vUv.y * 26.0 - uTime * 7.0);
        float edge = 0.6 + 0.4 * sin(vUv.x * 6.2832 * 6.0 + uTime * 2.0);
        float a = fade * bands * edge * 0.4;
        gl_FragColor = vec4(uColor * a * 1.6, a);
      }`,
  });
}

/** Swirling plasma orb: fbm noise flowing upward, white-hot core, bright fresnel rim. */
function createPlasmaMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 } },
    vertexShader: /* glsl */ `
      varying vec3 vLocal; varying vec3 vN; varying vec3 vView;
      void main() {
        vLocal = position;
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vN = normalize(mat3(modelMatrix) * normal);
        vView = cameraPosition - wp.xyz;
        gl_Position = projectionMatrix * viewMatrix * wp;
      }`,
    fragmentShader: /* glsl */ `
      uniform float uTime; varying vec3 vLocal; varying vec3 vN; varying vec3 vView;
      float hash(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
      float noise(vec3 x) {
        vec3 i = floor(x); vec3 f = fract(x); f = f * f * (3.0 - 2.0 * f);
        return mix(mix(mix(hash(i), hash(i + vec3(1,0,0)), f.x), mix(hash(i + vec3(0,1,0)), hash(i + vec3(1,1,0)), f.x), f.y),
                   mix(mix(hash(i + vec3(0,0,1)), hash(i + vec3(1,0,1)), f.x), mix(hash(i + vec3(0,1,1)), hash(i + vec3(1,1,1)), f.x), f.y), f.z);
      }
      float fbm(vec3 p) { float v = 0.0; float a = 0.5; for (int i = 0; i < 5; i++) { v += a * noise(p); p *= 2.03; a *= 0.5; } return v; }
      void main() {
        vec3 p = vLocal * 3.2 + vec3(0.0, -uTime * 1.3, 0.0);
        float n = fbm(p + 1.5 * fbm(p + vec3(uTime * 0.35)));
        float fres = pow(1.0 - max(dot(normalize(vN), normalize(vView)), 0.0), 2.2);
        vec3 c = mix(vec3(0.9, 0.18, 0.0), vec3(1.0, 0.62, 0.05), smoothstep(0.3, 0.6, n));
        c = mix(c, vec3(1.0, 0.95, 0.75), smoothstep(0.62, 0.85, n));
        c *= 0.95 + fres * 1.8;
        gl_FragColor = vec4(c, 1.0);
      }`,
  });
}

/** Ring that fills clockwise as the pad recharges (per-instance aProgress, 1 = ready). */
function createCooldownRingMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    uniforms: { uTime: { value: 0 } },
    vertexShader: /* glsl */ `
      attribute float aProgress;
      varying vec2 vXZ; varying float vProgress;
      void main() {
        vXZ = position.xz; vProgress = aProgress;
        vec4 p = vec4(position, 1.0);
        #ifdef USE_INSTANCING
          p = instanceMatrix * p;
        #endif
        gl_Position = projectionMatrix * modelViewMatrix * p;
      }`,
    fragmentShader: /* glsl */ `
      uniform float uTime; varying vec2 vXZ; varying float vProgress;
      void main() {
        float r = length(vXZ);
        float band = smoothstep(0.84, 0.88, r) * (1.0 - smoothstep(0.96, 1.0, r));
        float a = atan(vXZ.x, -vXZ.y) / 6.2831853 + 0.5;
        float lit = step(a, vProgress);
        float ready = step(0.999, vProgress);
        vec3 col = mix(vec3(0.25, 0.08, 0.0), vec3(1.0, 0.55, 0.08), lit);
        float alpha = band * mix(0.25, 1.0, lit) * mix(1.0, 0.55 + 0.25 * sin(uTime * 4.0), ready);
        gl_FragColor = vec4(col * alpha * 1.3, alpha);
      }`,
  });
}
