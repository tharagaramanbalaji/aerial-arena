import { GameSimulation, createGameSimulation } from '@aerial-arena/game-core';
import { PlayerInput, Vec3 } from '@aerial-arena/shared';

export class FreePlayManager {
  public sim!: GameSimulation;
  public playerId = 'local-player';
  public unlimitedBoost = false;

  public async initialize(): Promise<void> {
    this.sim = await createGameSimulation();
    const car = this.sim.addCar(this.playerId, 'blue', { x: 0, y: 0.6, z: -38 }, 0);
    car.unlimitedBoost = this.unlimitedBoost;
  }

  public step(input: PlayerInput, dt: number): void {
    const inputs = new Map<string, PlayerInput>();
    inputs.set(this.playerId, input);

    const { goalEvent } = this.sim.step(inputs, dt);
    if (goalEvent) {
      // In Free Play, goal triggers automatic kickoff reset
      setTimeout(() => {
        this.resetBall();
      }, 1500);
    }
  }

  public resetBall(): void {
    this.sim.ball.reset({ x: 0, y: 1.8, z: 0 });
  }

  public resetCar(): void {
    const car = this.sim.cars.get(this.playerId);
    if (car) {
      car.reset({ x: 0, y: 0.6, z: -38 }, 0);
    }
  }

  public toggleUnlimitedBoost(): boolean {
    this.unlimitedBoost = !this.unlimitedBoost;
    const car = this.sim.cars.get(this.playerId);
    if (car) {
      car.unlimitedBoost = this.unlimitedBoost;
    }
    return this.unlimitedBoost;
  }

  public launchBallUpward(): void {
    const pos = this.sim.ball.getTransform();
    this.sim.ball.setTransform(pos, { x: 0, y: 22, z: 0 });
  }

  public practiceShotTowardGoal(): void {
    // Places ball at midfield with high velocity toward Orange goal
    this.sim.ball.setTransform({ x: 0, y: 2.5, z: -5 }, { x: 0, y: 8, z: 28 });
  }

  public destroy(): void {
    this.sim.destroy();
  }
}
