/**
 * Aerial Arena tuning configuration.
 *
 * WORLD CONVENTIONS
 *   - Y is up, 1 world unit = 1 meter.
 *   - Z is the field's long axis. Blue defends the goal at -Z, Orange defends +Z.
 *   - X is the field's short axis.
 *   - A car's local frame: forward = +Z, up = +Y, right = forward x up = -X.
 *
 * VALUE PROVENANCE
 *   Most driving / ball / arena values are taken from community reverse-engineering
 *   of Rocket League (RocketSim by ZealanL, MIT license, and the RLBot wiki), converted
 *   at 1 Unreal unit (uu) = 1 cm. They are *community measurements*, not official
 *   Psyonix values. Values marked HYPOTHESIS are our own tuning guesses.
 *   See PHYSICS_TUNING.md for details.
 */

/** Unreal units -> meters. */
export const UU = 0.01;

/** Piecewise-linear curve: sorted [input, output] pairs, clamped at both ends. */
export type Curve = ReadonlyArray<readonly [number, number]>;

export function evalCurve(curve: Curve, x: number): number {
  if (curve.length === 0) return 1;
  if (x <= curve[0][0]) return curve[0][1];
  for (let i = 1; i < curve.length; i++) {
    const [x1, y1] = curve[i];
    if (x <= x1) {
      const [x0, y0] = curve[i - 1];
      const t = (x - x0) / (x1 - x0);
      return y0 + (y1 - y0) * t;
    }
  }
  return curve[curve.length - 1][1];
}

// ---------------------------------------------------------------------------
// Physics world
// ---------------------------------------------------------------------------

export const PHYSICS_CONFIG = {
  gravity: -650 * UU, // m/s^2 (-6.5). RL gravity is much lower than Earth's.
  tickRate: 120, // Hz. RL simulates at 120 Hz; flip/jump timings assume it.
  fixedDeltaTime: 1 / 120, // s
  maxSubstepsPerFrame: 8, // bound catch-up work after a slow frame
} as const;

// ---------------------------------------------------------------------------
// Arena
// ---------------------------------------------------------------------------

export interface ArenaConfig {
  halfWidth: number; // m, X extent of the side walls
  halfLength: number; // m, Z extent of the back walls (goal line)
  height: number; // m, ceiling height
  cornerCut: number; // m, leg length of the 45-degree corner chamfer
  cornerRoundRadius: number; // m, rounding of the footprint polygon vertices (must exceed fillet radii)
  floorFilletRadius: number; // m, curved ramp from floor to wall
  ceilingFilletRadius: number; // m, curved transition from wall to ceiling
  goalHalfWidth: number; // m
  goalHeight: number; // m
  goalDepth: number; // m, how far the goal box extends behind the goal line
  goalFilletTaper: number; // m, distance beside the post over which the floor fillet fades to zero
}

export const ARENA_CONFIG: ArenaConfig = {
  halfWidth: 4096 * UU, // 40.96
  halfLength: 5120 * UU, // 51.20
  height: 2044 * UU, // 20.44
  cornerCut: (4096 + 5120 - 8064) * UU, // 11.52: corner planes satisfy |x| + |z| = 80.64 m
  cornerRoundRadius: 8.0, // HYPOTHESIS
  floorFilletRadius: 2.56, // HYPOTHESIS (RL ramps are roughly 256 uu)
  ceilingFilletRadius: 2.56, // HYPOTHESIS
  goalHalfWidth: 893 * UU, // 8.93
  goalHeight: 642.775 * UU, // 6.43
  goalDepth: 880 * UU, // 8.80
  goalFilletTaper: 4.0, // HYPOTHESIS
};

/**
 * Contact materials. Rapier combines both colliders' coefficients with the Multiply rule.
 * Target pair values (RocketSim): ball-arena friction 0.35*0.6 = 0.21, car-arena 0.3,
 * car-ball 2.0. Solving b*a = 0.21, c*a = 0.3, b*c = 2.0 gives the per-collider values below.
 * Restitution: ball-arena 0.6, car-ball 0 (car restitution 0 => car-arena 0, RL uses 0.3).
 */
