import { describe, it, expect } from 'vitest';
import RAPIER from '@dimforge/rapier3d-compat';

describe('Rapier Initialization', () => {
  it('initializes Rapier WASM successfully in Node', async () => {
    await RAPIER.init();
    const gravity = { x: 0, y: -9.81, z: 0 };
    const world = new RAPIER.World(gravity);
    expect(world).toBeDefined();

    const rigidBodyDesc = RAPIER.RigidBodyDesc.dynamic().setTranslation(0, 10, 0);
    const body = world.createRigidBody(rigidBodyDesc);
    const colliderDesc = RAPIER.ColliderDesc.ball(1.0);
    world.createCollider(colliderDesc, body);

    for (let i = 0; i < 60; i++) {
      world.step();
    }

    const pos = body.translation();
    expect(pos.y).toBeLessThan(10);
    world.free();
  });
});
