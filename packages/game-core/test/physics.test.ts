import RAPIER from '@dimforge/rapier3d-compat';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ARENA_CONFIG, BALL_CONFIG, CAR_CONFIG, PlayerInput, kickoffSpawn } from '@aerial-arena/shared';
import { GameSimulation, createGameSimulation } from '../src/physicsWorld.js';
import { CarPhysicsHandle } from '../src/car.js';

let seq = 1;
const input = (o: Partial<PlayerInput> = {}): PlayerInput => ({
  seq: seq++, timestamp: 0, throttle: 0, steer: 0, pitch: 0, yaw: 0, roll: 0,
  jump: false, jumpHeld: false, boost: false, powerslide: false, ...o,
});

function run(sim: GameSimulation, id: string, ticks: number, o: Partial<PlayerInput> = {}, each?: () => void) {
  for (let i = 0; i < ticks; i++) {
    sim.tick(new Map([[id, input(o)]]));
    each?.();
  }
}

const speedOf = (car: CarPhysicsHandle) => {
  const t = car.getTransform();
  return Math.hypot(t.vx, t.vy, t.vz);
};

/** Spawn a parked car away from the kickoff ball and let it settle. */
function parked(sim: GameSimulation, x = 0, z = -25, yaw = 0, id = 'p1'): CarPhysicsHandle {
  const car = sim.addCar(id, 'blue', { x, y: CAR_CONFIG.restHeight, z }, yaw);
  run(sim, id, 60);
  return car;
}

function jumpApex(sim: GameSimulation, car: CarPhysicsHandle, holdTicks: number, secondPressAfter?: number, second: Partial<PlayerInput> = {}) {
  let apex = 0;
  const track = () => { apex = Math.max(apex, car.getTransform().y); };
  run(sim, 'p1', 1, { jump: true, jumpHeld: true }, track);
  run(sim, 'p1', holdTicks - 1, { jumpHeld: true }, track);
  if (secondPressAfter !== undefined) {
    run(sim, 'p1', secondPressAfter, {}, track);
    run(sim, 'p1', 1, { jump: true, jumpHeld: true, ...second }, track);
  }
  run(sim, 'p1', 240, {}, track);
  return apex - CAR_CONFIG.restHeight;
}

