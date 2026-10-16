/**
 * Arcade car controller with Rocket-League-style handling.
 *
 * Structure follows the community RocketSim model (MIT, github.com/ZealanL/RocketSim):
 * four suspension rays, a throttle torque curve, speed-dependent steering angle,
 * slip-based lateral friction, "sticky" surface force, variable jump, double
 * jump / dodge with RL flip impulses, and RL air-control torques. Rather than a
 * full wheel-impulse solver we apply the same accelerations at the velocity
 * level, which is stable in Rapier at 120 Hz.
 *
 * Local car frame: forward = +Z, up = +Y, right = forward x up = -X.
 * Signs: positive angular velocity about `right` = nose up,
 *        about `up` = turn left, about `forward` = roll right.
 */
import RAPIER from '@dimforge/rapier3d-compat';
import {
  CAR_CONFIG,
  CONTACT_MATERIALS,
  CarConfig,
  PHYSICS_CONFIG,
  PlayerInput,
  PlayerStateSnapshot,
  Quat,
  Team,
  TransformSnapshot,
  Vec3,
  clamp,
  evalCurve,
  quatRotateVector,
} from '@aerial-arena/shared';

export interface WheelState {
  inContact: boolean;
  /** Distance from the hard point to the contact (or the max ray length). */
  suspensionLength: number;
  maxLength: number;
}

export interface CarPhysicsHandle {
  id: string;
  team: Team;
  body: RAPIER.RigidBody;
  hitbox: RAPIER.Collider;
  config: CarConfig;
  boostUnits: number;
  unlimitedBoost: boolean;
  score: number;
  readonly lastInputSeq: number;
  readonly wheels: readonly WheelState[];
  readonly isDemoed: boolean;
  /** Apply controls for one physics tick. Call before world.step(). */
  preStep(input: PlayerInput, dt: number): void;
  /** Apply limits / timers. Call after world.step(). */
  postStep(dt: number): void;
  reset(pos: Vec3, yaw: number, boost?: number): void;
  demolish(respawnDelay: number): void;
  /** Where a demolished car reappears when its respawn timer ends. */
  setRespawn(pos: Vec3, yaw: number): void;
  addBoost(amount: number): void;
  getSnapshot(): PlayerStateSnapshot;
  getTransform(): TransformSnapshot;
  forward(): Vec3;
  isGrounded(): boolean;
  isBoosting(): boolean;
  isDodging(): boolean;
  isSupersonic(): boolean;
  isPowersliding(): boolean;
  bumpCooldown: number;
  onRespawn?: () => void;
}

// --- small vector helpers (allocation-light, local to the hot path) --------
const v3 = (x = 0, y = 0, z = 0): Vec3 => ({ x, y, z });
const add = (a: Vec3, b: Vec3): Vec3 => v3(a.x + b.x, a.y + b.y, a.z + b.z);
const sub = (a: Vec3, b: Vec3): Vec3 => v3(a.x - b.x, a.y - b.y, a.z - b.z);
const scale = (a: Vec3, s: number): Vec3 => v3(a.x * s, a.y * s, a.z * s);
const dot = (a: Vec3, b: Vec3) => a.x * b.x + a.y * b.y + a.z * b.z;
const cross = (a: Vec3, b: Vec3): Vec3 => v3(a.y * b.z - a.z * b.y, a.z * b.x - a.x * b.z, a.x * b.y - a.y * b.x);
const len = (a: Vec3) => Math.hypot(a.x, a.y, a.z);
const normalize = (a: Vec3): Vec3 => {
  const l = len(a);
  return l > 1e-9 ? scale(a, 1 / l) : v3();
};
const yawQuat = (yaw: number): Quat => ({ x: 0, y: Math.sin(yaw / 2), z: 0, w: Math.cos(yaw / 2) });

