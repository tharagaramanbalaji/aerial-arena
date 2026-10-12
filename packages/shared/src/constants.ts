export interface ArenaConfig {
  length: number; // m (Z: -50 to 50)
  width: number;  // m (X: -34 to 34)
  height: number; // m (Y: 0 to 22)
  cornerBevel: number; // m corner cut
  wallRampRadius: number; // m curve from floor to wall
  goalWidth: number; // m (X: -8.5 to 8.5)
  goalHeight: number; // m (Y: 0 to 6)
  goalDepth: number; // m (Z: 8m recess)
}

export const ARENA_CONFIG: ArenaConfig = {
  length: 100.0,
  width: 68.0,
  height: 22.0,
  cornerBevel: 8.0,
  wallRampRadius: 4.0,
  goalWidth: 17.0,
  goalHeight: 6.0,
  goalDepth: 8.0,
};

export interface CarConfig {
  length: number;
  width: number;
  height: number;
  mass: number;
  maxForwardSpeed: number;
  maxBoostSpeed: number;
  reverseSpeed: number;
  groundDriveForce: number;
  brakeForce: number;
  steerAngleMax: number;
  steerSensitivity: number;
  lateralFriction: number;
  powerslideFriction: number;
  firstJumpImpulse: number;
  jumpHoldForce: number;
  jumpHoldDuration: number;
  doubleJumpImpulse: number;
  dodgeImpulse: number;
  dodgeWindow: number;
  boostAcceleration: number;
  boostConsumption: number;
  maxBoostUnits: number;
  airPitchTorque: number;
  airYawTorque: number;
  airRollTorque: number;
  airAngularDamping: number;
}

export const CAR_CONFIG: CarConfig = {
  length: 3.5,
  width: 1.8,
  height: 1.1,
  mass: 1200.0,
  maxForwardSpeed: 23.0,
  maxBoostSpeed: 34.0,
  reverseSpeed: 12.0,
  groundDriveForce: 16000.0,
  brakeForce: 24000.0,
  steerAngleMax: 0.55,
  steerSensitivity: 0.45,
  lateralFriction: 0.95,
  powerslideFriction: 0.22,
  firstJumpImpulse: 6600.0,
  jumpHoldForce: 14000.0,
  jumpHoldDuration: 0.20,
  doubleJumpImpulse: 6000.0,
  dodgeImpulse: 9000.0,
  dodgeWindow: 1.25,
  boostAcceleration: 18.0,
  boostConsumption: 33.3,
  maxBoostUnits: 100.0,
  airPitchTorque: 4200.0,
  airYawTorque: 3800.0,
  airRollTorque: 4500.0,
  airAngularDamping: 2.5,
};

export interface BallConfig {
  radius: number;
  mass: number;
  gravity: number;
  restitution: number;
  carRestitution: number;
  friction: number;
  linearDamping: number;
  angularDamping: number;
  maxSpeed: number;
}

export const BALL_CONFIG: BallConfig = {
  radius: 1.8,
  mass: 30.0,
  gravity: -9.81,
  restitution: 0.65,
  carRestitution: 0.80,
  friction: 0.35,
  linearDamping: 0.05,
  angularDamping: 0.10,
  maxSpeed: 42.0,
};

export interface BoostPadDef {
  id: number;
  type: 'small' | 'big';
  x: number;
  z: number;
  amount: number;
  cooldownSec: number;
  radius: number;
}

