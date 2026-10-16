import RAPIER from '@dimforge/rapier3d-compat';
import {
  ARENA_CONFIG,
  ArenaConfig,
  BALL_CONFIG,
  BallConfig,
  CAR_CONFIG,
  CarConfig,
  GameEvent,
  PHYSICS_CONFIG,
  PlayerInput,
  Team,
  TransformSnapshot,
  UU,
  Vec3,
  evalCurve,
  kickoffSpawn,
} from '@aerial-arena/shared';
import { ArenaPhysicsHandles, buildArenaColliders } from './arena.js';
import { BallPhysicsHandle, createBall } from './ball.js';
import { BoostPadsManager, createBoostPadsManager } from './boostPads.js';
import { CarPhysicsHandle, createCar } from './car.js';
import { GoalDetector, createGoalDetector } from './goal.js';

export type SimEvent = GameEvent;

export interface StepResult {
  substepsRun: number;
  goalEvent?: { scorer: Team; pos: Vec3 };
  events: SimEvent[];
}

export interface GameSimulation {
  world: RAPIER.World;
  arena: ArenaPhysicsHandles;
  ball: BallPhysicsHandle;
  cars: Map<string, CarPhysicsHandle>;
  pads: BoostPadsManager;
  goalDetector: GoalDetector;
  readonly tickCount: number;
  /** 0..1 progress from the previous physics tick to the current one (for render interpolation). */
  readonly interpolationAlpha: number;
  /** Transforms at the start of the most recent tick, keyed by car id; ball under BALL_KEY. */
  readonly previousTransforms: ReadonlyMap<string, TransformSnapshot>;
  /** Advance by wall-clock dt using a fixed-step accumulator. */
  step(playerInputs: Map<string, PlayerInput>, dt: number): StepResult;
  /** Run exactly one fixed physics tick. */
  tick(playerInputs: Map<string, PlayerInput>): StepResult;
  addCar(id: string, team: Team, initialPos?: Vec3, initialYaw?: number): CarPhysicsHandle;
  removeCar(id: string): void;
  /** Reset ball, pads and cars to a kickoff. Returns the spawn index used. */
  resetToKickoff(spawnIndex?: number): number;
  destroy(): void;
}

export const BALL_KEY = '__ball__';

const DEMO_RESPAWN_SEC = 3;
// RL respawn spots for the blue side (mirrored for orange), meters / our yaw.
const RESPAWNS = [-2304, -2688, 2304, 2688].map((x) => ({ x: x * UU, z: -4608 * UU }));

let rapierInitialized = false;

export async function ensureRapierInitialized(): Promise<void> {
  if (!rapierInitialized) {
    await RAPIER.init();
    rapierInitialized = true;
  }
}

const NEUTRAL_INPUT: PlayerInput = {
  seq: 0,
  timestamp: 0,
  throttle: 0,
  steer: 0,
  pitch: 0,
  yaw: 0,
  roll: 0,
  jump: false,
  jumpHeld: false,
  boost: false,
  powerslide: false,
};

