import { GameSimulation, StepResult, createGameSimulation } from '@aerial-arena/game-core';
import { BALL_CONFIG, FREEPLAY_SPAWN, PlayerInput } from '@aerial-arena/shared';

/**
 * Local-only training session. Uses the exact same simulation as online play;
 * the convenience actions here are never available to online clients.
 */
export class FreePlayManager {
  public sim!: GameSimulation;
  public readonly playerId = 'local-player';
  public unlimitedBoost = true;
  public goalResetEnabled = true;
  private goalResetTimer = 0;

  public async initialize(): Promise<void> {
    this.sim = await createGameSimulation();
    const s = FREEPLAY_SPAWN;
    const car = this.sim.addCar(this.playerId, 'blue', { x: s.x, y: s.y, z: s.z }, s.yaw);
    car.unlimitedBoost = this.unlimitedBoost;
    car.boostUnits = 100;
  }

  public step(input: PlayerInput, dt: number): StepResult {
    const result = this.sim.step(new Map([[this.playerId, input]]), dt);
    if (result.goalEvent && this.goalResetEnabled) this.goalResetTimer = 2.0;
    if (this.goalResetTimer > 0) {
      this.goalResetTimer -= dt;
      if (this.goalResetTimer <= 0) this.resetBall();
    }
    return result;
  }

  public get car() {
    return this.sim.cars.get(this.playerId)!;
  }

  public resetBall(): void {
    this.sim.ball.reset({ x: 0, y: BALL_CONFIG.restHeight, z: 0 });
    this.sim.goalDetector.reset();
    this.goalResetTimer = 0;
  }

  public resetCar(): void {
    const s = FREEPLAY_SPAWN;
    this.car.reset({ x: s.x, y: s.y, z: s.z }, s.yaw, 100);
  }

  public toggleUnlimitedBoost(): boolean {
    this.unlimitedBoost = !this.unlimitedBoost;
    this.car.unlimitedBoost = this.unlimitedBoost;
    return this.unlimitedBoost;
  }

  public launchBallUpward(): void {
    const b = this.sim.ball.getTransform();
    this.sim.ball.setTransform({ x: b.x, y: Math.max(b.y, BALL_CONFIG.restHeight), z: b.z }, { x: 0, y: 14, z: 0 });
    this.sim.goalDetector.reset();
  }

  /** Lob the ball from midfield toward the player so they can practise aerials / shots. */
  public practiceShotTowardGoal(): void {
    const c = this.car.getTransform();
    const target = { x: c.x * 0.5, z: Math.max(-35, c.z + 20) };
    const from = { x: (Math.random() - 0.5) * 20, y: 2, z: target.z + 30 };
    const flight = 2.2; // s
    const g = 6.5;
    this.sim.ball.setTransform(from, {
      x: (target.x - from.x) / flight,
      y: (6 - from.y + 0.5 * g * flight * flight) / flight,
      z: (target.z - from.z) / flight,
    });
    this.sim.goalDetector.reset();
  }

  /** Place the ball resting on the car's hood (dribble practice). */
  public ballOnHood(): void {
    const t = this.car.getTransform();
    const f = this.car.forward();
    const v = { x: t.vx, y: t.vy, z: t.vz };
    this.sim.ball.setTransform({ x: t.x + f.x * 0.25, y: t.y + 1.45, z: t.z + f.z * 0.25 }, v);
    this.sim.goalDetector.reset();
  }

  public destroy(): void {
    this.sim.destroy();
  }
}