// Deterministic boost pads layout (mirrored across Z=0 and X=0)
export const BOOST_PADS: BoostPadDef[] = [
  // 6 Big Pads (Corners + Midfield Side)
  { id: 0, type: 'big', x: -28, z: -42, amount: 100, cooldownSec: 10.0, radius: 2.5 },
  { id: 1, type: 'big', x:  28, z: -42, amount: 100, cooldownSec: 10.0, radius: 2.5 },
  { id: 2, type: 'big', x: -30, z:   0, amount: 100, cooldownSec: 10.0, radius: 2.5 },
  { id: 3, type: 'big', x:  30, z:   0, amount: 100, cooldownSec: 10.0, radius: 2.5 },
  { id: 4, type: 'big', x: -28, z:  42, amount: 100, cooldownSec: 10.0, radius: 2.5 },
  { id: 5, type: 'big', x:  28, z:  42, amount: 100, cooldownSec: 10.0, radius: 2.5 },

  // Small Pads along lanes and midfield (12 pads per half = 24 small pads)
  // Center lane
  { id: 6,  type: 'small', x: 0, z: -35, amount: 12, cooldownSec: 4.0, radius: 1.5 },
  { id: 7,  type: 'small', x: 0, z: -25, amount: 12, cooldownSec: 4.0, radius: 1.5 },
  { id: 8,  type: 'small', x: 0, z: -15, amount: 12, cooldownSec: 4.0, radius: 1.5 },
  { id: 9,  type: 'small', x: 0, z:  15, amount: 12, cooldownSec: 4.0, radius: 1.5 },
  { id: 10, type: 'small', x: 0, z:  25, amount: 12, cooldownSec: 4.0, radius: 1.5 },
  { id: 11, type: 'small', x: 0, z:  35, amount: 12, cooldownSec: 4.0, radius: 1.5 },

  // Midfield circle
  { id: 12, type: 'small', x: -12, z: -6, amount: 12, cooldownSec: 4.0, radius: 1.5 },
  { id: 13, type: 'small', x:  12, z: -6, amount: 12, cooldownSec: 4.0, radius: 1.5 },
  { id: 14, type: 'small', x: -12, z:  6, amount: 12, cooldownSec: 4.0, radius: 1.5 },
  { id: 15, type: 'small', x:  12, z:  6, amount: 12, cooldownSec: 4.0, radius: 1.5 },

  // Goal defense arch (Blue half)
  { id: 16, type: 'small', x: -10, z: -40, amount: 12, cooldownSec: 4.0, radius: 1.5 },
  { id: 17, type: 'small', x:  10, z: -40, amount: 12, cooldownSec: 4.0, radius: 1.5 },
  { id: 18, type: 'small', x: -16, z: -30, amount: 12, cooldownSec: 4.0, radius: 1.5 },
  { id: 19, type: 'small', x:  16, z: -30, amount: 12, cooldownSec: 4.0, radius: 1.5 },

  // Goal defense arch (Orange half)
  { id: 20, type: 'small', x: -10, z: 40, amount: 12, cooldownSec: 4.0, radius: 1.5 },
  { id: 21, type: 'small', x:  10, z: 40, amount: 12, cooldownSec: 4.0, radius: 1.5 },
  { id: 22, type: 'small', x: -16, z: 30, amount: 12, cooldownSec: 4.0, radius: 1.5 },
  { id: 23, type: 'small', x:  16, z: 30, amount: 12, cooldownSec: 4.0, radius: 1.5 },

  // Diagonal approaches
  { id: 24, type: 'small', x: -18, z: -15, amount: 12, cooldownSec: 4.0, radius: 1.5 },
  { id: 25, type: 'small', x:  18, z: -15, amount: 12, cooldownSec: 4.0, radius: 1.5 },
  { id: 26, type: 'small', x: -18, z:  15, amount: 12, cooldownSec: 4.0, radius: 1.5 },
  { id: 27, type: 'small', x:  18, z:  15, amount: 12, cooldownSec: 4.0, radius: 1.5 },
];

export interface SpawnPoint {
  x: number;
  y: number;
  z: number;
  yaw: number; // radians
}

export const SPAWN_POSITIONS: Record<'blue' | 'orange', SpawnPoint[]> = {
  // Blue side (Z < 0, facing +Z towards Orange goal)
  blue: [
    { x: 0, y: 0.6, z: -38, yaw: 0 },         // Center back
    { x: -16, y: 0.6, z: -30, yaw: 0.35 },    // Left diagonal
    { x: 16, y: 0.6, z: -30, yaw: -0.35 },    // Right diagonal
  ],
  // Orange side (Z > 0, facing -Z towards Blue goal)
  orange: [
    { x: 0, y: 0.6, z: 38, yaw: Math.PI },        // Center back
    { x: 16, y: 0.6, z: 30, yaw: Math.PI - 0.35 },// Left diagonal (mirrored)
    { x: -16, y: 0.6, z: 30, yaw: Math.PI + 0.35 },// Right diagonal (mirrored)
  ],
};

export const MATCH_CONFIG = {
  regulationDurationSec: 300,   // 5 minutes
  kickoffCountdownSec: 3,       // 3, 2, 1, GO!
  goalPauseDurationSec: 3.0,    // Pause after goal before kickoff
  reconnectGraceSec: 10.0,      // Grace window for dropped client
  fixedTickRate: 60,            // 60 Hz physics
  fixedDeltaTime: 1 / 60,       // 0.0166667 s
  snapshotRate: 30,             // 30 Hz network snapshot broadcast
  snapshotIntervalTicks: 2,     // 60 / 30 = 2 ticks per snapshot
};
