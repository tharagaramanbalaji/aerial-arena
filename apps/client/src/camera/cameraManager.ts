import * as THREE from 'three';
import { TransformSnapshot } from '@aerial-arena/shared';
import { settings } from '../settings/settingsStore.js';
import { clampInsideArena } from '@aerial-arena/game-core';

export type CameraMode = 'ball_cam' | 'car_cam';

export interface CameraTargets {
  car: TransformSnapshot;
  ball: TransformSnapshot;
  /** True when the car's wheels are on a surface (enables wall-aligned Car Cam). */
  grounded: boolean;
  /** True while the car performs a dodge/flip (Ball Cam steadies so the flip aim isn't thrown off). */
  dodging?: boolean;
}

const WORLD_UP = new THREE.Vector3(0, 1, 0);
const DEG = THREE.MathUtils.degToRad;

/**
 * Rocket-League-style chase camera (presentation only; never affects physics).
 * Kept deliberately simple: fixed distance/height, one calm follow rate, level horizon.
 * Tunables come from Settings → Camera (FOV, distance, height, angle, swivel speed).
 *
 *  - The camera sits `distance` behind and `height` above the car along the horizontal
 *    heading. It never orbits below the car: looking at a high ball only *tilts* the view.
 *  - Car Cam: heading = car forward. On walls/ramps the camera's up follows the surface.
 *  - Ball Cam: heading points at the ball; the upward tilt is capped so the car always stays
 *    in the bottom of the frame (cap derived from FOV, height and distance).
 *  - The camera is kept inside the arena (ramps included); squeezed against a wall it aims at the car.
 */
export class CameraManager {
  public mode: CameraMode = 'ball_cam';
  public readonly camera: THREE.PerspectiveCamera;

  private readonly viewDir = new THREE.Vector3(0, 0, 1);
  private readonly camUp = new THREE.Vector3(0, 1, 0);
  private readonly pos = new THREE.Vector3(0, 3, -50);
  private aspect = 16 / 9;
  private initialized = false;
  private shakeTime = 0;
  private shakeStrength = 0;

  // scratch
  private readonly q = new THREE.Quaternion();
  private readonly qPartial = new THREE.Quaternion();
  private readonly identity = new THREE.Quaternion();
  private readonly tmp = new THREE.Vector3();
  private readonly desired = new THREE.Vector3();
  private readonly heading = new THREE.Vector3();
  private readonly carPos = new THREE.Vector3();
  private readonly carFwd = new THREE.Vector3();
  private readonly carUp = new THREE.Vector3();
  private readonly ballPos = new THREE.Vector3();
  private readonly targetPos = new THREE.Vector3();
  private readonly right = new THREE.Vector3();
  private readonly lookDir = new THREE.Vector3();
  private readonly cand = new THREE.Vector3();
  private squeeze = 0;
  private readonly airHeading = new THREE.Vector3();
  /** Keyboard look-around (-1..1 each), set by the app from the look keys every frame. */
  public keyLook = { x: 0, y: 0 };
  private yaw = 0;
  private pitch = 0;
  private lookYaw = 0;
  private lookPitch = 0;
  private lastMode: CameraMode = 'ball_cam';
  private shakePhase = 0;
  private lookReady = false;
  private readonly smoothLook = new THREE.Vector3(0, 0, 1);
  private readonly lastCarPos = new THREE.Vector3();
  private readonly vel = new THREE.Vector3();

  constructor(aspect = 16 / 9) {
    this.camera = new THREE.PerspectiveCamera(70, aspect, 0.05, 2000);
    this.setAspect(aspect);
    settings.subscribe(() => this.setAspect(this.aspect));
  }

  toggleMode(): CameraMode {
    this.mode = this.mode === 'ball_cam' ? 'car_cam' : 'ball_cam';
    return this.mode;
  }

  setMode(mode: CameraMode): CameraMode {
    this.mode = mode;
    return mode;
  }

  setAspect(aspect: number): void {
    this.aspect = aspect;
    const hfov = DEG(settings.get().camera.fov);
    const vfov = 2 * Math.atan(Math.tan(hfov / 2) / aspect);
    this.camera.fov = Math.min(100, THREE.MathUtils.radToDeg(vfov));
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
  }

  shake(strength: number, duration: number): void {
    if (!settings.get().camera.shake) return;
    this.shakeStrength = strength;
    this.shakeTime = duration;
  }

  /** Snap behind the car (used at kickoff / reset). */
  snap(): void {
    this.initialized = false;
  }