export const CONTACT_MATERIALS = {
  arenaFriction: 0.17748,
  ballFriction: 1.18322,
  carFriction: 1.69031,
  arenaRestitution: 0.6,
  ballRestitution: 1.0,
  carRestitution: 0.0,
} as const;

// ---------------------------------------------------------------------------
// Car (single chassis, Octane-like hitbox)
// ---------------------------------------------------------------------------

export interface WheelDef {
  forward: number; // m, local +Z offset of the suspension hard point
  side: number; // m, |X| offset of the suspension hard point
  up: number; // m, local +Y offset of the suspension hard point
  radius: number; // m (visual + ray length)
}

export interface CarConfig {
  // Body
  mass: number; // RL "bullet" mass units; only ratios to the ball mass matter
  hitboxLength: number; // m
  hitboxWidth: number; // m
  hitboxHeight: number; // m
  hitboxOffsetForward: number; // m, hitbox center relative to the body origin
  hitboxOffsetUp: number; // m
  restHeight: number; // m, body origin height above the floor when parked
  frontWheels: WheelDef;
  backWheels: WheelDef;
  wheelbase: number; // m, used for the steering-curvature model

  // Suspension (HYPOTHESIS, tuned so the car rests at restHeight)
  suspensionStiffness: number; // 1/s^2, acceleration per meter of compression per wheel (mass-normalised)
  suspensionDamping: number; // 1/s, acceleration per (m/s) of compression velocity per wheel
  suspensionMaxTravel: number; // m

  // Ground driving
  maxSpeed: number; // m/s, absolute car speed cap
  supersonicSpeed: number; // m/s
  throttleAccel: number; // m/s^2 at zero speed (scaled by throttleSpeedCurve)
  throttleSpeedCurve: Curve; // |forward speed| m/s -> factor
  brakeAccel: number; // m/s^2 when pressing against the direction of travel
  coastAccel: number; // m/s^2 when no throttle is held
  stoppingSpeed: number; // m/s, below this, coasting fully brakes
  steerAngleCurve: Curve; // |forward speed| m/s -> max front-wheel angle (rad)
  powerslideSteerAngleCurve: Curve; // same, while powersliding
  powerslideRiseRate: number; // 1/s
  powerslideFallRate: number; // 1/s
  lateralFrictionCurve: Curve; // slip ratio [0..1] -> fraction of lateral velocity removed per tick
  powerslideLateralFactor: number; // multiplier on lateral friction at full powerslide
  powerslideYawGrip: number; // fraction of target yaw-rate applied per tick at full powerslide
  nonStickyFrictionCurve: Curve; // surface normal.y -> friction scale when throttle is released
  stickyForceBase: number; // * g, always applied into the surface while any wheel touches
  stickyForceWall: number; // * g * (1 - |n.y|), extra while throttling or moving

  // Boost
  boostMax: number; // units
  boostSpawnAmount: number; // units given at kickoff
  boostPerSecond: number; // units/s consumed
  boostMinTime: number; // s, a tap boosts at least this long
  boostAccelGround: number; // m/s^2
  boostAccelAir: number; // m/s^2
  airThrottleAccel: number; // m/s^2, tiny forward push from throttle while airborne

  // Jumping
  jumpImpulse: number; // m/s, immediate velocity along car up
  jumpHoldAccel: number; // m/s^2 while jump is held
  jumpMinTime: number; // s
  jumpMaxTime: number; // s
  jumpPreMinAccelScale: number; // hold accel scale before jumpMinTime
  doubleJumpWindow: number; // s after the first jump ends
  dodgeDeadzone: number; // |pitch|+|yaw|+|roll| above this makes the second jump a dodge

  // Dodge / flip
  flipInitialVel: number; // m/s
  flipForwardSpeedScale: number;
  flipSideSpeedScale: number;
  flipBackwardSpeedScale: number;
  flipBackwardImpulseScale: number;
  flipTorqueTime: number; // s
  flipPitchTorque: number; // rad/s^2 (forward/back flips)
  flipRollTorque: number; // rad/s^2 (side flips)
  flipZDampPer120: number; // vertical velocity damping per 1/120 s while flipping
  flipZDampStart: number; // s
  flipZDampEnd: number; // s
  flipPitchLockExtraTime: number; // s
  flipLockTime: number; // s after a flip starts during which no new jump/flip can begin