describe('Car physics (RL-measured targets)', () => {
  let sim: GameSimulation;
  beforeEach(async () => { sim = await createGameSimulation(); });
  afterEach(() => sim.destroy());

  it('parks at the RL rest height with all wheels down', () => {
    const car = parked(sim);
    const t = car.getTransform();
    expect(t.y).toBeCloseTo(CAR_CONFIG.restHeight, 1);
    expect(car.isGrounded()).toBe(true);
    expect(car.wheels.every((w) => w.inContact)).toBe(true);
    expect(speedOf(car)).toBeLessThan(0.1);
  });

  it('throttle alone accelerates to ~14.1 m/s (1410 uu/s) and no further', () => {
    const car = parked(sim, 5, -45);
    run(sim, 'p1', 120, { throttle: 1 });
    expect(car.getTransform().vz).toBeGreaterThan(8);
    run(sim, 'p1', 360, { throttle: 1 });
    expect(car.getTransform().vz).toBeGreaterThan(13.8);
    expect(car.getTransform().vz).toBeLessThan(14.4);
  });

  it('brakes hard, then reverses', () => {
    const car = parked(sim, 0, -40);
    run(sim, 'p1', 240, { throttle: 1 });
    const v0 = car.getTransform().vz;
    run(sim, 'p1', 30, { throttle: -1 }); // 0.25 s at 35 m/s^2 removes ~8.75 m/s
    const v1 = car.getTransform().vz;
    expect(v0 - v1).toBeGreaterThan(7);
    run(sim, 'p1', 180, { throttle: -1 });
    expect(car.getTransform().vz).toBeLessThan(-2);
  });

  it('coasts down slowly without throttle', () => {
    const car = parked(sim, 0, -40);
    run(sim, 'p1', 240, { throttle: 1 });
    const v0 = car.getTransform().vz;
    run(sim, 'p1', 120);
    const dv = v0 - car.getTransform().vz;
    expect(dv).toBeGreaterThan(4); // 5.25 m/s^2 coast
    expect(dv).toBeLessThan(6.5);
  });

  it('boost reaches supersonic and caps at 23 m/s', () => {
    const car = parked(sim, 0, -48);
    car.unlimitedBoost = true;
    let supersonicAt = -1;
    let ticks = 0;
    run(sim, 'p1', 480, { throttle: 1, boost: true }, () => {
      ticks++;
      if (supersonicAt < 0 && car.isSupersonic()) supersonicAt = ticks / 120;
    });
    expect(supersonicAt).toBeGreaterThan(1.0);
    expect(supersonicAt).toBeLessThan(2.5);
    expect(speedOf(car)).toBeLessThanOrEqual(CAR_CONFIG.maxSpeed + 1e-3);
  });

  it('turns tighter at low speed than at high speed (speed-dependent steering)', async () => {
    const radiusAt = async (throttleTicks: number) => {
      const s = await createGameSimulation();
      const car = s.addCar('p1', 'blue', { x: 0, y: CAR_CONFIG.restHeight, z: -20 }, 0);
      run(s, 'p1', 60);
      run(s, 'p1', throttleTicks, { throttle: 1 });
      run(s, 'p1', 60, { throttle: throttleTicks > 100 ? 1 : 0.05, steer: 1 });
      const t = car.getTransform();
      const v = Math.hypot(t.vx, t.vz);
      const r = v / Math.abs(t.wy);
      s.destroy();
      return r;
    };
    const slow = await radiusAt(25);
    const fast = await radiusAt(240);
    expect(slow).toBeLessThan(fast);
    expect(fast).toBeGreaterThan(5);
    expect(fast).toBeLessThan(9);
  });

  it('steer right turns the car to its right (-X when facing +Z)', () => {
    const car = parked(sim, 0, -30);
    run(sim, 'p1', 90, { throttle: 1, steer: 1 });
    expect(car.getTransform().x).toBeLessThan(-0.5);
  });

  it('powerslide lets the car slide sideways much more than normal grip', async () => {
    const slideOf = async (powerslide: boolean) => {
      const s = await createGameSimulation();
      const car = s.addCar('p1', 'blue', { x: 0, y: CAR_CONFIG.restHeight, z: -40 }, 0);
      run(s, 'p1', 60);
      run(s, 'p1', 240, { throttle: 1 });
      let maxSlip = 0;
      run(s, 'p1', 60, { throttle: 1, steer: 1, powerslide }, () => {
        const t = car.getTransform();
        const f = car.forward();
        const v = Math.hypot(t.vx, t.vz);
        const along = (t.vx * f.x + t.vz * f.z) / (v || 1);
        maxSlip = Math.max(maxSlip, Math.acos(Math.min(1, Math.abs(along))));
      });
      s.destroy();
      return maxSlip;
    };
    const grip = await slideOf(false);
    const slide = await slideOf(true);
    expect(slide).toBeGreaterThan(grip * 3);
    expect(slide).toBeGreaterThan(0.2); // > ~11 degrees of drift
  });

  it('jump height: tap < full hold < double jump', () => {
    const tap = jumpApex(sim, parked(sim), 1);
    sim.removeCar('p1');
    const full = jumpApex(sim, parked(sim), 30);
    sim.removeCar('p1');
    const dbl = jumpApex(sim, parked(sim), 30, 5);
    expect(tap).toBeGreaterThan(0.4);
    expect(tap).toBeLessThan(1.0);
    expect(full).toBeGreaterThan(2.0);
    expect(full).toBeLessThan(2.6);
    expect(dbl).toBeGreaterThan(4.2);
    expect(dbl).toBeLessThan(5.0);
  });

  it('forward dodge adds ~5 m/s forward, spins at the 5.5 rad/s cap, and uses the second action', () => {
    const car = parked(sim, 0, -30);
    run(sim, 'p1', 1, { jump: true, jumpHeld: true });
    run(sim, 'p1', 12);
    const vBefore = car.getTransform().vz;
    run(sim, 'p1', 1, { jump: true, jumpHeld: true, pitch: -1 });
    expect(car.isDodging()).toBe(true);
    expect(car.getTransform().vz - vBefore).toBeGreaterThan(4.5);
    let maxSpin = 0;
    run(sim, 'p1', 30, {}, () => {
      const t = car.getTransform();
      maxSpin = Math.max(maxSpin, Math.hypot(t.wx, t.wy, t.wz));
    });
    expect(maxSpin).toBeGreaterThan(5.0);
    expect(maxSpin).toBeLessThanOrEqual(CAR_CONFIG.maxAngularSpeed + 1e-3);
    // A third press in the same airborne cycle does nothing.
    const vyBefore = car.getTransform().vy;
    run(sim, 'p1', 1, { jump: true, jumpHeld: true });
    expect(car.getTransform().vy).toBeLessThan(vyBefore + 0.5);
  });

  it('only one flip at a time: spamming jump during a flip starts nothing new, even after touching down', () => {
    const car = parked(sim, 0, -30);
    run(sim, 'p1', 1, { jump: true, jumpHeld: true });
    run(sim, 'p1', 4); // low hop so the flip touches the ground mid-rotation
    let flips = 0;
    let wasDodging = false;
    let maxVyJump = 0;
    let prevVy = car.getTransform().vy;
    for (let i = 0; i < 70; i++) {
      const press = i % 2 === 0; // mash jump every other tick with forward held
      run(sim, 'p1', 1, { jump: press, jumpHeld: press, pitch: -1, throttle: 1 });
      const vy = car.getTransform().vy;
      if (i > 0) maxVyJump = Math.max(maxVyJump, vy - prevVy);
      prevVy = vy;
      if (car.isDodging() && !wasDodging) flips++;
      wasDodging = car.isDodging();
    }
    expect(flips).toBe(1);
    expect(maxVyJump).toBeLessThan(2); // no new jump impulse (2.9 m/s) during the flip
  });

  it('can flip again after the flip finishes and the car lands', () => {
    const car = parked(sim, 0, -30);
    const flip = () => {
      run(sim, 'p1', 1, { jump: true, jumpHeld: true });
      run(sim, 'p1', 12);
      let started = false;
      run(sim, 'p1', 1, { jump: true, jumpHeld: true, pitch: -1 }, () => { started ||= car.isDodging(); });
      run(sim, 'p1', 180); // finish, land, settle
      return started;
    };
    expect(flip()).toBe(true);
    expect(car.isGrounded()).toBe(true);
    expect(flip()).toBe(true);
  });

  it('second jump expires 1.25 s after the first jump ends', () => {
    const car = parked(sim);
    run(sim, 'p1', 1, { jump: true, jumpHeld: true });
    run(sim, 'p1', 23, { jumpHeld: true }); // hold the full 0.2 s
    run(sim, 'p1', 160); // 1.33 s later, still airborne
    expect(car.isGrounded()).toBe(false);
    const vy = car.getTransform().vy;
    run(sim, 'p1', 1, { jump: true, jumpHeld: true });
    expect(car.getTransform().vy).toBeLessThan(vy + 0.5);
  });

  it('a jump press is consumed once even if the same input repeats across ticks', () => {
    const car = parked(sim);
    const same = input({ jump: true, jumpHeld: false });
    for (let i = 0; i < 6; i++) sim.tick(new Map([['p1', same]]));
    let apex = 0;
    run(sim, 'p1', 240, {}, () => { apex = Math.max(apex, car.getTransform().y); });
    expect(apex - CAR_CONFIG.restHeight).toBeLessThan(1.0); // single tap jump, no double jump
  });

  it('air control: pitch, yaw and roll rotate about the documented axes; roll is fastest', async () => {
    const rate = async (o: Partial<PlayerInput>) => {
      const s = await createGameSimulation();
      const car = s.addCar('p1', 'blue', { x: 0, y: 10, z: -20 }, 0);
      run(s, 'p1', 18, o);
      const t = car.getTransform();
      const q = { x: t.qx, y: t.qy, z: t.qz, w: t.qw };
      // angular velocity in the car's local frame
      const inv = { x: -q.x, y: -q.y, z: -q.z, w: q.w };
      const w = rotate(inv, { x: t.wx, y: t.wy, z: t.wz });
      s.destroy();
      return w; // local: x = left axis (pitch about -right), y = up (yaw), z = forward (roll)
    };
    const noseUp = await rate({ pitch: 1 });
    expect(-noseUp.x).toBeGreaterThan(1); // positive about right (-X) = nose up
    const yawRight = await rate({ yaw: 1 });
    expect(yawRight.y).toBeLessThan(-1); // negative about up = turning right
    const rollRight = await rate({ roll: 1 });
    expect(rollRight.z).toBeGreaterThan(1);
    expect(Math.abs(rollRight.z)).toBeGreaterThan(Math.abs(noseUp.x));
  });

  it('boost drains 33.3 units per second and stops at zero', () => {
    const car = parked(sim, 5, -45);
    car.boostUnits = 100;
    run(sim, 'p1', 120, { boost: true });
    expect(car.boostUnits).toBeGreaterThan(64);
    expect(car.boostUnits).toBeLessThan(69);
    run(sim, 'p1', 400, { boost: true });
    expect(car.boostUnits).toBe(0);
    expect(car.isBoosting()).toBe(false);
  });

  it('a boost tap lasts at least 0.1 s', () => {
    const car = parked(sim, 5, -45);
    car.boostUnits = 100;
    run(sim, 'p1', 1, { boost: true });
    run(sim, 'p1', 20);
    expect(100 - car.boostUnits).toBeGreaterThan(3.2); // >= 0.1 s * 33.3
  });

  it('kickoff boost is 33.3 and pads refill with cooldowns', () => {
    const car = sim.addCar('p1', 'blue');
    expect(car.boostUnits).toBeCloseTo(100 / 3, 1);
    const big = sim.pads.getPadDefs().find((p) => p.type === 'big')!;
    car.reset({ x: big.x, y: CAR_CONFIG.restHeight, z: big.z }, 0, 10);
    run(sim, 'p1', 2);
    expect(car.boostUnits).toBe(100);
    const snap = sim.pads.getSnapshots().find((p) => p.id === big.id)!;
    expect(snap.active).toBe(false);
    expect(snap.cooldownRemaining).toBeGreaterThan(9.5);
    run(sim, 'p1', 121 * 10);
    expect(sim.pads.getSnapshots().find((p) => p.id === big.id)!.active).toBe(true);

    const small = sim.pads.getPadDefs().find((p) => p.type === 'small' && Math.abs(p.z) > 30)!;
    car.reset({ x: small.x, y: CAR_CONFIG.restHeight, z: small.z }, 0, 50);
    run(sim, 'p1', 2);
    expect(car.boostUnits).toBeCloseTo(62, 0);
  });
});

