import { BOOST_PADS, BoostPadDef, BoostPadSnapshot, Vec3 } from '@aerial-arena/shared';
import { CarPhysicsHandle } from './car.js';

export interface PadState {
  def: BoostPadDef;
  active: boolean;
  cooldownRemaining: number;
}

export interface BoostPadsManager {
  update(cars: CarPhysicsHandle[], dt: number): void;
  reset(): void;
  getSnapshots(): BoostPadSnapshot[];
  getPadDefs(): BoostPadDef[];
}

export function createBoostPadsManager(
  defs: BoostPadDef[] = BOOST_PADS,
  onPickup?: (padId: number, car: CarPhysicsHandle, amount: number) => void
): BoostPadsManager {
  const pads: PadState[] = defs.map((def) => ({
    def,
    active: true,
    cooldownRemaining: 0,
  }));

  const update = (cars: CarPhysicsHandle[], dt: number) => {
    for (const pad of pads) {
      if (!pad.active) {
        pad.cooldownRemaining -= dt;
        if (pad.cooldownRemaining <= 0) {
          pad.active = true;
          pad.cooldownRemaining = 0;
        }
      } else {
        // Check collisions with cars
        for (const car of cars) {
          const pos = car.body.translation();
          const dx = pos.x - pad.def.x;
          const dz = pos.z - pad.def.z;
          const distSq = dx * dx + dz * dz;

          if (distSq <= pad.def.radius * pad.def.radius && pos.y < 3.0) {
            if (car.boostUnits < 100) {
              car.addBoost(pad.def.amount);
              pad.active = false;
              pad.cooldownRemaining = pad.def.cooldownSec;
              onPickup?.(pad.def.id, car, pad.def.amount);
              break; // One car picks up per frame
            }
          }
        }
      }
    }
  };

  const reset = () => {
    for (const pad of pads) {
      pad.active = true;
      pad.cooldownRemaining = 0;
    }
  };

  const getSnapshots = (): BoostPadSnapshot[] => {
    return pads.map((pad) => ({
      id: pad.def.id,
      active: pad.active,
      cooldownRemaining: Math.max(0, Math.round(pad.cooldownRemaining * 10) / 10),
    }));
  };

  return {
    update,
    reset,
    getSnapshots,
    getPadDefs: () => defs,
  };
}