  // Air control (rad/s^2 and 1/s; RL torque * 2*pi/65536*1000 scale already applied)
  airPitchAccel: number;
  airYawAccel: number;
  airRollAccel: number;
  airPitchDamping: number;
  airYawDamping: number;
  airRollDamping: number;
  maxAngularSpeed: number; // rad/s

  // Recovery helpers
  autoRollAccel: number; // rad/s^2 when 1-2 wheels touch a surface
  autoRollDownAccel: number; // m/s^2 into the surface
  autoFlipImpulse: number; // m/s, pop when jumping while on the roof
  autoFlipRollAccel: number; // rad/s^2
  autoFlipTime: number; // s

  // Car-car bumps
  bumpCooldown: number; // s
  bumpGroundCurve: Curve; // attacker forward speed m/s -> victim horizontal m/s
  bumpAirCurve: Curve;
  bumpUpCurve: Curve;
}

/** Torque scale RL applies to its air-control constants (2*pi / 2^16 * 1000). */
const RL_TORQUE_SCALE = ((2 * Math.PI) / 65536) * 1000;

export const CAR_CONFIG: CarConfig = {
  mass: 180,
  hitboxLength: 120.507 * UU,
  hitboxWidth: 86.6994 * UU,
  hitboxHeight: 38.6591 * UU,
  hitboxOffsetForward: 13.8757 * UU,
  hitboxOffsetUp: 20.755 * UU,
  restHeight: 17 * UU,
  frontWheels: { forward: 51.25 * UU, side: 25.9 * UU, up: 20.755 * UU, radius: 12.5 * UU },
  backWheels: { forward: -33.75 * UU, side: 29.5 * UU, up: 20.755 * UU, radius: 15.0 * UU },
  wheelbase: (51.25 + 33.75) * UU,

  suspensionStiffness: 160,
  suspensionDamping: 12.5,
  suspensionMaxTravel: 12 * UU,

  maxSpeed: 2300 * UU,
  supersonicSpeed: 2200 * UU,
  throttleAccel: 1600 * UU,
  throttleSpeedCurve: [
    [0, 1.0],
    [14.0, 0.1],
    [14.1, 0.0],
  ],
  brakeAccel: 3500 * UU,
  coastAccel: 525 * UU,
  stoppingSpeed: 25 * UU,
  steerAngleCurve: [
    [0, 0.53356],
    [5, 0.3193],
    [10, 0.18203],
    [15, 0.1057],
    [17.5, 0.08507],
    [30, 0.03454],
  ],
  powerslideSteerAngleCurve: [
    [0, 0.39235],
    [25, 0.1261],
  ],
  powerslideRiseRate: 5,
  powerslideFallRate: 2,
  lateralFrictionCurve: [
    [0, 1.0],
    [1, 0.2],
  ],
  powerslideLateralFactor: 0.1,
  powerslideYawGrip: 0.12, // HYPOTHESIS
  nonStickyFrictionCurve: [
    [0, 0.1],
    [0.7075, 0.5],
    [1, 1.0],
  ],
  stickyForceBase: 0.5,
  stickyForceWall: 1.0,

  boostMax: 100,
  boostSpawnAmount: 100 / 3,
  boostPerSecond: 100 / 3,
  boostMinTime: 0.1,
  boostAccelGround: (2975 / 3) * UU,
  boostAccelAir: (3175 / 3) * UU,
  airThrottleAccel: (200 / 3) * UU,

  jumpImpulse: (875 / 3) * UU,
  jumpHoldAccel: (4375 / 3) * UU,
  jumpMinTime: 0.025,
  jumpMaxTime: 0.2,
  jumpPreMinAccelScale: 0.62,
  doubleJumpWindow: 1.25,
  dodgeDeadzone: 0.5,

  flipInitialVel: 500 * UU,
  flipForwardSpeedScale: 1.0,
  flipSideSpeedScale: 1.9,
  flipBackwardSpeedScale: 2.5,
  flipBackwardImpulseScale: 16 / 15,
  flipTorqueTime: 0.65,
  flipPitchTorque: 224,
  flipRollTorque: 260,
  flipZDampPer120: 0.35,
  flipZDampStart: 0.15,
  flipZDampEnd: 0.21,
  flipPitchLockExtraTime: 0.3,
  flipLockTime: 0.65, // one flip at a time (design rule), equals the flip torque time

  airPitchAccel: 130 * RL_TORQUE_SCALE,
  airYawAccel: 95 * RL_TORQUE_SCALE,
  airRollAccel: 400 * RL_TORQUE_SCALE,
  airPitchDamping: 30 * RL_TORQUE_SCALE,
  airYawDamping: 20 * RL_TORQUE_SCALE,
  airRollDamping: 50 * RL_TORQUE_SCALE,
  maxAngularSpeed: 5.5,

  autoRollAccel: 25, // HYPOTHESIS: RL applies 80 through the inertia tensor; tuned by feel
  autoRollDownAccel: 100 * UU,
  autoFlipImpulse: 200 * UU,
  autoFlipRollAccel: 50,
  autoFlipTime: 0.4,

  bumpCooldown: 0.25,
  bumpGroundCurve: [
    [0, 0],
    [14, 1100 * UU],
    [22, 1530 * UU],
  ],
  bumpAirCurve: [
    [0, 0],
    [14, 1390 * UU],
    [22, 1945 * UU],
  ],
  bumpUpCurve: [
    [0, 0],
    [14, 278 * UU],
    [22, 417 * UU],
  ],
};

