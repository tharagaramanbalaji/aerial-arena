import { BOOST_PADS, BoostPadDef, BoostPadSnapshot } from '@aerial-arena/shared';
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

/**
 * Authoritative boost pads. A car collects a pad when its origin is inside the
 * pad's pickup cylinder and it is not already full. Pads then go on cooldown.
 */
export function createBoostPadsManager(
  defs: BoostPadDef[] = BOOST_PADS,
  onPickup?: (padId: number, car: CarPhysicsHandle, amount: number) => void
): BoostPadsManager {
  const pads: PadState[] = defs.map((def) => ({ def, active: true, cooldownRemaining: 0 }));

  const update = (cars: CarPhysicsHandle[], dt: number) => {
    for (const pad of pads) {
      if (!pad.active) {
        pad.cooldownRemaining -= dt;
        if (pad.cooldownRemaining <= 0) {
          pad.active = true;
          pad.cooldownRemaining = 0;
        }
        continue;
      }
      for (const car of cars) {
        if (car.isDemoed || car.boostUnits >= car.config.boostMax) continue;
        const p = car.body.translation();
        const dx = p.x - pad.def.x;
        const dz = p.z - pad.def.z;
        if (dx * dx + dz * dz <= pad.def.radius * pad.def.radius && p.y < pad.def.pickupHeight) {
          car.addBoost(pad.def.amount);
          pad.active = false;
          pad.cooldownRemaining = pad.def.cooldownSec;
          onPickup?.(pad.def.id, car, pad.def.amount);
          break;
        }
      }
    }
  };

  return {
    update,
    reset: () => {
      for (const pad of pads) {
        pad.active = true;
        pad.cooldownRemaining = 0;
      }
    },
    getSnapshots: () =>
      pads.map((pad) => ({
        id: pad.def.id,
        active: pad.active,
        cooldownRemaining: Math.max(0, Math.round(pad.cooldownRemaining * 10) / 10),
      })),
    getPadDefs: () => defs,
  };
}
