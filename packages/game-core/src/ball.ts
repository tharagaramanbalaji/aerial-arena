import RAPIER from '@dimforge/rapier3d-compat';
import { BALL_CONFIG, BallConfig, TransformSnapshot, Vec3 } from '@aerial-arena/shared';

export interface BallPhysicsHandle {
  body: RAPIER.RigidBody;
  collider: RAPIER.Collider;
  reset(pos?: Vec3): void;
  getTransform(): TransformSnapshot;
  setTransform(pos: Vec3, vel?: Vec3): void;
}

export function createBall(
  world: RAPIER.World,
  initialPos: Vec3 = { x: 0, y: BALL_CONFIG.radius, z: 0 },
  config: BallConfig = BALL_CONFIG
): BallPhysicsHandle {
  const bodyDesc = RAPIER.RigidBodyDesc.dynamic()
    .setTranslation(initialPos.x, initialPos.y, initialPos.z)
    .setLinearDamping(config.linearDamping)
    .setAngularDamping(config.angularDamping)
    .setCcdEnabled(true);

  const body = world.createRigidBody(bodyDesc);

  const colliderDesc = RAPIER.ColliderDesc.ball(config.radius)
    .setDensity(config.mass / ((4 / 3) * Math.PI * Math.pow(config.radius, 3)))
    .setRestitution(config.restitution)
    .setFriction(config.friction);

  const collider = world.createCollider(colliderDesc, body);

  const reset = (pos: Vec3 = { x: 0, y: config.radius, z: 0 }) => {
    body.setTranslation({ x: pos.x, y: pos.y, z: pos.z }, true);
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

  const setTransform = (pos: Vec3, vel: Vec3 = { x: 0, y: 0, z: 0 }) => {
    body.setTranslation({ x: pos.x, y: pos.y, z: pos.z }, true);
    body.setLinvel({ x: vel.x, y: vel.y, z: vel.z }, true);
  };

  return {
    body,
    collider,
    reset,
    getTransform,
    setTransform,
  };
}