  update(t: CameraTargets, dt: number): void {
    const cs = settings.get().camera;
    const c = t.car;
    this.carPos.set(c.x, c.y, c.z);
    this.ballPos.set(t.ball.x, t.ball.y, t.ball.z);
    this.q.set(c.qx, c.qy, c.qz, c.qw);
    this.carFwd.set(0, 0, 1).applyQuaternion(this.q);
    this.carUp.set(0, 1, 0).applyQuaternion(this.q);
    this.camUp.copy(WORLD_UP); // horizon always level (player preference, incl. walls)

    // Teleports (kickoff, reset, demo respawn) snap instead of gliding across the field.
    if (this.initialized && this.lastCarPos.distanceTo(this.carPos) > 6) this.initialized = false;
    if (!this.initialized) this.lookReady = false;
    this.lastCarPos.copy(this.carPos);
    this.lastMode = this.mode;

    // 1. Target view angles: yaw about world up, pitch above the horizon.
    const flat = (v: THREE.Vector3, out: THREE.Vector3) => out.copy(v).addScaledVector(this.camUp, -v.dot(this.camUp));
    const yawOf = (v: THREE.Vector3) => Math.atan2(v.x, v.z);
    this.carHeading(t, flat); // -> this.desired (horizontal unit vector)
    const carYaw = yawOf(this.desired);
    let targetYaw = carYaw;
    let targetPitch = 0;
    if (this.mode === 'ball_cam') {
      this.tmp.subVectors(this.ballPos, this.carPos);
      const horiz = Math.hypot(this.tmp.x, this.tmp.z);
      // Near zone: a ball on the hood or overhead has no stable horizontal direction, so blend
      // toward the car heading instead of whipping around (the main source of camera swings).
      const w = THREE.MathUtils.smoothstep(horiz, 1.5, 4.5);
      targetYaw = carYaw + wrapAngle(yawOf(this.tmp) - carYaw) * w;
      // Upward tilt toward a high ball, capped so the car stays in the bottom of the frame.
      const carBelow = Math.atan2(cs.height, cs.distance);
      const fitCap = DEG(this.camera.fov / 2) - carBelow - DEG(11) - DEG(cs.angle);
      const hi = Math.max(0, Math.min(DEG(cs.ballCamMaxPitch), fitCap));
      targetPitch = THREE.MathUtils.clamp(Math.atan2(this.tmp.y, Math.max(horiz, 0.5)), DEG(-12), hi) * w;
    }

    // 2. Manual look (gamepad right stick = RL swivel): up to 180 deg aside/behind, returns on release.
    const stick = this.readLookStick();
    const look = { x: stick.x !== 0 ? stick.x : this.keyLook.x, y: stick.y !== 0 ? stick.y : this.keyLook.y };
    const swivelK = 1 - Math.exp(-(1.5 + cs.swivelSpeed * 1.2) * dt);
    this.lookYaw += (look.x * Math.PI - this.lookYaw) * swivelK;
    this.lookPitch += (-look.y * DEG(35) - this.lookPitch) * swivelK;
    targetYaw += this.lookYaw;
    targetPitch += this.lookPitch;

    // 3. Smooth yaw and pitch separately (never rotates through vertical) with a swing-speed cap.
    if (!this.initialized) {
      this.yaw = targetYaw;
      this.pitch = targetPitch;
    } else {
      // One calm follow rate and a turn-speed cap: no whips, no special cases.
      const rate = 2.5 + cs.swivelSpeed * 1.2;
      const maxSpeed = DEG(250);
      const k = 1 - Math.exp(-rate * dt);
      const dy = THREE.MathUtils.clamp(wrapAngle(targetYaw - this.yaw) * k, -maxSpeed * dt, maxSpeed * dt);
      this.yaw = wrapAngle(this.yaw + dy);
      this.pitch += THREE.MathUtils.clamp((targetPitch - this.pitch) * k, -maxSpeed * dt, maxSpeed * dt);
    }
    this.heading.set(Math.sin(this.yaw), 0, Math.cos(this.yaw));
    this.viewDir.copy(this.heading).multiplyScalar(Math.cos(this.pitch)).addScaledVector(this.camUp, Math.sin(this.pitch));

    // 4. Position behind/above the car along the heading. Stiffness = how far the camera
    //    stretches back at speed (RL); follow is tight horizontally, softer vertically.
    const dist = cs.distance; // fixed: the camera never zooms in or out on its own
    this.targetPos.copy(this.carPos).addScaledVector(this.camUp, cs.height).addScaledVector(this.heading, -dist);
    // Clamp the target (not the camera) inside the arena, ramps included, so walls never cause jumps.
    let cl = clampInsideArena(this.targetPos, 0.45);
    const pushed = Math.hypot(cl.x - this.targetPos.x, cl.z - this.targetPos.z);
    if (pushed > 0.01) cl = clampInsideArena({ x: cl.x, y: cl.y + Math.min(1.2, pushed * 0.5), z: cl.z }, 0.45);
    this.targetPos.set(cl.x, cl.y, cl.z);
    if (!this.initialized) {
      this.pos.copy(this.targetPos);
    } else {
      const kh = 1 - Math.exp(-30 * dt);
      const kv = 1 - Math.exp(-14 * dt);
      this.pos.x += (this.targetPos.x - this.pos.x) * kh;
      this.pos.z += (this.targetPos.z - this.pos.z) * kh;
      this.pos.y += (this.targetPos.y - this.pos.y) * kv;
    }
    this.squeeze += (Math.min(1, pushed / (cs.distance * 0.5)) - this.squeeze) * Math.min(1, dt * 6);
    this.initialized = true;

    // 5. Orientation: view direction plus the base angle; squeezed against a wall, aim at the car.
    this.right.crossVectors(this.viewDir, this.camUp).normalize();
    this.lookDir.copy(this.viewDir).applyAxisAngle(this.right, DEG(cs.angle));
    if (this.squeeze > 0.01) {
      this.tmp.copy(this.carPos).addScaledVector(this.camUp, 0.4).sub(this.pos).normalize();
      this.lookDir.lerp(this.tmp, this.squeeze).normalize();
    }
    this.camera.position.copy(this.pos);
    if (this.shakeTime > 0) {
      // Smooth low-frequency rumble instead of per-frame random jitter.
      this.shakeTime -= dt;
      this.shakePhase += dt;
      const a = this.shakeStrength * Math.max(0, this.shakeTime) * 0.6;
      const ph = this.shakePhase * 38;
      this.camera.position.x += Math.sin(ph) * a;
      this.camera.position.y += Math.sin(ph * 1.31 + 1.7) * a;
      this.camera.position.z += Math.sin(ph * 0.83 + 3.1) * a;
    }
    // Final orientation stage: whatever drove the look direction (ball, squeeze, transitions),
    // cap its angular speed so the view can never whip.
    if (!this.lookReady) {
      this.smoothLook.copy(this.lookDir);
      this.lookReady = true;
    } else {
      const ang = this.smoothLook.angleTo(this.lookDir);
      const maxStep = DEG(250) * dt; // same cap as the follow, so the view can never whip
      const step = Math.min(ang * (1 - Math.exp(-22 * dt)), maxStep);
      if (ang > 1e-5) this.slerpVector(this.smoothLook, this.lookDir, step / ang);
    }
    this.camera.up.copy(this.camUp);
    this.camera.lookAt(this.tmp.copy(this.camera.position).add(this.smoothLook));
  }