describe('Ball physics', () => {
  let sim: GameSimulation;
  beforeEach(async () => { sim = await createGameSimulation(); });
  afterEach(() => sim.destroy());

  it('rests at the kickoff spot and bounces with restitution ~0.6', () => {
    sim.ball.setTransform({ x: 0, y: 6, z: 0 });
    let bounced = false, prevVy = 0, apex = 0;
    for (let i = 0; i < 480; i++) {
      sim.tick(new Map());
      const b = sim.ball.getTransform();
      if (prevVy < -1 && b.vy > 0) bounced = true;
      if (bounced) apex = Math.max(apex, b.y);
      prevVy = b.vy;
    }
    const expected = BALL_CONFIG.radius + 0.36 * (6 - BALL_CONFIG.radius);
    expect(apex).toBeGreaterThan(expected - 0.4);
    expect(apex).toBeLessThan(expected + 0.4);
  });

  it('a rolling ball slows down but keeps rolling for a while', () => {
    sim.ball.setTransform({ x: 0, y: BALL_CONFIG.restHeight, z: -20 }, { x: 0, y: 0, z: 10 });
    for (let i = 0; i < 120; i++) sim.tick(new Map());
    const b = sim.ball.getTransform();
    expect(b.vz).toBeLessThan(10);
    expect(b.vz).toBeGreaterThan(5);
    expect(Math.hypot(b.wx, b.wy, b.wz)).toBeGreaterThan(1); // rolling, not sliding
  });

  it('a full-speed boosted hit launches the ball faster than the car (RL extra impulse)', () => {
    const car = sim.addCar('p1', 'blue', { x: 0, y: CAR_CONFIG.restHeight, z: -30 }, 0);
    car.unlimitedBoost = true;
    run(sim, 'p1', 60);
    let ballMax = 0, hits = 0;
    for (let i = 0; i < 300; i++) {
      const r = sim.tick(new Map([['p1', input({ throttle: 1, boost: true })]]));
      hits += r.events.filter((e) => e.type === 'ballHit').length;
      const b = sim.ball.getTransform();
      ballMax = Math.max(ballMax, Math.hypot(b.vx, b.vy, b.vz));
    }
    expect(hits).toBeGreaterThan(0);
    expect(ballMax).toBeGreaterThan(27);
    expect(ballMax).toBeLessThanOrEqual(BALL_CONFIG.maxSpeed);
  });

  it('a slow push dribbles instead of launching', () => {
    const car = sim.addCar('p1', 'blue', { x: 0, y: CAR_CONFIG.restHeight, z: -6 }, 0);
    run(sim, 'p1', 60);
    let ballMax = 0;
    run(sim, 'p1', 240, { throttle: 0.3 }, () => {
      const b = sim.ball.getTransform();
      ballMax = Math.max(ballMax, Math.hypot(b.vx, b.vz));
    });
    expect(ballMax).toBeGreaterThan(0.5);
    expect(ballMax).toBeLessThan(10);
  });

  it('rebounds off the side wall', () => {
    sim.ball.setTransform({ x: 30, y: 6, z: 0 }, { x: 20, y: 0, z: 0 });
    for (let i = 0; i < 120; i++) sim.tick(new Map());
    const b = sim.ball.getTransform();
    expect(b.vx).toBeLessThan(-5);
    expect(b.x).toBeLessThan(ARENA_CONFIG.halfWidth - BALL_CONFIG.radius + 0.05);
  });

  it('rolls up the curved floor-to-wall ramp instead of hitting a step', () => {
    sim.ball.setTransform({ x: 30, y: BALL_CONFIG.restHeight, z: 0 }, { x: 15, y: 0, z: 0 });
    let maxY = 0, minSpeed = 99;
    for (let i = 0; i < 150; i++) {
      sim.tick(new Map());
      const b = sim.ball.getTransform();
      maxY = Math.max(maxY, b.y);
      if (b.y < 2) minSpeed = Math.min(minSpeed, Math.hypot(b.vx, b.vy, b.vz));
    }
    expect(maxY).toBeGreaterThan(4); // climbed the wall
    expect(minSpeed).toBeGreaterThan(8); // no abrupt stop at the seam
  });
});

