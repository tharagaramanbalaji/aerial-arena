import RAPIER from '@dimforge/rapier3d-compat';
import {
  ARENA_CONFIG,
  ArenaConfig,
  BALL_CONFIG,
  BallConfig,
  CAR_CONFIG,
  CarConfig,
  MATCH_CONFIG,
  PlayerInput,
  Team,
  Vec3,
} from '@aerial-arena/shared';
import { ArenaPhysicsHandles, buildArenaColliders } from './arena.js';
import { BallPhysicsHandle, createBall } from './ball.js';
import { BoostPadsManager, createBoostPadsManager } from './boostPads.js';
import { CarPhysicsHandle, createCar } from './car.js';
import { GoalDetector, createGoalDetector } from './goal.js';

export interface GameSimulation {
  world: RAPIER.World;
  arena: ArenaPhysicsHandles;
  ball: BallPhysicsHandle;
  cars: Map<string, CarPhysicsHandle>;
  pads: BoostPadsManager;
  goalDetector: GoalDetector;
  tickCount: number;
  step(playerInputs: Map<string, PlayerInput>, dt: number): {
    substepsRun: number;
    goalEvent?: { scorer: Team; pos: Vec3 };
  };
  addCar(id: string, team: Team, initialPos?: Vec3, initialYaw?: number): CarPhysicsHandle;
  removeCar(id: string): void;
  resetToKickoff(): void;
  destroy(): void;
}

let rapierInitialized = false;

export async function ensureRapierInitialized(): Promise<void> {
  if (!rapierInitialized) {
    await RAPIER.init();
    rapierInitialized = true;
  }
}

export async function createGameSimulation(
  arenaConfig: ArenaConfig = ARENA_CONFIG,
  ballConfig: BallConfig = BALL_CONFIG,
  carConfig: CarConfig = CAR_CONFIG
): Promise<GameSimulation> {
  await ensureRapierInitialized();

  const gravity = { x: 0, y: ballConfig.gravity, z: 0 };
  const world = new RAPIER.World(gravity);

  const arena = buildArenaColliders(world, arenaConfig);
  const ball = createBall(world, { x: 0, y: ballConfig.radius, z: 0 }, ballConfig);
  const cars = new Map<string, CarPhysicsHandle>();
  const goalDetector = createGoalDetector(arenaConfig, ballConfig);
  const pads = createBoostPadsManager();

  let tickCount = 0;
  let accumulator = 0;
  const fixedDt = MATCH_CONFIG.fixedDeltaTime;
  let prevBallPos: Vec3 = ball.getTransform();

  const addCar = (
    id: string,
    team: Team,
    initialPos: Vec3 = { x: 0, y: 0.6, z: team === 'blue' ? -38 : 38 },
    initialYaw = team === 'blue' ? 0 : Math.PI
  ): CarPhysicsHandle => {
    if (cars.has(id)) {
      const existing = cars.get(id)!;
      existing.reset(initialPos, initialYaw);
      return existing;
    }
    const car = createCar(world, id, team, initialPos, initialYaw, carConfig);
    cars.set(id, car);
    return car;
  };

  const removeCar = (id: string) => {
    const car = cars.get(id);
    if (car) {
      world.removeCollider(car.chassisCollider, false);
      world.removeCollider(car.cabinCollider, false);
      world.removeRigidBody(car.body);
      cars.delete(id);
    }
  };

  const resetToKickoff = () => {
    ball.reset({ x: 0, y: ballConfig.radius, z: 0 });
    prevBallPos = ball.getTransform();
    pads.reset();
    goalDetector.reset();

    for (const car of cars.values()) {
      const z = car.team === 'blue' ? -38 : 38;
      const yaw = car.team === 'blue' ? 0 : Math.PI;
      car.reset({ x: 0, y: 0.6, z }, yaw);
    }
  };

  const step = (
    playerInputs: Map<string, PlayerInput>,
    dt: number
  ): { substepsRun: number; goalEvent?: { scorer: Team; pos: Vec3 } } => {
    accumulator += dt;

    // Bounded accumulator: maximum 4 substeps per frame to avoid death spirals
    const maxSubsteps = 4;
    let substepsRun = 0;
    let detectedGoal: { scorer: Team; pos: Vec3 } | undefined;

    while (accumulator >= fixedDt && substepsRun < maxSubsteps) {
      accumulator -= fixedDt;
      substepsRun++;
      tickCount++;

      // 1. Apply inputs to cars
      for (const [id, car] of cars.entries()) {
        const input = playerInputs.get(id) || {
          seq: 0,
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
        };
        car.update(input, fixedDt);
      }

      // 2. Advance Rapier physics world by 1/60s
      world.step();

      // 3. Update boost pads
      const carArray = Array.from(cars.values());
      pads.update(carArray, fixedDt);

      // 4. Swept goal detection
      const currBallPos = ball.getTransform();
      const goalRes = goalDetector.check(prevBallPos, currBallPos);
      if (goalRes.scored && goalRes.scorer && !detectedGoal) {
        detectedGoal = {
          scorer: goalRes.scorer,
          pos: goalRes.scoringPosition || currBallPos,
        };
      }
      prevBallPos = currBallPos;
    }

    // Drop excess time if spiral was hit
    if (accumulator > fixedDt) {
      accumulator = 0;
    }

    return { substepsRun, goalEvent: detectedGoal };
  };

  const destroy = () => {
    world.free();
  };

  return {
    world,
    arena,
    ball,
    cars,
    pads,
    goalDetector,
    get tickCount() { return tickCount; },
    step,
    addCar,
    removeCar,
    resetToKickoff,
    destroy,
  };
}