// ---------------------------------------------------------------------------
// Ball
// ---------------------------------------------------------------------------

export interface BallConfig {
  radius: number; // m
  mass: number; // same units as CarConfig.mass (car:ball = 6:1)
  restitution: number; // vs arena
  friction: number; // vs arena
  drag: number; // linear damping, 1/s
  maxSpeed: number; // m/s
  maxAngularSpeed: number; // rad/s
  restHeight: number; // m, center height when resting on the floor
  // Car-ball "extra impulse" (what makes touches feel punchy)
  hitZScale: number; // vertical component of hit direction is scaled by this
  hitForwardScale: number; // component along car forward is kept at this fraction
  hitMaxRelSpeed: number; // m/s
  hitFactorCurve: Curve; // relative speed m/s -> factor
}

export const BALL_CONFIG: BallConfig = {
  radius: 1.3, // m. HYPOTHESIS: enlarged from RL's 0.9125 m at the player's request
  mass: 40, // heavier with the larger ball so touches keep a similar feel
  restitution: 0.6,
  friction: 0.35,
  drag: 0.03,
  maxSpeed: 6000 * UU,
  maxAngularSpeed: 6,
  restHeight: 1.3 + 0.002,
  hitZScale: 0.35,
  hitForwardScale: 0.65,
  hitMaxRelSpeed: 4600 * UU,
  hitFactorCurve: [
    [0, 0.65],
    [5, 0.65],
    [23, 0.55],
    [46, 0.3],
  ],
};

// ---------------------------------------------------------------------------
// Boost pads (standard soccer layout, mirrored through the field center)
// ---------------------------------------------------------------------------

export interface BoostPadDef {
  id: number;
  type: 'small' | 'big';
  x: number; // m
  z: number; // m
  amount: number; // boost units
  cooldownSec: number;
  radius: number; // m, pickup cylinder radius around the car origin
  pickupHeight: number; // m, car origin must be below this
}

const SMALL_PAD_UU: ReadonlyArray<readonly [number, number]> = [
  [0, -4240], [-1792, -4184], [1792, -4184], [-940, -3308], [940, -3308],
  [0, -2816], [-3584, -2484], [3584, -2484], [-1788, -2300], [1788, -2300],
  [-2048, -1036], [0, -1024], [2048, -1036], [-1024, 0], [1024, 0],
  [-2048, 1036], [0, 1024], [2048, 1036], [-1788, 2300], [1788, 2300],
  [-3584, 2484], [3584, 2484], [0, 2816], [-940, 3308], [940, 3308],
  [-1792, 4184], [1792, 4184], [0, 4240],
];

