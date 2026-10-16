import RAPIER from '@dimforge/rapier3d-compat';
import { BALL_CONFIG, BallConfig, CONTACT_MATERIALS, TransformSnapshot, Vec3 } from '@aerial-arena/shared';

export interface BallPhysicsHandle {
  body: RAPIER.RigidBody;
  collider: RAPIER.Collider;
  config: BallConfig;
  reset(pos?: Vec3): void;
  getTransform(): TransformSnapshot;
  setTransform(pos: Vec3, vel?: Vec3, angVel?: Vec3): void;
  /** Apply RL speed limits. Call once per physics tick after the world step. */
  clampVelocities(): void;
}

export function createBall(
  world: RAPIER.World,
  initialPos: Vec3 = { x: 0, y: BALL_CONFIG.restHeight, z: 0 },
  config: BallConfig = BALL_CONFIG
): BallPhysicsHandle {
  const body = world.createRigidBody(
    RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(initialPos.x, initialPos.y, initialPos.z)
      .setLinearDamping(config.drag)
      .setAngularDamping(0)
      // No CCD: Rapier's CCD clamps motion near surfaces (eats jump/hit velocity). At 120 Hz the
      // fastest car (0.19 m/tick) and ball (0.5 m/tick) move less than their own half-extents per tick.
      .setCcdEnabled(false)
      .setCanSleep(false)
  );

  // Multiply combine rule; see CONTACT_MATERIALS for the resulting per-pair values.
  const volume = (4 / 3) * Math.PI * config.radius ** 3;
  const collider = world.createCollider(
    RAPIER.ColliderDesc.ball(config.radius)
      .setDensity(config.mass / volume)
      .setFriction(CONTACT_MATERIALS.ballFriction)
      .setRestitution(CONTACT_MATERIALS.ballRestitution)
      .setFrictionCombineRule(RAPIER.CoefficientCombineRule.Multiply)
      .setRestitutionCombineRule(RAPIER.CoefficientCombineRule.Multiply),
    body
  );

  const reset = (pos: Vec3 = { x: 0, y: config.restHeight, z: 0 }) => {
    body.setTranslation(pos, true);
    body.setRotation({ x: 0, y: 0, z: 0, w: 1 }, true);
    body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    body.setAngvel({ x: 0, y: 0, z: 0 }, true);
  };

  const getTransform = (): TransformSnapshot => {
    const t = body.translation();
    const r = body.rotation();
    const lv = body.linvel();
    const av = body.angvel();
    return {
      x: t.x, y: t.y, z: t.z,
      qx: r.x, qy: r.y, qz: r.z, qw: r.w,
      vx: lv.x, vy: lv.y, vz: lv.z,
      wx: av.x, wy: av.y, wz: av.z,
    };
  };

  const setTransform = (pos: Vec3, vel: Vec3 = { x: 0, y: 0, z: 0 }, angVel: Vec3 = { x: 0, y: 0, z: 0 }) => {
    body.setTranslation(pos, true);
    body.setLinvel(vel, true);
    body.setAngvel(angVel, true);
  };

  const clampVelocities = () => {
    const v = body.linvel();
    const speed = Math.hypot(v.x, v.y, v.z);
    if (speed > config.maxSpeed) {
      const k = config.maxSpeed / speed;
      body.setLinvel({ x: v.x * k, y: v.y * k, z: v.z * k }, true);
    }
    const w = body.angvel();
    const spin = Math.hypot(w.x, w.y, w.z);
    if (spin > config.maxAngularSpeed) {
      const k = config.maxAngularSpeed / spin;
      body.setAngvel({ x: w.x * k, y: w.y * k, z: w.z * k }, true);
    }
  };

  return { body, collider, config, reset, getTransform, setTransform, clampVelocities };
}
