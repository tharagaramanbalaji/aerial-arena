import * as THREE from 'three';

interface BurstOptions {
  count: number;
  color: THREE.ColorRepresentation;
  speed: number; // m/s
  size: [number, number]; // start/end size in meters
  life: [number, number]; // min/max seconds
  gravity?: number; // m/s^2 (negative pulls down)
  drag?: number; // 1/s
  spread?: THREE.Vector3; // optional bias direction
}

/**
 * Pooled additive particle system (single draw call) plus expanding shockwave rings.
 * Purely cosmetic; never touches the simulation.
 */
export class EffectsSystem {
  public readonly root = new THREE.Group();
  private readonly max: number;
  private readonly pos: Float32Array;
  private readonly vel: Float32Array;
  private readonly col: Float32Array;
  private readonly col0: Float32Array; // color at birth
  private readonly col1: Float32Array; // color at death (gradient over life)
  private readonly size: Float32Array;
  private readonly alpha: Float32Array;
  private readonly life: Float32Array;
  private readonly maxLife: Float32Array;
  private readonly size0: Float32Array;
  private readonly size1: Float32Array;
  private readonly gravity: Float32Array;
  private readonly drag: Float32Array;
  private cursor = 0;
  private readonly geom = new THREE.BufferGeometry();
  private readonly mat: THREE.ShaderMaterial;
  private readonly rings: { mesh: THREE.Mesh; t: number; dur: number; maxScale: number }[] = [];
  private readonly ringGeom = new THREE.RingGeometry(0.85, 1, 64);
  private readonly tmpColor = new THREE.Color();