const BIG_PAD_UU: ReadonlyArray<readonly [number, number]> = [
  [-3584, 0], [3584, 0], [-3072, 4096], [3072, 4096], [-3072, -4096], [3072, -4096],
];

export const BOOST_PADS: BoostPadDef[] = [
  ...BIG_PAD_UU.map(([x, z], i) => ({
    id: i,
    type: 'big' as const,
    x: x * UU,
    z: z * UU,
    amount: 100,
    cooldownSec: 10,
    radius: 208 * UU,
    pickupHeight: 1.65,
  })),
  ...SMALL_PAD_UU.map(([x, z], i) => ({
    id: BIG_PAD_UU.length + i,
    type: 'small' as const,
    x: x * UU,
    z: z * UU,
    amount: 12,
    cooldownSec: 4,
    radius: 144 * UU,
    pickupHeight: 1.65,
  })),
];

// ---------------------------------------------------------------------------
// Kickoff spawns
// ---------------------------------------------------------------------------

export interface SpawnPoint {
  x: number;
  y: number;
  z: number;
  yaw: number; // radians about +Y; yaw 0 faces +Z
}

/**
 * Blue-side kickoff spawns. Orange spawns are the point reflection through the
 * field center (x,z) -> (-x,-z), yaw + PI. In 1v1 both cars use the same index.
 * RL spawn yaw a (from +x toward +y) maps to our yaw = PI/2 - a.
 */
const KICKOFF_UU: ReadonlyArray<readonly [number, number, number]> = [
  [-2048, -2560, Math.PI / 4], // diagonal left
  [2048, -2560, (3 * Math.PI) / 4], // diagonal right
  [-256, -3840, Math.PI / 2], // off-center left
  [256, -3840, Math.PI / 2], // off-center right
  [0, -4608, Math.PI / 2], // straight back
];

export const KICKOFF_SPAWNS: SpawnPoint[] = KICKOFF_UU.map(([x, z, a]) => ({
  x: x * UU,
  y: CAR_CONFIG.restHeight,
  z: z * UU,
  yaw: Math.PI / 2 - a,
}));

export function kickoffSpawn(team: 'blue' | 'orange', index: number): SpawnPoint {
  const s = KICKOFF_SPAWNS[((index % KICKOFF_SPAWNS.length) + KICKOFF_SPAWNS.length) % KICKOFF_SPAWNS.length];
  if (team === 'blue') return { ...s };
  return { x: -s.x, y: s.y, z: -s.z, yaw: s.yaw + Math.PI };
}

/** Free Play spawn: blue back-center, facing the ball. */
export const FREEPLAY_SPAWN: SpawnPoint = { x: 0, y: CAR_CONFIG.restHeight, z: -46.08, yaw: 0 };

// ---------------------------------------------------------------------------
// Match rules
// ---------------------------------------------------------------------------

export const MATCH_CONFIG = {
  regulationDurationSec: 300, // 5 minutes
  kickoffCountdownSec: 3, // 3, 2, 1, GO!
  goalPauseDurationSec: 3.0, // celebration before the next kickoff
  reconnectGraceSec: 10.0, // grace window for a dropped client
  serverLoopHz: 60, // wall-clock rate of the server loop; physics substeps at PHYSICS_CONFIG.tickRate
  snapshotRate: 30, // Hz
  snapshotIntervalTicks: 4, // physics ticks per snapshot (120 / 30)
};

// ---------------------------------------------------------------------------
// Camera (local presentation only; never affects physics)
// ---------------------------------------------------------------------------

export const CAMERA_CONFIG = {
  horizontalFovDeg: 110, // RL-style horizontal FOV; vertical FOV is derived from aspect
  distance: 2.7, // m behind the car (RL default 270 uu)
  height: 1.0, // m above the car (RL default 100 uu)
  pitchDeg: -4, // look slightly down
  stiffness: 0.45, // 0 = loose follow, 1 = rigid
  swivelRate: 9, // 1/s, how fast the camera direction follows its target
  ballCamMaxPitchDeg: 30,
  ballCamMinPitchDeg: -25,
  transitionSec: 0.35,
} as const;