export function createCar(
  world: RAPIER.World,
  id: string,
  team: Team,
  initialPos: Vec3,
  initialYaw: number,
  config: CarConfig = CAR_CONFIG
): CarPhysicsHandle {
  const gravity = Math.abs(PHYSICS_CONFIG.gravity);
  const L = config.hitboxLength;
  const W = config.hitboxWidth;
  const H = config.hitboxHeight;
  const m = config.mass;

  // Center of mass at the body origin (as in RL, the hitbox is offset from it).
  const inertia = v3((m / 12) * (H * H + L * L), (m / 12) * (W * W + L * L), (m / 12) * (W * W + H * H));
  const body = world.createRigidBody(
    RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(initialPos.x, initialPos.y, initialPos.z)
      .setRotation(yawQuat(initialYaw))
      .setAdditionalMassProperties(m, v3(), inertia, { x: 0, y: 0, z: 0, w: 1 })
      .setLinearDamping(0)
      .setAngularDamping(0)
      // No CCD: Rapier's CCD clamps motion near surfaces (eats jump/hit velocity). At 120 Hz the
      // fastest car (0.19 m/tick) and ball (0.5 m/tick) move less than their own half-extents per tick.
      .setCcdEnabled(false)
      .setCanSleep(false)
  );
  const hitbox = world.createCollider(
    RAPIER.ColliderDesc.cuboid(W / 2, H / 2, L / 2)
      .setTranslation(0, config.hitboxOffsetUp, config.hitboxOffsetForward)
      .setDensity(0)
      .setFriction(CONTACT_MATERIALS.carFriction)
      .setRestitution(CONTACT_MATERIALS.carRestitution)
      .setFrictionCombineRule(RAPIER.CoefficientCombineRule.Multiply)
      .setRestitutionCombineRule(RAPIER.CoefficientCombineRule.Multiply)
      .setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS),
    body
  );

  // Wheel hard points in the local frame. Left = +X, right = -X.
  const restContact = config.restHeight + config.frontWheels.up;
  const preload = ((1 + config.stickyForceBase) * gravity) / (4 * config.suspensionStiffness);
  const wheelDefs = [
    { def: config.frontWheels, side: 1 }, // front-left
    { def: config.frontWheels, side: -1 }, // front-right
    { def: config.backWheels, side: 1 }, // back-left
    { def: config.backWheels, side: -1 }, // back-right
  ].map(({ def, side }) => ({
    local: v3(side * def.side, def.up, def.forward),
    maxLength: restContact + preload,
  }));
  const wheels: WheelState[] = wheelDefs.map((w) => ({ inContact: false, suspensionLength: w.maxLength, maxLength: w.maxLength }));

  // --- persistent controller state ------------------------------------------
  let boostUnits = config.boostSpawnAmount;
  let unlimitedBoost = false;
  let score = 0;
  let lastInputSeq = 0;
  let lastJumpEdgeSeq = -1;
  let lastJumpHeld = false;

  let onGround = false;
  let numContacts = 0;
  let groundUp = v3(0, 1, 0);
  let handbrakeVal = 0;

  let isJumping = false;
  let hasJumped = false;
  let jumpTime = 0;
  let hasDoubleJumped = false;
  let hasFlipped = false;
  let isFlipping = false;
  /** While > 0 no new jump / flip may start: one flip at a time, even across a brief landing. */
  let flipLock = 0;
  let flipTime = 0;
  let flipPitchDir = 0; // +1 forward flip, -1 back flip
  let flipRollDir = 0; // +1 right side flip
  let airTimeSinceJump = 0;

  let isAutoFlipping = false;
  let autoFlipTimer = 0;
  let autoFlipDir = 1;

  let boosting = false;
  let boostingTime = 0;

  let supersonic = false;
  let supersonicTime = 0;

  let worldContactNormal: Vec3 | null = null;
  let demoed = false;
  let respawnTimer = 0;
  let pendingRespawn: { pos: Vec3; yaw: number } | null = null;

  const basis = () => {
    const q = body.rotation();
    const fwd = quatRotateVector(q, v3(0, 0, 1));
    const up = quatRotateVector(q, v3(0, 1, 0));
    return { q, fwd, up, right: cross(fwd, up) };
  };

  const reset = (pos: Vec3, yaw: number, boost: number = config.boostSpawnAmount) => {
    body.setEnabled(true);
    body.setTranslation(pos, true);
    body.setRotation(yawQuat(yaw), true);
    body.setLinvel(v3(), true);
    body.setAngvel(v3(), true);
    boostUnits = boost;
    isJumping = hasJumped = hasDoubleJumped = hasFlipped = isFlipping = false;
    flipLock = 0;
    jumpTime = flipTime = airTimeSinceJump = 0;
    isAutoFlipping = false;
    boosting = false;
    boostingTime = 0;
    handbrakeVal = 0;
    supersonic = false;
    supersonicTime = 0;
    demoed = false;
    respawnTimer = 0;
    lastJumpHeld = false;
  };

  const demolish = (respawnDelay: number) => {
    if (demoed) return;
    demoed = true;
    respawnTimer = respawnDelay;
    body.setLinvel(v3(), false);
    body.setAngvel(v3(), false);
    body.setEnabled(false);
  };

  // --- per-tick update -------------------------------------------------------
  const preStep = (input: PlayerInput, dt: number) => {
    lastInputSeq = input.seq;
    if (demoed) return;

    const jumpEdgeFromSeq = input.jump && input.seq !== lastJumpEdgeSeq;
    const jumpPressed = jumpEdgeFromSeq || (input.jumpHeld && !lastJumpHeld);
    if (jumpPressed) lastJumpEdgeSeq = input.seq;
    lastJumpHeld = input.jumpHeld;
    if (flipLock > 0) flipLock = Math.max(0, flipLock - dt);
    // A press during an unfinished flip is consumed, not buffered.
    const actionPressed = jumpPressed && flipLock <= 0;
    const jumpHeld = input.jumpHeld || jumpPressed;

    const tickScale = dt * 120; // RL constants are per 1/120 s tick
    const { fwd, up, right } = basis();
    const pos = body.translation();

    // 1. Suspension rays ------------------------------------------------------
    numContacts = 0;
    let normalSum = v3();
    const rayDir = scale(up, -1);
    for (let i = 0; i < 4; i++) {
      const w = wheelDefs[i];
      const hp = add(pos, quatRotateVector(body.rotation(), w.local));
      const hit = world.castRayAndGetNormal(
        new RAPIER.Ray(hp, rayDir),
        w.maxLength,
        true,
        RAPIER.QueryFilterFlags.EXCLUDE_DYNAMIC | RAPIER.QueryFilterFlags.EXCLUDE_SENSORS,
        undefined,
        undefined,
        body
      );
      const state = wheels[i];
      if (hit && hit.timeOfImpact <= w.maxLength) {
        state.inContact = true;
        state.suspensionLength = hit.timeOfImpact;
        numContacts++;
        normalSum = add(normalSum, hit.normal);

        const compression = w.maxLength - hit.timeOfImpact;
        const vel = body.linvel();
        const angVel = body.angvel();
        const pointVel = add(vel, cross(angVel, sub(hp, pos)));
        const compressionVel = -dot(pointVel, up);
        let accel = config.suspensionStiffness * compression + config.suspensionDamping * compressionVel;
        if (compression > config.suspensionMaxTravel) {
          accel += config.suspensionStiffness * 10 * (compression - config.suspensionMaxTravel); // bump stop
        }
        if (accel > 0) body.applyImpulseAtPoint(scale(up, accel * m * dt), hp, true);
      } else {
        state.inContact = false;
        state.suspensionLength = w.maxLength;
      }
    }
    onGround = numContacts >= 3;
    groundUp = numContacts > 0 ? normalize(normalSum) : v3(0, 1, 0);

    // Hitbox resting on a surface with no wheels down (roof / side): probe outward.
    worldContactNormal = null;
    if (numContacts === 0) {
      const center = add(pos, add(scale(up, config.hitboxOffsetUp), scale(fwd, config.hitboxOffsetForward)));
      const probes: [Vec3, number][] = [
        [up, H / 2 + 0.06],
        [right, W / 2 + 0.06],
        [scale(right, -1), W / 2 + 0.06],
      ];
      for (const [dir, maxDist] of probes) {
        const hit = world.castRayAndGetNormal(
          new RAPIER.Ray(center, dir),
          maxDist,
          true,
          RAPIER.QueryFilterFlags.EXCLUDE_DYNAMIC | RAPIER.QueryFilterFlags.EXCLUDE_SENSORS,
          undefined,
          undefined,
          body
        );
        if (hit) {
          worldContactNormal = v3(hit.normal.x, hit.normal.y, hit.normal.z);
          break;
        }
      }
    }

    let v = body.linvel() as Vec3;
    let w = body.angvel() as Vec3;
    v = v3(v.x, v.y, v.z);
    w = v3(w.x, w.y, w.z);

    // 2. Handbrake (powerslide) analog value ---------------------------------
    handbrakeVal = clamp(
      handbrakeVal + (input.powerslide ? config.powerslideRiseRate : -config.powerslideFallRate) * dt,
      0,
      1
    );

    const hasBoostFuel = unlimitedBoost || boostUnits > 0;
    const realThrottle = input.boost && hasBoostFuel ? 1 : input.throttle;
    const forwardSpeed = dot(v, fwd);

    // 3. Ground driving -------------------------------------------------------
    if (numContacts > 0) {
      const n = groundUp;
      const fwdS = normalize(sub(fwd, scale(n, dot(fwd, n))));
      const rightS = cross(fwdS, n);
      const vF = dot(v, fwdS);
      const vR = dot(v, rightS);
      const absVF = Math.abs(vF);
      const contactFrac = numContacts / 4;
      const sticky = realThrottle !== 0;
      const nonSticky = sticky ? 1 : evalCurve(config.nonStickyFrictionCurve, n.y);

      // Throttle / brake (RL: braking when pushing against travel direction; coasting brake otherwise)
      let engine = realThrottle;
      let brake = 0;
      if (!input.powerslide) {
        if (Math.abs(realThrottle) >= 0.001) {
          if (absVF > config.stoppingSpeed && Math.sign(realThrottle) !== Math.sign(vF)) {
            brake = 1;
            engine = 0;
          }
        } else {
          engine = 0;
          brake = absVF < config.stoppingSpeed ? 1 : config.coastAccel / config.brakeAccel;
        }
      }
      let driveScale = evalCurve(config.throttleSpeedCurve, absVF);
      if (numContacts < 3) driveScale /= 4;
      let newVF = vF + engine * config.throttleAccel * driveScale * contactFrac * dt;
      const brakeDv = brake * config.brakeAccel * contactFrac * nonSticky * dt;
      newVF = Math.abs(newVF) <= brakeDv ? 0 : newVF - Math.sign(newVF) * brakeDv;

      // Lateral friction (slip-ratio curve, reduced by powerslide / non-sticky surfaces)
      const slip = Math.abs(vR) > 0.05 ? Math.abs(vR) / (Math.abs(vF) + Math.abs(vR)) : 0;
      let latFric = evalCurve(config.lateralFrictionCurve, slip);
      latFric *= 1 + (config.powerslideLateralFactor - 1) * handbrakeVal;
      latFric *= nonSticky * contactFrac;
      const latKeep = Math.pow(1 - clamp(latFric, 0, 1), tickScale);
      const newVR = vR * latKeep;

      v = add(v, add(scale(fwdS, newVF - vF), scale(rightS, newVR - vR)));

      // Steering: yaw rate = speed * curvature, curvature = tan(steer angle) / wheelbase
      if (numContacts >= 2) {
        let steerAngle = evalCurve(config.steerAngleCurve, absVF);
        if (handbrakeVal > 0) {
          steerAngle += (evalCurve(config.powerslideSteerAngleCurve, absVF) - steerAngle) * handbrakeVal;
        }
        const curvature = Math.tan(steerAngle) / config.wheelbase;
        const targetYaw = -input.steer * newVF * curvature;
        const yawNow = dot(w, n);
        const grip = (1 + (config.powerslideYawGrip - 1) * handbrakeVal) * (onGround ? 1 : 0.5);
        w = add(w, scale(n, (targetYaw - yawNow) * clamp(grip * tickScale, 0, 1)));
      }

      // Sticky force into the surface
      const fullStick = realThrottle !== 0 || absVF > config.stoppingSpeed;
      const stick = config.stickyForceBase + (fullStick ? config.stickyForceWall * (1 - Math.abs(n.y)) : 0);
      v = add(v, scale(n, -stick * gravity * dt));
    }

    // 4. Airborne torque (flip torque while < 3 wheels; air control only with 0 wheels)
    if (numContacts < 3) {
      if (isFlipping) isFlipping = hasFlipped && flipTime < config.flipTorqueTime;
      let doAirControl = !isFlipping;
      if (isFlipping) {
        if (flipPitchDir !== 0 || flipRollDir !== 0) {
          let pitchScale = 1;
          if (flipPitchDir !== 0 && input.pitch !== 0 && flipPitchDir * input.pitch > 0) {
            pitchScale = 1 - Math.min(1, Math.abs(input.pitch)); // flip cancel
            doAirControl = true;
          }
          const alpha = add(
            scale(right, -flipPitchDir * pitchScale * config.flipPitchTorque),
            scale(fwd, flipRollDir * config.flipRollTorque)
          );
          w = add(w, scale(alpha, dt));
        } else {
          doAirControl = true; // stall
        }
      }
      doAirControl = doAirControl && !isAutoFlipping && numContacts === 0;
      if (doAirControl) {
        let pitchScale = 1;
        if (isFlipping) pitchScale = 0;
        else if (hasFlipped && flipTime < config.flipTorqueTime + config.flipPitchLockExtraTime) pitchScale = 0;
        const p = input.pitch * pitchScale;
        const accel = add(
          add(scale(right, p * config.airPitchAccel), scale(up, -input.yaw * config.airYawAccel)),
          scale(fwd, input.roll * config.airRollAccel)
        );
        const damp = add(
          add(
            scale(right, dot(w, right) * config.airPitchDamping * (1 - Math.abs(p))),
            scale(up, dot(w, up) * config.airYawDamping * (1 - Math.abs(input.yaw)))
          ),
          scale(fwd, dot(w, fwd) * config.airRollDamping)
        );
        w = add(w, scale(sub(accel, damp), dt));
      }
      if (input.throttle !== 0) v = add(v, scale(fwd, input.throttle * config.airThrottleAccel * dt));
    } else {
      isFlipping = false;
    }

    // 5. Jump -------------------------------------------------------------------
    if (onGround && !isJumping) {
      if (!(hasJumped && jumpTime < config.jumpMinTime + 1 / 40)) {
        hasJumped = false;
        jumpTime = 0;
      }
    }
    if (isJumping) {
      isJumping = jumpTime < config.jumpMinTime || (jumpHeld && jumpTime < config.jumpMaxTime);
    } else if (onGround && actionPressed) {
      isJumping = true;
      jumpTime = 0;
      v = add(v, scale(up, config.jumpImpulse));
    }
    if (isJumping) {
      hasJumped = true;
      const holdScale = jumpTime < config.jumpMinTime ? config.jumpPreMinAccelScale : 1;
      v = add(v, scale(up, config.jumpHoldAccel * holdScale * dt));
    }
    if (isJumping || hasJumped) jumpTime += dt;

    // 6. Auto-flip (jump while resting on the roof) -------------------------------
    if (actionPressed && worldContactNormal && worldContactNormal.y > Math.SQRT1_2 && up.y < -0.7) {
      isAutoFlipping = true;
      autoFlipTimer = config.autoFlipTime;
      autoFlipDir = right.y >= 0 ? 1 : -1;
      v = add(v, scale(up, -config.autoFlipImpulse));
    }
    if (isAutoFlipping) {
      if (autoFlipTimer <= 0) {
        isAutoFlipping = false;
      } else {
        w = add(w, scale(fwd, config.autoFlipRollAccel * autoFlipDir * dt));
        autoFlipTimer -= dt;
      }
    }

    // 7. Double jump / dodge --------------------------------------------------------
    if (onGround) {
      hasDoubleJumped = false;
      hasFlipped = false;
      airTimeSinceJump = 0;
      flipTime = 0;
    } else {
      if (hasJumped && !isJumping) airTimeSinceJump += dt;
      else airTimeSinceJump = 0;

      const hasAirAction = !hasDoubleJumped && !hasFlipped && !isAutoFlipping;
      if (actionPressed && hasAirAction && airTimeSinceJump < config.doubleJumpWindow) {
        const inputMag = Math.abs(input.pitch) + Math.abs(input.yaw) + Math.abs(input.roll);
        if (inputMag >= config.dodgeDeadzone) {
          // Dodge
          hasFlipped = true;
          isFlipping = true;
          flipLock = config.flipLockTime;
          flipTime = 0;
          let dFwd = -input.pitch;
          let dSide = input.yaw + input.roll;
          if (Math.abs(dSide) < 0.1 && Math.abs(dFwd) < 0.1) {
            dFwd = 0;
            dSide = 0;
          } else {
            const l = Math.hypot(dFwd, dSide);
            dFwd /= l;
            dSide /= l;
          }
          flipPitchDir = dFwd;
          flipRollDir = dSide;
          if (Math.abs(dFwd) < 0.1) dFwd = 0;
          if (Math.abs(dSide) < 0.1) dSide = 0;
          if (dFwd !== 0 || dSide !== 0) {
            const speedRatio = Math.abs(forwardSpeed) / config.maxSpeed;
            const backwards = Math.abs(forwardSpeed) < 1 ? dFwd < 0 : dFwd >= 0 !== forwardSpeed >= 0;
            let ix = dFwd * config.flipInitialVel;
            let iy = dSide * config.flipInitialVel;
            const maxScaleX = backwards ? config.flipBackwardSpeedScale : config.flipForwardSpeedScale;
            ix *= (maxScaleX - 1) * speedRatio + 1;
            iy *= (config.flipSideSpeedScale - 1) * speedRatio + 1;
            if (backwards) ix *= config.flipBackwardImpulseScale;
            // Nose vertical (wall jumps, aerials): the flattened nose is ~0, so use the roof direction.
            const f2 = Math.hypot(fwd.x, fwd.z) > 0.1 ? normalize(v3(fwd.x, 0, fwd.z)) : normalize(v3(up.x * -Math.sign(fwd.y || 1), 0, up.z * -Math.sign(fwd.y || 1)));
            const r2 = cross(f2, v3(0, 1, 0));
            v = add(v, add(scale(f2, ix), scale(r2, iy)));
          }
        } else {
          // Double jump
          v = add(v, scale(up, config.jumpImpulse));
          hasDoubleJumped = true;
        }
      }
    }
    if (isFlipping) {
      flipTime += dt;
      if (
        flipTime <= config.flipTorqueTime &&
        flipTime >= config.flipZDampStart &&
        (v.y < 0 || flipTime < config.flipZDampEnd)
      ) {
        v.y *= Math.pow(1 - config.flipZDampPer120, tickScale);
      }
    } else if (hasFlipped) {
      flipTime += dt;
    }

    // 8. Auto-roll: pull a partially-landed car flush with the surface while throttling
    if (input.throttle !== 0 && ((numContacts > 0 && numContacts < 4) || (numContacts === 0 && worldContactNormal))) {
      const gUp = numContacts > 0 ? groundUp : worldContactNormal!;
      v = add(v, scale(gUp, -config.autoRollDownAccel * dt));
      w = add(w, scale(cross(up, gUp), config.autoRollAccel * dt));
    }

    // 9. Boost -----------------------------------------------------------------------
    if (hasBoostFuel) {
      boosting = boosting ? input.boost || boostingTime < config.boostMinTime : input.boost;
    } else {
      boosting = false;
    }
    boostingTime = boosting ? boostingTime + dt : 0;
    if (boosting) {
      if (!unlimitedBoost) boostUnits = Math.max(0, boostUnits - config.boostPerSecond * dt);
      v = add(v, scale(fwd, (onGround ? config.boostAccelGround : config.boostAccelAir) * dt));
    }

    body.setLinvel(v, true);
    body.setAngvel(w, true);
  };

  const postStep = (dt: number) => {
    if (demoed) {
      respawnTimer -= dt;
      if (respawnTimer <= 0) {
        demoed = false;
        if (pendingRespawn) reset(pendingRespawn.pos, pendingRespawn.yaw);
        handle.onRespawn?.();
      }
      return;
    }
    const v = body.linvel();
    const speed = Math.hypot(v.x, v.y, v.z);
    if (speed > config.maxSpeed) {
      const k = config.maxSpeed / speed;
      body.setLinvel({ x: v.x * k, y: v.y * k, z: v.z * k }, true);
    }
    const w = body.angvel();
    const spin = Math.hypot(w.x, w.y, w.z);
    if (spin > config.maxAngularSpeed) {
      const k = config.maxAngularSpeed / spin;
      body.setAngvel({ x: w.x * k, y: w.y * k, z: w.z * k }, true);
    }
    const s = Math.min(speed, config.maxSpeed);
    if (supersonic && supersonicTime < 1) supersonic = s >= config.supersonicSpeed - 1;
    else supersonic = s >= config.supersonicSpeed;
    supersonicTime = supersonic ? supersonicTime + dt : 0;
    if (handle.bumpCooldown > 0) handle.bumpCooldown = Math.max(0, handle.bumpCooldown - dt);
  };

  const getTransform = (): TransformSnapshot => {
    const t = body.translation();
    const r = body.rotation();
    const lv = body.linvel();
    const av = body.angvel();
    return {
      x: t.x, y: t.y, z: t.z,
      qx: r.x, qy: r.y, qz: r.z, qw: r.w,
      vx: lv.x, vy: lv.y, vz: lv.z,
      wx: av.x, wy: av.y, wz: av.z,
    };
  };

  const handle: CarPhysicsHandle = {
    id,
    team,
    body,
    hitbox,
    config,
    get boostUnits() { return boostUnits; },
    set boostUnits(val: number) { boostUnits = clamp(val, 0, config.boostMax); },
    get unlimitedBoost() { return unlimitedBoost; },
    set unlimitedBoost(val: boolean) { unlimitedBoost = val; },
    get score() { return score; },
    set score(val: number) { score = val; },
    get lastInputSeq() { return lastInputSeq; },
    get isDemoed() { return demoed; },
    wheels,
    bumpCooldown: 0,
    preStep,
    postStep,
    reset: (pos, yaw, boost) => { pendingRespawn = null; reset(pos, yaw, boost); },
    demolish,
    setRespawn: (p, yaw) => { pendingRespawn = { pos: p, yaw }; },
    addBoost: (amount) => { boostUnits = clamp(boostUnits + amount, 0, config.boostMax); },
    getSnapshot: () => ({
      id,
      team,
      transform: getTransform(),
      boost: Math.round(boostUnits * 10) / 10,
      isGrounded: onGround,
      isBoosting: boosting,
      isDodging: isFlipping,
      isSupersonic: supersonic,
      isPowersliding: handbrakeVal > 0.5 && onGround,
      isDemoed: demoed,
      score,
      lastInputSeq,
    }),
    getTransform,
    forward: () => basis().fwd,
    isGrounded: () => onGround,
    isBoosting: () => boosting,
    isDodging: () => isFlipping,
    isSupersonic: () => supersonic,
    isPowersliding: () => handbrakeVal > 0.5 && onGround,
  };

  return handle;
}