  /** Car Cam heading (horizontal unit vector) into this.desired; stable through rolls, flips and walls. */
  private carHeading(t: CameraTargets, flat: (v: THREE.Vector3, out: THREE.Vector3) => THREE.Vector3): void {
    const c = t.car;
    this.right.set(1, 0, 0).applyQuaternion(this.q).negate(); // car right = -X local
    flat(this.carFwd, this.tmp);
    this.cand.crossVectors(this.camUp, this.right);
    const prev = this.heading.lengthSq() > 0.5 ? this.heading : this.tmp;
    if (t.grounded && this.tmp.lengthSq() > 0.09) {
      this.desired.copy(this.tmp);
    } else if (!t.grounded) {
      // Airborne (RL behaviour): keep facing the direction from the last time the wheels touched a
      // surface. Rolls, flips and tumbles therefore never turn the camera.
      this.desired.copy(this.airHeading.lengthSq() > 0.5 ? this.airHeading : prev);
      void c;
    } else {
      // On walls/ceiling: pick the candidate (either sign) that best continues the heading.
      let best = -Infinity;
      for (const v of [this.tmp, this.cand]) {
        const l = v.length();
        if (l < 0.25) continue;
        for (const sign of [1, -1]) {
          const score = (sign * v.dot(prev)) / l;
          if (score > best) {
            best = score;
            this.desired.copy(v).multiplyScalar(sign / l);
          }
        }
      }
      if (best === -Infinity) this.desired.copy(prev);
    }
    if (this.desired.lengthSq() < 1e-4) this.desired.set(0, 0, 1);
    this.desired.normalize();
    if (t.grounded) this.airHeading.copy(this.desired);
  }

  /** Gamepad right stick for manual camera look (deadzoned). */
  private readLookStick(): { x: number; y: number } {
    const pads = typeof navigator.getGamepads === 'function' ? navigator.getGamepads() : [];
    const gp = Array.from(pads).find((p): p is Gamepad => !!p && p.connected);
    if (!gp) return { x: 0, y: 0 };
    const dz = (v: number) => (Math.abs(v) < 0.18 ? 0 : (v - Math.sign(v) * 0.18) / 0.82);
    return { x: dz(gp.axes[2] ?? 0), y: dz(gp.axes[3] ?? 0) };
  }

  /** Rotate unit vector `v` toward unit vector `target` by fraction `t` (great-circle). */
  private slerpVector(v: THREE.Vector3, target: THREE.Vector3, t: number) {
    this.qPartial.setFromUnitVectors(v, target);
    this.qPartial.slerp(this.identity, 1 - t);
    v.applyQuaternion(this.qPartial).normalize();
  }
}

/** Wrap an angle to (-PI, PI]. */
function wrapAngle(a: number): number {
  return Math.atan2(Math.sin(a), Math.cos(a));
}
