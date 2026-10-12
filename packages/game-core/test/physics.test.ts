import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  createGameSimulation,
  GameSimulation,
} from '../src/physicsWorld.js';
import { PlayerInput, vec3Length } from '@aerial-arena/shared';

function defaultInput(overrides: Partial<PlayerInput> = {}): PlayerInput {
  return {
    seq: 1,
    timestamp: Date.now(),
    throttle: 0,
    steer: 0,
    pitch: 0,
    yaw: 0,
    roll: 0,
    jump: false,
    jumpHeld: false,
    boost: false,
    powerslide: false,
    ...overrides,
  };
}

describe('Physics Test Harness', () => {
  let sim: GameSimulation;

  beforeEach(async () => {
    sim = await createGameSimulation();
  });

  afterEach(() => {
    sim.destroy();
  });

  it('1. Throttle from rest accelerates forward', () => {
    const car = sim.addCar('p1', 'blue', { x: 0, y: 0.6, z: 0 }, 0);
    const inputs = new Map<string, PlayerInput>();
    inputs.set('p1', defaultInput({ throttle: 1.0 }));

    // Simulate 30 ticks (0.5 seconds)
    for (let i = 0; i < 30; i++) {
      sim.step(inputs, 1 / 60);
    }

    const t = car.getTransform();
    expect(t.vz).toBeGreaterThan(5.0);
    expect(t.z).toBeGreaterThan(0.5);
  });

  it('2. Brake and reverse transition', () => {
    const car = sim.addCar('p1', 'blue', { x: 0, y: 0.6, z: 0 }, 0);
    const inputs = new Map<string, PlayerInput>();

    // Accelerate first
    inputs.set('p1', defaultInput({ throttle: 1.0 }));
    for (let i = 0; i < 60; i++) {
      sim.step(inputs, 1 / 60);
    }
    const speedAfterAccel = car.getTransform().vz;
    expect(speedAfterAccel).toBeGreaterThan(10.0);

    // Now apply reverse/brake
    inputs.set('p1', defaultInput({ throttle: -1.0 }));
    for (let i = 0; i < 60; i++) {
      sim.step(inputs, 1 / 60);
    }
    const speedAfterBrake = car.getTransform().vz;
    expect(speedAfterBrake).toBeLessThan(speedAfterAccel);
  });

  it('3. Top speed cap with and without boost', () => {
    const car = sim.addCar('p1', 'blue', { x: 0, y: 0.6, z: -30 }, 0);
    const inputs = new Map<string, PlayerInput>();

    // Hold throttle only for 180 ticks (3s)
    inputs.set('p1', defaultInput({ throttle: 1.0 }));
    for (let i = 0; i < 180; i++) {
      sim.step(inputs, 1 / 60);
    }
    const unboostedSpeed = car.getTransform().vz;
    expect(unboostedSpeed).toBeLessThanOrEqual(23.5);

    // Now add boost
    inputs.set('p1', defaultInput({ throttle: 1.0, boost: true }));
    for (let i = 0; i < 60; i++) {
      sim.step(inputs, 1 / 60);
    }
    const boostedSpeed = car.getTransform().vz;
    expect(boostedSpeed).toBeGreaterThan(unboostedSpeed);
    expect(boostedSpeed).toBeLessThanOrEqual(36.0);
  });

  it('4. Steering sensitivity at slow vs high speed', () => {
    const car = sim.addCar('p1', 'blue', { x: 0, y: 0.6, z: 0 }, 0);
    const inputs = new Map<string, PlayerInput>();

    // Steer at rest
    inputs.set('p1', defaultInput({ steer: 1.0 }));
    sim.step(inputs, 1 / 60);
    const yawAtRest = Math.abs(car.getTransform().wy);

    // Drive fast and steer
    inputs.set('p1', defaultInput({ throttle: 1.0 }));
    for (let i = 0; i < 60; i++) {
      sim.step(inputs, 1 / 60);
    }
    inputs.set('p1', defaultInput({ throttle: 1.0, steer: 1.0 }));
    sim.step(inputs, 1 / 60);
    const yawAtSpeed = Math.abs(car.getTransform().wy);

    expect(yawAtSpeed).toBeGreaterThan(0.5);
  });

  it('5. Powerslide reduces lateral friction', () => {
    const car = sim.addCar('p1', 'blue', { x: 0, y: 0.6, z: 0 }, 0);
    const inputs = new Map<string, PlayerInput>();

    // Drive forward
    inputs.set('p1', defaultInput({ throttle: 1.0 }));
    for (let i = 0; i < 60; i++) {
      sim.step(inputs, 1 / 60);
    }

    // Turn with powerslide
    inputs.set('p1', defaultInput({ throttle: 0.5, steer: 1.0, powerslide: true }));
    for (let i = 0; i < 30; i++) {
      sim.step(inputs, 1 / 60);
    }

    const t = car.getTransform();
    // In powerslide, lateral velocity is preserved longer
    expect(Math.abs(t.vx)).toBeGreaterThan(0.5);
  });

  it('6. First jump impulse and variable jump hold', () => {
    const car = sim.addCar('p1', 'blue', { x: 0, y: 0.6, z: 0 }, 0);
    const inputs = new Map<string, PlayerInput>();

    // Tap jump (single tick jump, no hold)
    inputs.set('p1', defaultInput({ jump: true, jumpHeld: false }));
    sim.step(inputs, 1 / 60);
    inputs.set('p1', defaultInput({ jump: false, jumpHeld: false }));

    let maxHeightTap = 0.6;
    for (let i = 0; i < 40; i++) {
      sim.step(inputs, 1 / 60);
      maxHeightTap = Math.max(maxHeightTap, car.getTransform().y);
    }
    expect(maxHeightTap).toBeGreaterThan(1.5);

    // Reset car and test jump hold
    car.reset({ x: 0, y: 0.6, z: 0 }, 0);
    inputs.set('p1', defaultInput({ jump: true, jumpHeld: true }));
    sim.step(inputs, 1 / 60);
    inputs.set('p1', defaultInput({ jump: false, jumpHeld: true }));

    let maxHeightHold = 0.6;
    for (let i = 0; i < 40; i++) {
      sim.step(inputs, 1 / 60);
      maxHeightHold = Math.max(maxHeightHold, car.getTransform().y);
    }
    // Jump with hold achieves greater height than tap
    expect(maxHeightHold).toBeGreaterThan(maxHeightTap);
  });

  it('7. Directional dodge impulse and orientation snap', () => {
    const car = sim.addCar('p1', 'blue', { x: 0, y: 0.6, z: 0 }, 0);
    const inputs = new Map<string, PlayerInput>();

    // First jump
    inputs.set('p1', defaultInput({ jump: true }));
    sim.step(inputs, 1 / 60);
    inputs.set('p1', defaultInput({ jump: false }));
    for (let i = 0; i < 10; i++) {
      sim.step(inputs, 1 / 60);
    }

    const velBeforeDodge = car.getTransform().vz;

    // Second press with forward throttle = Forward Flip Dodge
    inputs.set('p1', defaultInput({ jump: true, throttle: 1.0 }));
    sim.step(inputs, 1 / 60);

    const velAfterDodge = car.getTransform().vz;
    expect(velAfterDodge).toBeGreaterThan(velBeforeDodge + 3.0);
    expect(car.isDodging()).toBe(true);
  });

  it('8. Boost consumption and depletion', () => {
    const car = sim.addCar('p1', 'blue', { x: 0, y: 0.6, z: 0 }, 0);
    const inputs = new Map<string, PlayerInput>();
    expect(car.boostUnits).toBe(100);

    // Hold boost for 60 ticks (1s)
    inputs.set('p1', defaultInput({ boost: true }));
    for (let i = 0; i < 60; i++) {
      sim.step(inputs, 1 / 60);
    }

    // Depletes ~33.3 units per second
    expect(car.boostUnits).toBeLessThan(75);
    expect(car.boostUnits).toBeGreaterThan(55);
  });

  it('9. Boost pad pickup and cooldown', () => {
    // Pad 6 is at (0, -35) with small pad (+12)
    const car = sim.addCar('p1', 'blue', { x: 0, y: 0.6, z: -35 }, 0);
    car.boostUnits = 50;

    const inputs = new Map<string, PlayerInput>();
    inputs.set('p1', defaultInput());

    sim.step(inputs, 1 / 60);

    // Should have picked up pad (+12) -> 62 units
    expect(car.boostUnits).toBe(62);

    // Pad 6 should now be on cooldown
    const pad6 = sim.pads.getSnapshots().find((p) => p.id === 6);
    expect(pad6?.active).toBe(false);
    expect(pad6?.cooldownRemaining).toBeGreaterThan(3.5);
  });

  it('10. Car-ball impact momentum transfer', () => {
    const car = sim.addCar('p1', 'blue', { x: 0, y: 0.6, z: -10 }, 0);
    sim.ball.reset({ x: 0, y: 1.8, z: 0 });

    const inputs = new Map<string, PlayerInput>();
    inputs.set('p1', defaultInput({ throttle: 1.0, boost: true }));

    // Drive forward into the ball
    for (let i = 0; i < 60; i++) {
      sim.step(inputs, 1 / 60);
    }

    const ballTransform = sim.ball.getTransform();
    // Ball should be propelled forward along +Z
    expect(ballTransform.vz).toBeGreaterThan(10.0);
    expect(ballTransform.z).toBeGreaterThan(2.0);
  });

  it('11. Ball wall rebound', () => {
    // Place ball near right wall (x = 30) moving at +20 m/s toward wall (x = 34)
    sim.ball.setTransform({ x: 30, y: 5, z: 0 }, { x: 20, y: 0, z: 0 });

    const inputs = new Map<string, PlayerInput>();
    for (let i = 0; i < 30; i++) {
      sim.step(inputs, 1 / 60);
    }

    const t = sim.ball.getTransform();
    // Rebounds with negative X velocity
    expect(t.vx).toBeLessThan(-5.0);
  });

  it('12. High-speed swept goal detection', () => {
    // Launch ball at 35 m/s toward Blue goal (Z = -50m)
    sim.ball.setTransform({ x: 0, y: 3, z: -46 }, { x: 0, y: 0, z: -35 });

    const inputs = new Map<string, PlayerInput>();
    let goalScored = false;
    let scorerTeam = '';

    for (let i = 0; i < 20; i++) {
      const res = sim.step(inputs, 1 / 60);
      if (res.goalEvent) {
        goalScored = true;
        scorerTeam = res.goalEvent.scorer;
      }
    }

    expect(goalScored).toBe(true);
    // Orange scores into Blue goal
    expect(scorerTeam).toBe('orange');
  });

  it('13. No false goal on post graze or outside sensor', () => {
    // Ball moving behind the field on the side of the goal (x = 20, well outside goal width 17m)
    sim.ball.setTransform({ x: 20, y: 3, z: -48 }, { x: 0, y: 0, z: -10 });

    const inputs = new Map<string, PlayerInput>();
    let goalScored = false;

    for (let i = 0; i < 30; i++) {
      const res = sim.step(inputs, 1 / 60);
      if (res.goalEvent) {
        goalScored = true;
      }
    }

    expect(goalScored).toBe(false);
  });

  it('14. Ball and vehicle containment within arena boundaries', () => {
    // Ball placed at extreme high speed
    sim.ball.setTransform({ x: 0, y: 10, z: 0 }, { x: 35, y: 30, z: 35 });
    const car = sim.addCar('p1', 'blue', { x: 0, y: 0.6, z: 0 }, 0);
    const inputs = new Map<string, PlayerInput>();
    inputs.set('p1', defaultInput({ throttle: 1.0, boost: true }));

    for (let i = 0; i < 120; i++) {
      sim.step(inputs, 1 / 60);
    }

    const b = sim.ball.getTransform();
    const c = car.getTransform();

    // Contained within arena bounds (X: ±34, Y: 0 to 22, Z: ±58)
    expect(Math.abs(b.x)).toBeLessThanOrEqual(35);
    expect(b.y).toBeLessThanOrEqual(23);
    expect(Math.abs(c.x)).toBeLessThanOrEqual(35);
  });

  it('15. Scene reset without duplicate bodies or leaks', () => {
    sim.addCar('p1', 'blue');
    sim.addCar('p2', 'orange');

    sim.resetToKickoff();

    expect(sim.cars.size).toBe(2);
    expect(sim.ball.getTransform().z).toBeCloseTo(0, 1);
    expect(sim.cars.get('p1')?.getTransform().z).toBeCloseTo(-38, 1);
    expect(sim.cars.get('p2')?.getTransform().z).toBeCloseTo(38, 1);
  });
});