describe('Goals', () => {
  let sim: GameSimulation;
  beforeEach(async () => { sim = await createGameSimulation(); });
  afterEach(() => sim.destroy());

  it('a 60 m/s shot scores exactly once for the attacking team', () => {
    sim.ball.setTransform({ x: 0, y: 2, z: 40 }, { x: 0, y: 0, z: 60 });
    const goals = [];
    for (let i = 0; i < 120; i++) {
      const r = sim.tick(new Map());
      if (r.goalEvent) goals.push(r.goalEvent);
    }
    expect(goals).toHaveLength(1);
    expect(goals[0].scorer).toBe('blue');
    expect(Math.abs(sim.ball.getTransform().z)).toBeLessThan(ARENA_CONFIG.halfLength + ARENA_CONFIG.goalDepth);
  });

  it('a ball sitting on the goal line (not fully over) is not a goal', () => {
    sim.ball.setTransform({ x: 0, y: BALL_CONFIG.restHeight, z: -(ARENA_CONFIG.halfLength + BALL_CONFIG.radius * 0.5) });
    let scored = false;
    for (let i = 0; i < 10; i++) if (sim.tick(new Map()).goalEvent) scored = true;
    expect(scored).toBe(false);
  });

  it('a shot off the post/wall beside the goal bounces back without scoring', () => {
    const x = ARENA_CONFIG.goalHalfWidth + BALL_CONFIG.radius * 0.6;
    sim.ball.setTransform({ x, y: 2, z: -40 }, { x: 0, y: 0, z: -30 });
    let scored = false;
    for (let i = 0; i < 120; i++) if (sim.tick(new Map()).goalEvent) scored = true;
    expect(scored).toBe(false);
    expect(sim.ball.getTransform().vz).toBeGreaterThan(0);
  });

  it('a ball lingering inside the goal only counts once', () => {
    sim.ball.setTransform({ x: 0, y: 2, z: 47 }, { x: 0, y: 0, z: 15 });
    let count = 0;
    for (let i = 0; i < 600; i++) if (sim.tick(new Map()).goalEvent) count++;
    expect(count).toBe(1);
  });
});

