import {
  GameSimulation,
  MatchStateEvent,
  MatchStateMachine,
  StepResult,
  createGameSimulation,
  createMatchStateMachine,
} from '@aerial-arena/game-core';
import { ARENA_CONFIG, BALL_CONFIG, PlayerInput } from '@aerial-arena/shared';

/**
 * Local 1v1 against a bot: same simulation and match rules (countdown, 5:00 clock,
 * overtime) as online play, run entirely in the browser. Player = Blue, bot = Orange.
 */
export class BotMatchManager {
  public sim!: GameSimulation;
  public readonly sm: MatchStateMachine = createMatchStateMachine();
  public readonly playerId = 'local-player';
  public readonly botId = 'bot';
  private bot = new BotBrain();

  async initialize(): Promise<void> {
    this.sim = await createGameSimulation();
    this.sim.addCar(this.playerId, 'blue');
    this.sim.addCar(this.botId, 'orange');
    this.sim.resetToKickoff();
  }

  get car() {
    return this.sim.cars.get(this.playerId)!;
  }

  step(input: PlayerInput, dt: number): { result: StepResult; events: MatchStateEvent[] } {
    const p = this.sm.phase;
    const locked = p === 'countdown' || p === 'goalPause' || p === 'overtimeCountdown' || p === 'ended';
    const inputs = new Map<string, PlayerInput>();
    if (!locked) {
      inputs.set(this.playerId, input);
      inputs.set(this.botId, this.bot.think(this.sim, this.botId, dt));
    }
    const result = this.sim.step(inputs, dt);
    const grounded = this.sim.ball.getTransform().y <= BALL_CONFIG.restHeight + 0.05;
    const events = this.sm.update(dt, grounded, result.goalEvent);
    for (const e of events) {
      if (e.type === 'phase_change' && (e.phase === 'countdown' || e.phase === 'overtimeCountdown')) this.sim.resetToKickoff();
    }
    return { result, events };
  }

  destroy(): void {
    this.sim.destroy();
  }
}

/**
 * Simple rule-based opponent (Orange attacks the -Z goal, defends +Z):
 *  - Attack: drive to a point behind the predicted ball, lined up with the target goal.
 *  - Defend: if the ball is past the bot toward its own goal, rotate back to the goal.
 *  - Boost on long straights, powerslide on sharp turns, jump for high balls, flip into close shots.
 */
class BotBrain {
  private seq = 0;
  private jumpTimer = -1; // >= 0 while a jump/flip sequence is in progress

  think(sim: GameSimulation, id: string, dt: number): PlayerInput {
    const car = sim.cars.get(id)!;
    const t = car.getTransform();
    const f = car.forward();
    const b = sim.ball.getTransform();
    const ownZ = ARENA_CONFIG.halfLength; // orange goal
    const attackZ = -ARENA_CONFIG.halfLength;

    // Predict the ball a little ahead (ignoring gravity details) and keep it in the arena.
    const lead = 0.35;
    const bx = b.x + b.vx * lead;
    const bz = b.z + b.vz * lead;

    let tx: number;
    let tz: number;
    const ballBehindBot = bz > t.z + 2; // ball is between the bot and its own goal
    if (ballBehindBot && bz > 0) {
      tx = bx * 0.4; // rotate back toward the far post side of the goal
      tz = ownZ - 4;
    } else {
      const gx = 0 - bx;
      const gz = attackZ - bz;
      const gl = Math.hypot(gx, gz) || 1;
      tx = bx - (gx / gl) * 1.8;
      tz = bz - (gz / gl) * 1.8;
    }

    const dx = tx - t.x;
    const dz = tz - t.z;
    const dist = Math.hypot(dx, dz);
    const fl = Math.hypot(f.x, f.z) || 1;
    const cross = (f.z * dx - f.x * dz) / (fl * (dist || 1)); // > 0: target is to the car's left
    const dot = (f.x * dx + f.z * dz) / (fl * (dist || 1));
    const angle = Math.atan2(cross, dot);

    const input: PlayerInput = {
      seq: ++this.seq, timestamp: 0,
      throttle: 1, steer: Math.max(-1, Math.min(1, -angle * 2.8)), pitch: 0, yaw: 0, roll: 0,
      jump: false, jumpHeld: false, boost: false, powerslide: Math.abs(angle) > 1.3 && car.isGrounded(),
    };
    input.yaw = input.steer;
    if (Math.abs(angle) < 0.25 && dist > 10 && car.boostUnits > 0) input.boost = true;

    // Jump / flip into the ball when it is close and in front.
    const ballDist = Math.hypot(b.x - t.x, b.z - t.z);
    if (this.jumpTimer < 0 && car.isGrounded() && Math.abs(angle) < 0.35) {
      if (ballDist < 4 && b.y > 2.4 && b.y < 5.5) this.jumpTimer = 0; // high ball: full jump
      else if (ballDist < 3.2 && b.y < 2.4) this.jumpTimer = 0.4; // low ball: quick flip (skip hold)
    }
    if (this.jumpTimer >= 0) {
      const t0 = this.jumpTimer;
      this.jumpTimer += dt;
      if (t0 === 0 || (t0 >= 0.4 && t0 < 0.4 + dt)) {
        input.jump = true;
        input.jumpHeld = true;
      } else if (t0 < 0.2) {
        input.jumpHeld = true;
      } else if (t0 >= 0.52 && t0 < 0.52 + dt) {
        input.jump = true; // second press: forward dodge
        input.jumpHeld = true;
        input.pitch = -1;
      }
      if (this.jumpTimer > 1.4) this.jumpTimer = -1;
    }
    return input;
  }
}
