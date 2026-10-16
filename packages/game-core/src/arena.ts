import RAPIER from '@dimforge/rapier3d-compat';
import { ARENA_CONFIG, ArenaConfig, CONTACT_MATERIALS } from '@aerial-arena/shared';
import { ArenaGeometry, buildArenaGeometry } from './arenaGeometry.js';

export interface ArenaPhysicsHandles {
  groundBody: RAPIER.RigidBody;
  colliders: RAPIER.Collider[];
  geometry: ArenaGeometry;
}

/**
 * Builds static arena collision from the same procedural geometry the client renders.
 *  - Floor and ceiling: thick cuboids (perfectly flat, no internal edges).
 *  - Fillets, walls, goal boxes: one trimesh with internal-edge fixing so balls and
 *    wheel rays do not snag on triangle seams.
 * Friction/restitution use the Multiply combine rule so ball, car and arena colliders
 * produce RL-style per-pair values (see CONTACT_MATERIALS in constants.ts).
 */
export function buildArenaColliders(
  world: RAPIER.World,
  config: ArenaConfig = ARENA_CONFIG
): ArenaPhysicsHandles {
  const geometry = buildArenaGeometry(config);
  const groundBody = world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
  const colliders: RAPIER.Collider[] = [];

  const material = (desc: RAPIER.ColliderDesc) =>
    desc
      .setFriction(CONTACT_MATERIALS.arenaFriction)
      .setRestitution(CONTACT_MATERIALS.arenaRestitution)
      .setFrictionCombineRule(RAPIER.CoefficientCombineRule.Multiply)
      .setRestitutionCombineRule(RAPIER.CoefficientCombineRule.Multiply);

  const slabHalfX = config.halfWidth + 10;
  const slabHalfZ = config.halfLength + config.goalDepth + 10;
  colliders.push(world.createCollider(material(RAPIER.ColliderDesc.cuboid(slabHalfX, 2, slabHalfZ).setTranslation(0, -2, 0)), groundBody));
  colliders.push(
    world.createCollider(material(RAPIER.ColliderDesc.cuboid(slabHalfX, 2, slabHalfZ).setTranslation(0, config.height + 2, 0)), groundBody)
  );

  const shellDesc = RAPIER.ColliderDesc.trimesh(
    geometry.shell.positions,
    geometry.shell.indices,
    RAPIER.TriMeshFlags.FIX_INTERNAL_EDGES
  );
  colliders.push(world.createCollider(material(shellDesc), groundBody));

  // Solid 1 m-thick backstops behind each goal box's side walls, roof and back wall.
  const T = 1;
  const gw = config.goalHalfWidth;
  const gh = config.goalHeight;
  const D = config.goalDepth;
  for (const sign of [-1, 1]) {
    const zMid = sign * (config.halfLength + D / 2);
    const boxes: [number, number, number, number, number, number][] = [
      [T / 2, gh / 2 + T, D / 2, -(gw + T / 2), gh / 2, zMid], // left wall
      [T / 2, gh / 2 + T, D / 2, gw + T / 2, gh / 2, zMid], // right wall
      [gw + T, T / 2, D / 2, 0, gh + T / 2, zMid], // roof
      [gw + T, gh / 2 + T, T / 2, 0, gh / 2, sign * (config.halfLength + D + T / 2)], // back
    ];
    for (const [hx, hy, hz, x, y, z] of boxes) {
      colliders.push(world.createCollider(material(RAPIER.ColliderDesc.cuboid(hx, hy, hz).setTranslation(x, y, z)), groundBody));
    }
  }

  return { groundBody, colliders, geometry };
}