describe('Walls, ceiling and containment', () => {
  let sim: GameSimulation;
  beforeEach(async () => { sim = await createGameSimulation(); });
  afterEach(() => sim.destroy());

  it('drives from the floor up the curved side wall and stays attached', () => {
    const car = parked(sim, 25, 0, Math.PI / 2); // facing +X toward the wall
    let onWallTicks = 0;
    run(sim, 'p1', 300, { throttle: 1 }, () => {
      const t = car.getTransform();
      if (car.isGrounded() && t.y > 3) onWallTicks++;
    });
    expect(onWallTicks).toBeGreaterThan(30);
  });

  /** Drive at the +X wall until the car is attached above `height`. */
  function driveOntoWall(car: CarPhysicsHandle, height: number) {
    for (let guard = 0; guard < 600; guard++) {
      if (car.isGrounded() && car.getTransform().y > height) return;
      run(sim, 'p1', 1, { throttle: 1 });
    }
    throw new Error(`car never reached the wall (y=${car.getTransform().y.toFixed(2)})`);
  }

  it('can steer along the side wall (car right = +Z when facing up the +X wall)', () => {
    const car = parked(sim, 25, -10, Math.PI / 2);
    driveOntoWall(car, 2);
    const z0 = car.getTransform().z;
    let groundedHigh = 0;
    run(sim, 'p1', 60, { throttle: 1, steer: 1 }, () => {
      if (car.isGrounded() && car.getTransform().y > 1.5) groundedHigh++;
    });
    expect(groundedHigh).toBeGreaterThan(40);
    expect(car.getTransform().z - z0).toBeGreaterThan(2);
  });

  it('jumping off a wall pushes the car away from the wall', () => {
    const car = parked(sim, 25, 0, Math.PI / 2);
    driveOntoWall(car, 3);
    run(sim, 'p1', 1, { jump: true, jumpHeld: true, throttle: 1 });
    run(sim, 'p1', 10, { jumpHeld: true });
    expect(car.getTransform().vx).toBeLessThan(-1); // away from the +X wall
  });

  it('does not stick to the ceiling (sticky force is weaker than gravity there)', () => {
    const car = sim.addCar('p1', 'blue', { x: 0, y: ARENA_CONFIG.height - 0.2, z: -20 }, 0);
    car.body.setRotation({ x: 0, y: 0, z: 1, w: 0 }, true); // upside down against the ceiling
    run(sim, 'p1', 240, { throttle: 1 });
    expect(car.getTransform().y).toBeLessThan(ARENA_CONFIG.height - 3);
  });

  it('a car upside down on the floor flips itself over when jumping', () => {
    const car = sim.addCar('p1', 'blue', { x: 0, y: 0.6, z: -20 }, 0);
    car.body.setRotation({ x: 0, y: 0, z: 1, w: 0 }, true);
    run(sim, 'p1', 120);
    for (let attempt = 0; attempt < 3 && !car.isGrounded(); attempt++) {
      run(sim, 'p1', 1, { jump: true, jumpHeld: true });
      run(sim, 'p1', 180);
    }
    expect(car.isGrounded()).toBe(true);
  });

  it('keeps cars and ball inside the arena through chaotic play', () => {
    const car = sim.addCar('p1', 'blue');
    car.unlimitedBoost = true;
    let rng = 12345;
    const rand = () => ((rng = (rng * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff) * 2 - 1;
    for (let i = 0; i < 120 * 20; i++) {
      const o = i % 30 === 0
        ? { throttle: rand(), steer: rand(), pitch: rand(), yaw: rand(), roll: rand(), boost: rand() > -0.3, jump: rand() > 0.6, jumpHeld: rand() > 0 }
        : {};
      sim.tick(new Map([['p1', input(o)]]));
      if (i % 600 === 0) sim.ball.setTransform(sim.ball.getTransform(), { x: rand() * 50, y: rand() * 30, z: rand() * 50 });
    }
    const inside = (p: { x: number; y: number; z: number }) =>
      Math.abs(p.x) < ARENA_CONFIG.halfWidth + 0.1 &&
      p.y > -0.1 && p.y < ARENA_CONFIG.height + 0.1 &&
      Math.abs(p.z) < ARENA_CONFIG.halfLength + ARENA_CONFIG.goalDepth + 0.1;
    expect(inside(sim.ball.getTransform())).toBe(true);
    expect(inside(car.getTransform())).toBe(true);
  });
});

describe('Car-car contact', () => {
  let sim: GameSimulation;
  beforeEach(async () => { sim = await createGameSimulation(); });
  afterEach(() => sim.destroy());

  it('a supersonic hit demolishes the opponent, who respawns after 3 s', () => {
    const a = sim.addCar('a', 'blue', { x: 20, y: CAR_CONFIG.restHeight, z: -45 }, 0);
    const b = sim.addCar('b', 'orange', { x: 20, y: CAR_CONFIG.restHeight, z: 0 }, 0);
    a.unlimitedBoost = true;
    let demo = false;
    for (let i = 0; i < 600 && !demo; i++) {
      const r = sim.tick(new Map([['a', input({ throttle: 1, boost: true })]]));
      if (r.events.some((e) => e.type === 'demolition')) demo = true;
    }
    expect(demo).toBe(true);
    expect(b.isDemoed).toBe(true);
    for (let i = 0; i < 121 * 3; i++) sim.tick(new Map());
    expect(b.isDemoed).toBe(false);
    expect(b.getTransform().z).toBeGreaterThan(40); // orange respawn behind its goal line area
  });

  it('a slower front hit bumps instead of demolishing', () => {
    const a = sim.addCar('a', 'blue', { x: 20, y: CAR_CONFIG.restHeight, z: -20 }, 0);
    const b = sim.addCar('b', 'orange', { x: 20, y: CAR_CONFIG.restHeight, z: -8 }, 0);
    let bump = false;
    for (let i = 0; i < 400 && !bump; i++) {
      const r = sim.tick(new Map([['a', input({ throttle: 1 })]]));
      if (r.events.some((e) => e.type === 'bump')) bump = true;
    }
    expect(bump).toBe(true);
    expect(b.isDemoed).toBe(false);
    expect(b.getTransform().vz).toBeGreaterThan(5);
  });
});

describe('Kickoff and reset', () => {
  it('kickoff spawns are mirrored through the center and face the ball', async () => {
    const sim = await createGameSimulation();
    sim.addCar('b', 'blue');
    sim.addCar('o', 'orange');
    for (let i = 0; i < 5; i++) {
      sim.resetToKickoff(i);
      const tb = sim.cars.get('b')!.getTransform();
      const to = sim.cars.get('o')!.getTransform();
      expect(tb.x).toBeCloseTo(-to.x, 3);
      expect(tb.z).toBeCloseTo(-to.z, 3);
      const fb = sim.cars.get('b')!.forward();
      const toBall = Math.hypot(tb.x, tb.z);
      expect((-tb.x * fb.x - tb.z * fb.z) / toBall).toBeGreaterThan(0.99);
      const s = kickoffSpawn('blue', i);
      expect(tb.z).toBeCloseTo(s.z, 3);
    }
    sim.destroy();
  });

  it('resets without duplicating rigid bodies', async () => {
    const sim = await createGameSimulation();
    sim.addCar('p1', 'blue');
    sim.addCar('p2', 'orange');
    const bodies = sim.world.bodies.len();
    const colliders = sim.world.colliders.len();
    for (let i = 0; i < 5; i++) {
      sim.resetToKickoff(i);
      sim.addCar('p1', 'blue');
      for (let k = 0; k < 10; k++) sim.tick(new Map());
    }
    expect(sim.world.bodies.len()).toBe(bodies);
    expect(sim.world.colliders.len()).toBe(colliders);
    sim.removeCar('p2');
    expect(sim.world.bodies.len()).toBe(bodies - 1);
    sim.destroy();
  });
});

describe('Arena collision geometry', () => {
  it('has an open goal mouth and a solid back wall', async () => {
    const sim = await createGameSimulation();
    sim.tick(new Map()); // build query pipeline
    const cast = (o: { x: number; y: number; z: number }, d: { x: number; y: number; z: number }) =>
      sim.world.castRay(new RAPIER.Ray(o, d), 100, true, RAPIER.QueryFilterFlags.EXCLUDE_DYNAMIC);
    const toGoalBack = cast({ x: 0, y: 3, z: 40 }, { x: 0, y: 0, z: 1 });
    expect(toGoalBack!.timeOfImpact).toBeCloseTo(ARENA_CONFIG.halfLength + ARENA_CONFIG.goalDepth - 40, 1);
    const besideGoal = cast({ x: ARENA_CONFIG.goalHalfWidth + 3, y: 3, z: 40 }, { x: 0, y: 0, z: 1 });
    expect(besideGoal!.timeOfImpact).toBeLessThan(ARENA_CONFIG.halfLength - 40 + 0.01);
    const aboveGoal = cast({ x: 0, y: ARENA_CONFIG.goalHeight + 1, z: 40 }, { x: 0, y: 0, z: 1 });
    expect(aboveGoal!.timeOfImpact).toBeCloseTo(ARENA_CONFIG.halfLength - 40, 1);
    sim.destroy();
  });

  it('floor-to-wall ramp normals change smoothly (no seams)', async () => {
    const sim = await createGameSimulation();
    sim.tick(new Map());
    let prevAngle = -1;
    let maxJump = 0;
    for (let y = 0.05; y < 4; y += 0.1) {
      const hit = sim.world.castRayAndGetNormal(new RAPIER.Ray({ x: 30, y, z: 5 }, { x: 1, y: 0, z: 0 }), 20, true, RAPIER.QueryFilterFlags.EXCLUDE_DYNAMIC);
      if (!hit) continue;
      const angle = Math.atan2(-hit.normal.x, hit.normal.y);
      if (prevAngle >= 0) maxJump = Math.max(maxJump, Math.abs(angle - prevAngle));
      prevAngle = angle;
    }
    expect(maxJump).toBeLessThan(0.35);
    sim.destroy();
  });
});

function rotate(q: { x: number; y: number; z: number; w: number }, v: { x: number; y: number; z: number }) {
  const ix = q.w * v.x + q.y * v.z - q.z * v.y;
  const iy = q.w * v.y + q.z * v.x - q.x * v.z;
  const iz = q.w * v.z + q.x * v.y - q.y * v.x;
  const iw = -q.x * v.x - q.y * v.y - q.z * v.z;
  return {
    x: ix * q.w + iw * -q.x + iy * -q.z - iz * -q.y,
    y: iy * q.w + iw * -q.y + iz * -q.x - ix * -q.z,
    z: iz * q.w + iw * -q.z + ix * -q.y - iy * -q.x,
  };
}
