import RAPIER from '@dimforge/rapier3d-compat';
import { ARENA_CONFIG, ArenaConfig } from '@aerial-arena/shared';

export interface ArenaPhysicsHandles {
  groundBody: RAPIER.RigidBody;
  colliders: RAPIER.Collider[];
}

/**
 * Builds the enclosed arena static collision geometry in Rapier.
 * Guarantees zero holes, physically open framed goals, posts, crossbars,
 * and beveled transitions for smooth wall riding.
 */
export function buildArenaColliders(
  world: RAPIER.World,
  config: ArenaConfig = ARENA_CONFIG
): ArenaPhysicsHandles {
  const bodyDesc = RAPIER.RigidBodyDesc.fixed().setTranslation(0, 0, 0);
  const groundBody = world.createRigidBody(bodyDesc);
  const colliders: RAPIER.Collider[] = [];

  const { length, width, height, cornerBevel, goalWidth, goalHeight, goalDepth } = config;
  const halfL = length / 2;
  const halfW = width / 2;
  const halfH = height / 2;
  const goalHalfW = goalWidth / 2;
  const goalHalfH = goalHeight / 2;
  const goalHalfD = goalDepth / 2;

  // Material settings for arena boundaries
  const arenaRestitution = 0.5;
  const arenaFriction = 0.4;

  const addBox = (
    hx: number, hy: number, hz: number,
    cx: number, cy: number, cz: number,
    rotY = 0
  ) => {
    let colDesc = RAPIER.ColliderDesc.cuboid(hx, hy, hz)
      .setTranslation(cx, cy, cz)
      .setRestitution(arenaRestitution)
      .setFriction(arenaFriction);

    if (rotY !== 0) {
      // Rotation around Y
      const half = rotY * 0.5;
      colDesc = colDesc.setRotation({ x: 0, y: Math.sin(half), z: 0, w: Math.cos(half) });
    }

    const col = world.createCollider(colDesc, groundBody);
    colliders.push(col);
    return col;
  };

  // 1. Playable Arena Floor (y = 0)
  addBox(halfW + 10, 0.5, halfL + 15, 0, -0.5, 0);

  // 2. Arena Ceiling (y = height)
  addBox(halfW + 10, 0.5, halfL + 15, 0, height + 0.5, 0);

  // 3. Side Walls (Left: x = -halfW, Right: x = halfW)
  addBox(0.5, halfH, halfL, -halfW - 0.5, halfH, 0);
  addBox(0.5, halfH, halfL,  halfW + 0.5, halfH, 0);

  // 4. End Walls with Goal Cutouts at Z = -halfL (Blue) and Z = halfL (Orange)
  const endPanelWidth = (width - goalWidth) / 2;
  const endPanelHalfW = endPanelWidth / 2;
  const endPanelLeftCenterX = -(halfW - endPanelHalfW);
  const endPanelRightCenterX = halfW - endPanelHalfW;

  const upperHeight = height - goalHeight;
  const upperHalfH = upperHeight / 2;
  const upperCenterY = goalHeight + upperHalfH;

  for (const sign of [-1, 1]) {
    const cz = sign * (halfL + 0.5);

    // Left end panel
    addBox(endPanelHalfW, halfH, 0.5, endPanelLeftCenterX, halfH, cz);
    // Right end panel
    addBox(endPanelHalfW, halfH, 0.5, endPanelRightCenterX, halfH, cz);
    // Above-goal upper panel
    addBox(goalHalfW, upperHalfH, 0.5, 0, upperCenterY, cz);
  }

  // 5. Goal Enclosures (Blue at -Z, Orange at +Z)
  for (const sign of [-1, 1]) {
    const goalBackZ = sign * (halfL + goalDepth + 0.5);
    const goalMidZ = sign * (halfL + goalHalfD);

    // Back wall of goal
    addBox(goalHalfW, goalHalfH, 0.5, 0, goalHalfH, goalBackZ);
    // Left side wall of goal
    addBox(0.5, goalHalfH, goalHalfD, -goalHalfW - 0.5, goalHalfH, goalMidZ);
    // Right side wall of goal
    addBox(0.5, goalHalfH, goalHalfD,  goalHalfW + 0.5, goalHalfH, goalMidZ);
    // Ceiling of goal
    addBox(goalHalfW, 0.5, goalHalfD, 0, goalHeight + 0.5, goalMidZ);
  }

  // 6. Goal Posts and Crossbars (Physical colliders for deflections)
  const postRadius = 0.35;
  for (const sign of [-1, 1]) {
    const postZ = sign * halfL;
    // Left post
    const leftPostDesc = RAPIER.ColliderDesc.cylinder(goalHalfH, postRadius)
      .setTranslation(-goalHalfW, goalHalfH, postZ)
      .setRestitution(0.7)
      .setFriction(0.2);
    colliders.push(world.createCollider(leftPostDesc, groundBody));

    // Right post
    const rightPostDesc = RAPIER.ColliderDesc.cylinder(goalHalfH, postRadius)
      .setTranslation(goalHalfW, goalHalfH, postZ)
      .setRestitution(0.7)
      .setFriction(0.2);
    colliders.push(world.createCollider(rightPostDesc, groundBody));

    // Crossbar
    const crossbarDesc = RAPIER.ColliderDesc.cylinder(goalHalfW, postRadius)
      .setTranslation(0, goalHeight, postZ)
      .setRotation({ x: 0, y: 0, z: Math.SQRT1_2, w: Math.SQRT1_2 }) // rotate to lie along X
      .setRestitution(0.7)
      .setFriction(0.2);
    colliders.push(world.createCollider(crossbarDesc, groundBody));
  }

  // 7. Corner Bevels (45-degree angle in corners for smooth circulation)
  // Distance from corner: hypotenuse of cornerBevel
  const cornerAngle = Math.PI / 4;
  const beveledHalfLen = cornerBevel * Math.SQRT2 * 0.5;
  const bx = halfW - cornerBevel * 0.5;
  const bz = halfL - cornerBevel * 0.5;

  addBox(beveledHalfLen, halfH, 0.5, -bx, halfH, -bz,  cornerAngle);
  addBox(beveledHalfLen, halfH, 0.5,  bx, halfH, -bz, -cornerAngle);
  addBox(beveledHalfLen, halfH, 0.5, -bx, halfH,  bz, -cornerAngle);
  addBox(beveledHalfLen, halfH, 0.5,  bx, halfH,  bz,  cornerAngle);

  // 8. Floor-to-wall curved ramps (incline bevel along perimeter for transition)
  const rampThickness = 0.4;
  const rampWidth = 2.0;
  // Side wall ramps
  for (const side of [-1, 1]) {
    const rx = side * (halfW - rampWidth * 0.35);
    const rampDesc = RAPIER.ColliderDesc.cuboid(rampThickness, rampWidth * 0.5, halfL - cornerBevel)
      .setTranslation(rx, rampWidth * 0.35, 0)
      .setRotation({ x: 0, y: 0, z: side * Math.sin(Math.PI / 8), w: Math.cos(Math.PI / 8) })
      .setRestitution(arenaRestitution)
      .setFriction(arenaFriction);
    colliders.push(world.createCollider(rampDesc, groundBody));
  }

  return { groundBody, colliders };
}