  constructor(max = 4000) {
    this.max = max;
    this.pos = new Float32Array(max * 3);
    this.vel = new Float32Array(max * 3);
    this.col = new Float32Array(max * 3);
    this.col0 = new Float32Array(max * 3);
    this.col1 = new Float32Array(max * 3);
    this.size = new Float32Array(max);
    this.alpha = new Float32Array(max);
    this.life = new Float32Array(max);
    this.maxLife = new Float32Array(max);
    this.size0 = new Float32Array(max);
    this.size1 = new Float32Array(max);
    this.gravity = new Float32Array(max);
    this.drag = new Float32Array(max);
    this.geom.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    this.geom.setAttribute('aColor', new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage));
    this.geom.setAttribute('aSize', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    this.geom.setAttribute('aAlpha', new THREE.BufferAttribute(this.alpha, 1).setUsage(THREE.DynamicDrawUsage));
    this.geom.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e4);
    this.mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: { uScale: { value: 600 } },
      vertexShader: /* glsl */ `
        attribute vec3 aColor; attribute float aSize; attribute float aAlpha;
        uniform float uScale;
        varying vec3 vColor; varying float vAlpha;
        void main() {
          vColor = aColor; vAlpha = aAlpha;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = aAlpha > 0.0 ? aSize * uScale / max(0.1, -mv.z) : 0.0;
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: /* glsl */ `
        varying vec3 vColor; varying float vAlpha;
        void main() {
          float d = length(gl_PointCoord - 0.5) * 2.0;
          float a = smoothstep(1.0, 0.0, d);
          gl_FragColor = vec4(vColor * a * vAlpha, 1.0);
        }`,
    });
    const points = new THREE.Points(this.geom, this.mat);
    points.frustumCulled = false;
    points.renderOrder = 5;
    this.root.add(points);
  }

  /** Viewport height in pixels and vertical FOV control on-screen particle size. */
  setViewport(heightPx: number, fovYDeg: number): void {
    this.mat.uniforms.uScale.value = heightPx / (2 * Math.tan(THREE.MathUtils.degToRad(fovYDeg) / 2));
  }

  private spawn(p: THREE.Vector3, v: THREE.Vector3, color: THREE.Color, size0: number, size1: number, life: number, gravity: number, drag: number, endColor: THREE.Color = color) {
    const i = this.cursor;
    this.cursor = (this.cursor + 1) % this.max;
    this.pos.set([p.x, p.y, p.z], i * 3);
    this.vel.set([v.x, v.y, v.z], i * 3);
    this.col.set([color.r, color.g, color.b], i * 3);
    this.col0.set([color.r, color.g, color.b], i * 3);
    this.col1.set([endColor.r, endColor.g, endColor.b], i * 3);
    this.life[i] = life;
    this.maxLife[i] = life;
    this.size0[i] = size0;
    this.size1[i] = size1;
    this.gravity[i] = gravity;
    this.drag[i] = drag;
    this.alpha[i] = 1;
    this.size[i] = size0;
  }

  private readonly v = new THREE.Vector3();

  /** Boost exhaust: called every frame while a car boosts. */
  /** Neon boost exhaust: particles fade along the gradient [core, mid, outer] over their life. */
  emitBoost(nozzle: THREE.Vector3, carVel: THREE.Vector3, backward: THREE.Vector3, colors: [THREE.Color, THREE.Color, THREE.Color], dt: number) {
    const n = Math.max(1, Math.round(dt * 260));
    for (let k = 0; k < n; k++) {
      this.v.copy(backward).multiplyScalar(4 + Math.random() * 3).add(carVel).addScaledVector(randomUnit(), 0.8);
      const hot = Math.random() < 0.3;
      const start = hot ? colors[0] : colors[1];
      this.spawn(nozzle, this.v, start, hot ? 0.15 : 0.26, 0.03, 0.2 + Math.random() * 0.25, 1.5, 3, colors[2]);
    }
  }

  /** Supersonic streaks from the rear wheels. */
  emitStreak(p: THREE.Vector3, carVel: THREE.Vector3, dt: number) {
    const n = Math.max(1, Math.round(dt * 90));
    for (let k = 0; k < n; k++) {
      this.v.copy(carVel).multiplyScalar(0.6);
      this.spawn(p, this.v, new THREE.Color(0.85, 0.92, 1), 0.07, 0.01, 0.35, 0, 1);
    }
  }

  burst(p: THREE.Vector3, o: BurstOptions) {
    const c = new THREE.Color(o.color);
    for (let k = 0; k < o.count; k++) {
      this.v.copy(randomUnit()).multiplyScalar(o.speed * (0.35 + Math.random() * 0.65));
      if (o.spread) this.v.add(o.spread);
      const life = o.life[0] + Math.random() * (o.life[1] - o.life[0]);
      const tint = Math.random() < 0.3 ? new THREE.Color(1, 1, 1).lerp(c, 0.3) : c;
      this.spawn(p, this.v, tint, o.size[0], o.size[1], life, o.gravity ?? -3, o.drag ?? 1.2);
    }
  }

  shockwave(p: THREE.Vector3, color: THREE.ColorRepresentation, maxScale: number, dur: number, normal = new THREE.Vector3(0, 1, 0)) {
    const mat = new THREE.MeshBasicMaterial({ color, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
    const mesh = new THREE.Mesh(this.ringGeom, mat);
    mesh.position.copy(p);
    mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), normal);
    mesh.scale.setScalar(0.1);
    this.root.add(mesh);
    this.rings.push({ mesh, t: 0, dur, maxScale });
  }

  goalExplosion(p: THREE.Vector3, color: THREE.ColorRepresentation, towardField: number) {
    this.burst(p, { count: 900, color, speed: 26, size: [0.9, 0.05], life: [0.8, 2.2], gravity: -2, drag: 1.6, spread: new THREE.Vector3(0, 4, towardField * 6) });
    this.burst(p, { count: 300, color: 0xffffff, speed: 14, size: [0.5, 0.02], life: [0.4, 1.2], gravity: -1, drag: 2 });
    this.shockwave(p, color, 40, 1.2, new THREE.Vector3(0, 0, 1));
    this.shockwave(p.clone().setY(0.1), color, 16, 1.1);
  }

  demolition(p: THREE.Vector3, color: THREE.ColorRepresentation) {
    this.burst(p, { count: 260, color: 0xffa040, speed: 9, size: [0.7, 0.05], life: [0.4, 1.1], gravity: 2, drag: 2.5 });
    this.burst(p, { count: 120, color, speed: 6, size: [0.5, 0.05], life: [0.5, 1.4], gravity: -2, drag: 1.5 });
    this.burst(p, { count: 80, color: 0x333333, speed: 3, size: [1.2, 1.8], life: [0.8, 1.6], gravity: 1, drag: 1 });
    this.shockwave(p, 0xffb060, 6, 0.5);
  }

  ballHit(p: THREE.Vector3, strength: number) {
    const n = Math.min(80, Math.round(10 + strength * 2.5));
    this.burst(p, { count: n, color: 0xfff1c0, speed: 3 + strength * 0.3, size: [0.18, 0.02], life: [0.15, 0.45], gravity: -4, drag: 3 });
  }

  update(dt: number) {
    for (let i = 0; i < this.max; i++) {
      if (this.life[i] <= 0) {
        this.alpha[i] = 0;
        continue;
      }
      this.life[i] -= dt;
      const t = 1 - Math.max(0, this.life[i]) / this.maxLife[i];
      const d = Math.exp(-this.drag[i] * dt);
      const o = i * 3;
      this.vel[o] *= d;
      this.vel[o + 1] = this.vel[o + 1] * d + this.gravity[i] * dt;
      this.vel[o + 2] *= d;
      this.pos[o] += this.vel[o] * dt;
      this.pos[o + 1] += this.vel[o + 1] * dt;
      this.pos[o + 2] += this.vel[o + 2] * dt;
      this.size[i] = this.size0[i] + (this.size1[i] - this.size0[i]) * t;
      this.col[o] = this.col0[o] + (this.col1[o] - this.col0[o]) * t;
      this.col[o + 1] = this.col0[o + 1] + (this.col1[o + 1] - this.col0[o + 1]) * t;
      this.col[o + 2] = this.col0[o + 2] + (this.col1[o + 2] - this.col0[o + 2]) * t;
      this.alpha[i] = this.life[i] > 0 ? (1 - t) * (1 - t) : 0;
    }
    (this.geom.attributes.position as THREE.BufferAttribute).needsUpdate = true;
    (this.geom.attributes.aColor as THREE.BufferAttribute).needsUpdate = true;
    (this.geom.attributes.aSize as THREE.BufferAttribute).needsUpdate = true;
    (this.geom.attributes.aAlpha as THREE.BufferAttribute).needsUpdate = true;

    for (let k = this.rings.length - 1; k >= 0; k--) {
      const r = this.rings[k];
      r.t += dt;
      const t = r.t / r.dur;
      r.mesh.scale.setScalar(0.1 + r.maxScale * (1 - (1 - t) * (1 - t)));
      (r.mesh.material as THREE.MeshBasicMaterial).opacity = Math.max(0, 1 - t);
      if (t >= 1) {
        this.root.remove(r.mesh);
        (r.mesh.material as THREE.Material).dispose();
        this.rings.splice(k, 1);
      }
    }
  }

  clear() {
    this.life.fill(0);
    this.alpha.fill(0);
    for (const r of this.rings) {
      this.root.remove(r.mesh);
      (r.mesh.material as THREE.Material).dispose();
    }
    this.rings.length = 0;
  }

  destroy() {
    this.geom.dispose();
    this.mat.dispose();
    this.ringGeom.dispose();
    for (const r of this.rings) (r.mesh.material as THREE.Material).dispose();
  }
}

function randomUnit(): THREE.Vector3 {
  const u = Math.random() * 2 - 1;
  const th = Math.random() * Math.PI * 2;
  const r = Math.sqrt(1 - u * u);
  return new THREE.Vector3(r * Math.cos(th), u, r * Math.sin(th));
}