export async function createGameSimulation(
  arenaConfig: ArenaConfig = ARENA_CONFIG,
  ballConfig: BallConfig = BALL_CONFIG,
  carConfig: CarConfig = CAR_CONFIG
): Promise<GameSimulation> {
  await ensureRapierInitialized();

  const fixedDt = PHYSICS_CONFIG.fixedDeltaTime;
  const world = new RAPIER.World({ x: 0, y: PHYSICS_CONFIG.gravity, z: 0 });
  world.timestep = fixedDt;

  const arena = buildArenaColliders(world, arenaConfig);
  const ball = createBall(world, { x: 0, y: ballConfig.restHeight, z: 0 }, ballConfig);
  const cars = new Map<string, CarPhysicsHandle>();
  const goalDetector = createGoalDetector(arenaConfig, ballConfig);
  const pendingPadEvents: SimEvent[] = [];
  const pads = createBoostPadsManager(undefined, (padId, car) => pendingPadEvents.push({ type: 'padPickup', padId, carId: car.id }));

  let tickCount = 0;
  let accumulator = 0;
  const previousTransforms = new Map<string, TransformSnapshot>();
  const lastExtraImpulseTick = new Map<string, number>();
  let respawnCounter = 0;

  const addCar = (id: string, team: Team, initialPos?: Vec3, initialYaw?: number): CarPhysicsHandle => {
    const spawn = kickoffSpawn(team, 4);
    const pos = initialPos ?? { x: spawn.x, y: spawn.y, z: spawn.z };
    const yaw = initialYaw ?? spawn.yaw;
    const existing = cars.get(id);
    if (existing) {
      existing.reset(pos, yaw);
      return existing;
    }
    const car = createCar(world, id, team, pos, yaw, carConfig);
    cars.set(id, car);
    return car;
  };

  const removeCar = (id: string) => {
    const car = cars.get(id);
    if (!car) return;
    world.removeRigidBody(car.body); // also removes attached colliders
    cars.delete(id);
    previousTransforms.delete(id);
    lastExtraImpulseTick.delete(id);
  };

  const resetToKickoff = (spawnIndex: number = Math.floor(Math.random() * 5)): number => {
    ball.reset({ x: 0, y: ballConfig.restHeight, z: 0 });
    pads.reset();
    goalDetector.reset();
    lastExtraImpulseTick.clear();
    pendingBallImpulses.length = 0;
    for (const car of cars.values()) {
      const s = kickoffSpawn(car.team, spawnIndex);
      car.reset({ x: s.x, y: s.y, z: s.z }, s.yaw);
    }
    return spawnIndex;
  };

  /**
   * RL "extra impulse": the ball gets extra velocity along the hit direction on top of the
   * rigid-body response. Computed from the pre-contact relative velocity; returned so the
   * caller can add it one tick later, after Rapier has fully resolved the (often speculative)
   * first contact. Applying it immediately lets the next tick's rigid contact absorb it.
   */
  const computeBallHit = (carPos: Vec3, carVel: Vec3, carFwd: Vec3, ballPos: Vec3, ballVel: Vec3): { dv: Vec3; relSpeed: number } | null => {
    const relPos = { x: ballPos.x - carPos.x, y: ballPos.y - carPos.y, z: ballPos.z - carPos.z };
    const relVel = { x: ballVel.x - carVel.x, y: ballVel.y - carVel.y, z: ballVel.z - carVel.z };
    const relSpeed = Math.min(Math.hypot(relVel.x, relVel.y, relVel.z), ballConfig.hitMaxRelSpeed);
    if (relSpeed <= 0) return null;
    let hx = relPos.x;
    let hy = relPos.y * ballConfig.hitZScale;
    let hz = relPos.z;
    let l = Math.hypot(hx, hy, hz) || 1;
    hx /= l; hy /= l; hz /= l;
    const along = (hx * carFwd.x + hy * carFwd.y + hz * carFwd.z) * (1 - ballConfig.hitForwardScale);
    hx -= carFwd.x * along; hy -= carFwd.y * along; hz -= carFwd.z * along;
    l = Math.hypot(hx, hy, hz) || 1;
    const k = (relSpeed * evalCurve(ballConfig.hitFactorCurve, relSpeed)) / l;
    return { dv: { x: hx * k, y: hy * k, z: hz * k }, relSpeed };
  };
  const pendingBallImpulses: Vec3[] = [];

  const isOutside = (p: Vec3, margin: number): boolean => {
    const W = arenaConfig.halfWidth, L = arenaConfig.halfLength;
    if (p.y < -margin || p.y > arenaConfig.height + margin) return true;
    if (Math.abs(p.x) > W + margin) return true;
    if (Math.abs(p.z) <= L + margin) return Math.abs(p.x) + Math.abs(p.z) > W + L - arenaConfig.cornerCut + 1.5 * margin;
    // Beyond the goal line only the goal box is valid space.
    return Math.abs(p.z) > L + arenaConfig.goalDepth + margin || Math.abs(p.x) > arenaConfig.goalHalfWidth + margin || p.y > arenaConfig.goalHeight + margin;
  };

  const touching = (a: RAPIER.Collider, b: RAPIER.Collider): boolean => {
    let hit = false;
    world.contactPair(a, b, (manifold) => {
      for (let i = 0; i < manifold.numContacts(); i++) {
        if (manifold.contactDist(i) <= 0.02) hit = true;
      }
    });
    return hit;
  };

  const tick = (playerInputs: Map<string, PlayerInput>): StepResult => {
    const events: SimEvent[] = [];
    let goalEvent: StepResult['goalEvent'];
    tickCount++;

    // Snapshot pre-step state (render interpolation + contact responses).
    const prevBall = ball.getTransform();
    previousTransforms.set(BALL_KEY, prevBall);
    const pre = new Map<string, { pos: Vec3; vel: Vec3; fwd: Vec3; speed: number; supersonic: boolean; grounded: boolean }>();
    for (const [id, car] of cars) {
      car.preStep(playerInputs.get(id) ?? NEUTRAL_INPUT, fixedDt);
      const t = car.getTransform();
      previousTransforms.set(id, t);
      const fwd = car.forward();
      pre.set(id, {
        pos: { x: t.x, y: t.y, z: t.z },
        vel: { x: t.vx, y: t.vy, z: t.vz },
        fwd,
        speed: t.vx * fwd.x + t.vy * fwd.y + t.vz * fwd.z,
        supersonic: car.isSupersonic(),
        grounded: car.isGrounded(),
      });
    }

    world.step();

    // Extra hit impulses detected last tick land now, after the rigid contact resolved.
    if (pendingBallImpulses.length > 0) {
      const v = ball.body.linvel();
      let { x, y, z } = v;
      for (const dv of pendingBallImpulses.splice(0)) {
        x += dv.x; y += dv.y; z += dv.z;
      }
      ball.body.setLinvel({ x, y, z }, true);
    }

    // Car-ball touches
    for (const [id, car] of cars) {
      if (car.isDemoed || !touching(car.hitbox, ball.collider)) continue;
      const last = lastExtraImpulseTick.get(id) ?? -10;
      if (tickCount > last + 1) {
        lastExtraImpulseTick.set(id, tickCount);
        const p = pre.get(id)!;
        const hit = computeBallHit(p.pos, p.vel, p.fwd, prevBall, { x: prevBall.vx, y: prevBall.vy, z: prevBall.vz });
        if (hit) pendingBallImpulses.push(hit.dv);
        events.push({ type: 'ballHit', carId: id, speed: hit?.relSpeed ?? 0 });
      }
    }

    // Car-car bumps and demolitions
    const list = Array.from(cars.values());
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const a = list[i];
        const b = list[j];
        if (a.isDemoed || b.isDemoed || !touching(a.hitbox, b.hitbox)) continue;
        for (const [att, vic] of [[a, b], [b, a]] as const) {
          if (att.bumpCooldown > 0 || att.team === vic.team) continue;
          const pa = pre.get(att.id)!;
          const pv = pre.get(vic.id)!;
          const dx = pv.pos.x - pa.pos.x;
          const dz = pv.pos.z - pa.pos.z;
          const dl = Math.hypot(dx, pv.pos.y - pa.pos.y, dz) || 1;
          const facing = (dx * pa.fwd.x + (pv.pos.y - pa.pos.y) * pa.fwd.y + dz * pa.fwd.z) / dl;
          if (facing < 0.6 || pa.speed < 1) continue;
          att.bumpCooldown = carConfig.bumpCooldown;
          if (pa.supersonic) {
            const vp = vic.body.translation();
            const r = RESPAWNS[respawnCounter++ % RESPAWNS.length];
            const mirror = vic.team === 'blue' ? 1 : -1;
            vic.setRespawn({ x: r.x * mirror, y: carConfig.restHeight + 0.2, z: r.z * mirror }, vic.team === 'blue' ? 0 : Math.PI);
            vic.demolish(DEMO_RESPAWN_SEC);
            events.push({ type: 'demolition', attackerId: att.id, victimId: vic.id, pos: { x: vp.x, y: vp.y, z: vp.z } });
          } else {
            const h = Math.hypot(dx, dz) || 1;
            const horiz = evalCurve(pv.grounded ? carConfig.bumpGroundCurve : carConfig.bumpAirCurve, pa.speed);
            const upV = evalCurve(carConfig.bumpUpCurve, pa.speed);
            const v = vic.body.linvel();
            vic.body.setLinvel({ x: v.x + (dx / h) * horiz, y: v.y + upV, z: v.z + (dz / h) * horiz }, true);
            events.push({ type: 'bump', attackerId: att.id, victimId: vic.id });
          }
        }
      }
    }

    for (const car of cars.values()) car.postStep(fixedDt);
    ball.clampVelocities();

    // Fail-safe: if a body ever tunnels out of the arena, put it back instead of losing it.
    for (const car of cars.values()) {
      if (!car.isDemoed && isOutside(car.body.translation(), 0.6)) {
        const s = kickoffSpawn(car.team, 4);
        car.reset({ x: s.x, y: s.y, z: s.z }, s.yaw, car.boostUnits);
      }
    }
    if (isOutside(ball.body.translation(), ballConfig.radius)) ball.reset({ x: 0, y: ballConfig.restHeight, z: 0 });

    pads.update(Array.from(cars.values()), fixedDt);
    events.push(...pendingPadEvents.splice(0));

    const currBall = ball.getTransform();
    const goalRes = goalDetector.check(prevBall, currBall);
    if (goalRes.scored && goalRes.scorer) {
      goalEvent = { scorer: goalRes.scorer, pos: goalRes.scoringPosition ?? currBall };
    }
    return { substepsRun: 1, goalEvent, events };
  };

  const step = (playerInputs: Map<string, PlayerInput>, dt: number): StepResult => {
    accumulator += Math.max(0, dt);
    let substepsRun = 0;
    let goalEvent: StepResult['goalEvent'];
    const events: SimEvent[] = [];
    while (accumulator >= fixedDt && substepsRun < PHYSICS_CONFIG.maxSubstepsPerFrame) {
      accumulator -= fixedDt;
      substepsRun++;
      const r = tick(playerInputs);
      events.push(...r.events);
      if (r.goalEvent && !goalEvent) goalEvent = r.goalEvent;
    }
    // Drop backlog we could not simulate (prevents a death spiral after a stall).
    if (accumulator > fixedDt) accumulator = accumulator % fixedDt;
    return { substepsRun, goalEvent, events };
  };

  return {
    world,
    arena,
    ball,
    cars,
    pads,
    goalDetector,
    get tickCount() { return tickCount; },
    get interpolationAlpha() { return Math.min(1, accumulator / fixedDt); },
    previousTransforms,
    step,
    tick,
    addCar,
    removeCar,
    resetToKickoff,
    destroy: () => world.free(),
  };
}
