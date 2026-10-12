import RAPIER from '@dimforge/rapier3d-compat';
import {
  CAR_CONFIG,
  CarConfig,
  PlayerInput,
  PlayerStateSnapshot,
  Team,
  TransformSnapshot,
  Vec3,
  quatRotateVector,
  vec3,
  vec3Add,
  vec3Cross,
  vec3Dot,
  vec3Length,
  vec3Normalize,
  vec3Scale,
  vec3Sub,
  clamp,
} from '@aerial-arena/shared';

export interface CarPhysicsHandle {
  id: string;
  team: Team;
  body: RAPIER.RigidBody;
  chassisCollider: RAPIER.Collider;
  cabinCollider: RAPIER.Collider;
  boostUnits: number;
  unlimitedBoost: boolean;
  score: number;
  lastInputSeq: number;
  update(input: PlayerInput, dt: number): void;
  reset(pos: Vec3, yaw: number): void;
  addBoost(amount: number): void;
  getSnapshot(): PlayerStateSnapshot;
  getTransform(): TransformSnapshot;
  isGrounded(): boolean;
  isBoosting(): boolean;
  isDodging(): boolean;
}

export function createCar(
  world: RAPIER.World,
  id: string,
  team: Team,
  initialPos: Vec3 = { x: 0, y: 0.6, z: 0 },
  initialYaw = 0,
  config: CarConfig = CAR_CONFIG
): CarPhysicsHandle {
  const halfYaw = initialYaw * 0.5;
  const initialRot = { x: 0, y: Math.sin(halfYaw), z: 0, w: Math.cos(halfYaw) };

  // Dynamic rigid body
  const bodyDesc = RAPIER.RigidBodyDesc.dynamic()
    .setTranslation(initialPos.x, initialPos.y, initialPos.z)
    .setRotation(initialRot)
    .setLinearDamping(0.08)
    .setAngularDamping(config.airAngularDamping)
    .setCcdEnabled(true);

  const body = world.createRigidBody(bodyDesc);

  // Chassis main box: 3.5m length (Z), 1.8m width (X), 0.8m height (Y)
  const chassisHalfX = config.width * 0.5;
  const chassisHalfY = 0.35;
  const chassisHalfZ = config.length * 0.5;
  const chassisDesc = RAPIER.ColliderDesc.cuboid(chassisHalfX, chassisHalfY, chassisHalfZ)
    .setTranslation(0, 0.35, 0)
    .setDensity(config.mass / (config.width * config.height * config.length))
    .setFriction(0.6)
    .setRestitution(0.2);
  const chassisCollider = world.createCollider(chassisDesc, body);

  // Cabin upper box: 1.8m length (Z), 1.4m width (X), 0.45m height (Y)
  const cabinDesc = RAPIER.ColliderDesc.cuboid(0.65, 0.22, 0.85)
    .setTranslation(0, 0.85, -0.2)
    .setDensity(50)
    .setFriction(0.3)
    .setRestitution(0.2);
  const cabinCollider = world.createCollider(cabinDesc, body);

  let boostUnits = config.maxBoostUnits;
  let unlimitedBoost = false;
  let score = 0;
  let lastInputSeq = 0;

  // Jump & dodge state
  let jumpCount = 0; // 0 = grounded, 1 = first jump, 2 = second action consumed
  let jumpHoldTimer = 0;
  let dodgeTimer = 0;
  let isDodgingActive = false;
  let dodgeTimeRemaining = 0;
  let lastJumpInput = false;

  // Ground detection state
  let grounded = false;
  let currentSurfaceNormal: Vec3 = { x: 0, y: 1, z: 0 };
  let boosting = false;

  const reset = (pos: Vec3, yaw: number) => {
    const hy = yaw * 0.5;
    body.setTranslation({ x: pos.x, y: pos.y, z: pos.z }, true);
    body.setRotation({ x: 0, y: Math.sin(hy), z: 0, w: Math.cos(hy) }, true);
    body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    body.setAngvel({ x: 0, y: 0, z: 0 }, true);

    boostUnits = config.maxBoostUnits;
    jumpCount = 0;
    jumpHoldTimer = 0;
    dodgeTimer = 0;
    isDodgingActive = false;
    dodgeTimeRemaining = 0;
    lastJumpInput = false;
    grounded = true;
    boosting = false;
  };

  const addBoost = (amount: number) => {
    boostUnits = clamp(boostUnits + amount, 0, config.maxBoostUnits);
  };

  /**
   * Surface & Ground check using multi-ray probe from car chassis base
   */
  const checkSurfaceSupport = (): { isGrounded: boolean; normal: Vec3 } => {
    const pos = body.translation();
    const rot = body.rotation();

    const localDown = quatRotateVector(rot, { x: 0, y: -1, z: 0 });
    const localFwd = quatRotateVector(rot, { x: 0, y: 0, z: 1 });
    const localRight = quatRotateVector(rot, { x: 1, y: 0, z: 0 });

    // 5 ray probe points: center and 4 wheels from chassis base
    const rayLength = 0.85;
    const probeOffsets = [
      vec3(0, 0, 0),
      vec3Add(vec3Scale(localRight,  0.8), vec3Scale(localFwd,  1.2)),
      vec3Add(vec3Scale(localRight, -0.8), vec3Scale(localFwd,  1.2)),
      vec3Add(vec3Scale(localRight,  0.8), vec3Scale(localFwd, -1.2)),
      vec3Add(vec3Scale(localRight, -0.8), vec3Scale(localFwd, -1.2)),
    ];

    let hits = 0;
    let avgNormal = vec3(0, 0, 0);

    for (const offset of probeOffsets) {
      const origin = vec3Add(pos, offset);
      const ray = new RAPIER.Ray(origin, localDown);
      const hit = world.castRayAndGetNormal(
        ray,
        rayLength,
        true,
        undefined,
        undefined,
        undefined,
        body
      );

      if (hit && hit.timeOfImpact <= rayLength) {
        hits++;
        avgNormal = vec3Add(avgNormal, hit.normal);
      }
    }

    if (hits > 0) {
      const normal = vec3Normalize(avgNormal);
      return { isGrounded: true, normal };
    }

    // World floor fallback if resting on floor
    if (pos.y <= 0.70) {
      return { isGrounded: true, normal: { x: 0, y: 1, z: 0 } };
    }

    return { isGrounded: false, normal: { x: 0, y: 1, z: 0 } };
  };

  const update = (input: PlayerInput, dt: number) => {
    lastInputSeq = input.seq;
    const pos = body.translation();
    const rot = body.rotation();
    let linvel = body.linvel();
    let angvel = body.angvel();

    // Direction vectors in world coordinates
    const fwd = quatRotateVector(rot, { x: 0, y: 0, z: 1 });
    const up = quatRotateVector(rot, { x: 0, y: 1, z: 0 });
    const right = quatRotateVector(rot, { x: 1, y: 0, z: 0 });

    const fwdSpeed = vec3Dot(linvel, fwd);
    const rightSpeed = vec3Dot(linvel, right);
    const upSpeed = vec3Dot(linvel, up);

    // 1. Surface & Ground Check
    const support = checkSurfaceSupport();
    currentSurfaceNormal = support.normal;

    // A car that has jumped is airborne while ascending or holding jump
    if (jumpCount > 0 && (linvel.y > 0.3 || jumpHoldTimer > 0 || pos.y > 0.75)) {
      grounded = false;
    } else {
      grounded = support.isGrounded;
    }

    if (grounded) {
      jumpCount = 0;
      dodgeTimer = 0;
      isDodgingActive = false;
      dodgeTimeRemaining = 0;
    } else {
      if (dodgeTimer > 0) {
        dodgeTimer -= dt;
      }
    }

    // 2. Jump Handling
    const jumpEdge = input.jump && !lastJumpInput;
    lastJumpInput = input.jump;

    if (jumpEdge) {
      if (grounded) {
        // First Jump: upward impulse along vehicle local Up or ground normal
        const jumpDir = up.y > 0.3 ? up : { x: 0, y: 1, z: 0 };
        const impulse = vec3Scale(jumpDir, config.firstJumpImpulse);
        body.applyImpulse(impulse, true);

        grounded = false;
        jumpCount = 1;
        jumpHoldTimer = config.jumpHoldDuration;
        dodgeTimer = config.dodgeWindow;
      } else if (jumpCount === 1 && dodgeTimer > 0) {
        // Second Airborne Action: Double Jump or Directional Dodge/Flip
        const throttleInput = input.throttle;
        const steerInput = input.steer;
        const dirMag = Math.hypot(throttleInput, steerInput);

        if (dirMag > 0.2) {
          // Directional Dodge
          isDodgingActive = true;
          dodgeTimeRemaining = 0.65; // duration of dodge maneuver

          // Compute dodge impulse vector in local frame
          const dodgeDirLocal = vec3Normalize({
            x: steerInput,
            y: 0,
            z: throttleInput,
          });
          const dodgeDirWorld = quatRotateVector(rot, dodgeDirLocal);

          // Cancel existing vertical velocity for crisp dodge snap
          body.setLinvel({ x: linvel.x, y: linvel.y * 0.2, z: linvel.z }, true);

          // Apply dodge impulse
          const dodgeImpulseVec = vec3Scale(dodgeDirWorld, config.dodgeImpulse);
          body.applyImpulse(dodgeImpulseVec, true);

          // Apply angular flip torque
          // Forward dodge pitches nose down (torque around X)
          // Side dodge rolls car (torque around Z)
          const torqueLocal = {
            x: -throttleInput * 30000,
            y: 0,
            z: -steerInput * 30000,
          };
          const torqueWorld = quatRotateVector(rot, torqueLocal);
          body.applyTorqueImpulse(torqueWorld, true);
        } else {
          // Neutral Double Jump
          const impulse = vec3Scale(up, config.doubleJumpImpulse);
          body.applyImpulse(impulse, true);
        }

        jumpCount = 2;
      }
    }

    // Variable jump height hold force
    if (jumpHoldTimer > 0) {
      jumpHoldTimer -= dt;
      if (input.jumpHeld && !grounded) {
        const holdForce = vec3Scale(up, config.jumpHoldForce);
        body.applyImpulse(vec3Scale(holdForce, dt), true);
      } else {
        jumpHoldTimer = 0;
      }
    }

    // Dodge animation countdown
    if (isDodgingActive) {
      dodgeTimeRemaining -= dt;
      if (dodgeTimeRemaining <= 0) {
        isDodgingActive = false;
      }
    }

    // 3. Boost Execution
    boosting = false;
    if (input.boost && (boostUnits > 0 || unlimitedBoost)) {
      boosting = true;
      if (!unlimitedBoost) {
        boostUnits = Math.max(0, boostUnits - config.boostConsumption * dt);
      }
      // Apply boost acceleration along nose
      const boostForce = vec3Scale(fwd, config.boostAcceleration * config.mass);
      body.applyImpulse(vec3Scale(boostForce, dt), true);
    }

    // 4. Ground Driving Mechanics
    if (grounded) {
      linvel = body.linvel();
      const currentFwdSpeed = vec3Dot(linvel, fwd);
      const currentRightSpeed = vec3Dot(linvel, right);

      // A. Drive / Reverse / Brake Force
      const maxSpeed = boosting ? config.maxBoostSpeed : config.maxForwardSpeed;
      if (input.throttle > 0.05) {
        if (currentFwdSpeed < maxSpeed) {
          const driveForce = vec3Scale(fwd, input.throttle * config.groundDriveForce);
          body.applyImpulse(vec3Scale(driveForce, dt), true);
        }
      } else if (input.throttle < -0.05) {
        if (currentFwdSpeed > 1.0) {
          // Braking
          const brakeForce = vec3Scale(fwd, -config.brakeForce);
          body.applyImpulse(vec3Scale(brakeForce, dt), true);
        } else if (currentFwdSpeed > -config.reverseSpeed) {
          // Reversing
          const revForce = vec3Scale(fwd, input.throttle * config.groundDriveForce * 0.7);
          body.applyImpulse(vec3Scale(revForce, dt), true);
        }
      } else {
        // Natural rolling engine resistance
        if (Math.abs(currentFwdSpeed) > 0.2) {
          const rollResist = vec3Scale(fwd, -Math.sign(currentFwdSpeed) * 3500);
          body.applyImpulse(vec3Scale(rollResist, dt), true);
        }
      }

      // B. Lateral Grip / Powerslide
      const frictionCoeff = input.powerslide
        ? config.powerslideFriction
        : config.lateralFriction;
      // Eliminate lateral velocity according to friction coefficient
      const lateralCorrection = vec3Scale(right, -currentRightSpeed * frictionCoeff * 0.95);
      body.applyImpulse(vec3Scale(lateralCorrection, config.mass), true);

      // C. Speed-Sensitive Steering
      if (Math.abs(input.steer) > 0.05) {
        const speedRatio = clamp(Math.abs(currentFwdSpeed) / config.maxForwardSpeed, 0, 1);
        const steerFactor = 1.0 - speedRatio * (1.0 - config.steerSensitivity);
        const steerDir = currentFwdSpeed < -0.5 ? -input.steer : input.steer;
        const targetYawRate = -steerDir * 4.2 * steerFactor;

        // Apply yaw angular velocity directly on ground for responsive steering
        angvel = body.angvel();
        const yawImpulse = vec3Scale(up, (targetYawRate - vec3Dot(angvel, up)) * config.mass * 0.4);
        body.applyTorqueImpulse(yawImpulse, true);
      } else {
        // Yaw stabilization on ground
        angvel = body.angvel();
        const curYawRate = vec3Dot(angvel, up);
        if (Math.abs(curYawRate) > 0.1) {
          body.applyTorqueImpulse(vec3Scale(up, -curYawRate * config.mass * 0.3), true);
        }
      }

      // D. Surface Normal Alignment & Adhesion
      // Align car up vector with support surface normal
      const upDotNormal = vec3Dot(up, currentSurfaceNormal);
      if (upDotNormal < 0.99) {
        const alignAxis = vec3Cross(up, currentSurfaceNormal);
        body.applyTorqueImpulse(vec3Scale(alignAxis, 6000 * dt), true);
      }

      // Downward adhesion force to stick to ground / curved wall ramps
      const adhesionForce = vec3Scale(currentSurfaceNormal, -config.mass * 9.81 * 0.5);
      body.applyImpulse(vec3Scale(adhesionForce, dt), true);
    } else {
      // 5. Airborne Mechanics & Flight Control
      if (!isDodgingActive) {
        // Pitch: input.pitch or input.throttle
        const pitchVal = input.pitch !== 0 ? input.pitch : input.throttle;
        if (Math.abs(pitchVal) > 0.05) {
          const pitchTorque = vec3Scale(right, pitchVal * config.airPitchTorque);
          body.applyTorqueImpulse(vec3Scale(pitchTorque, dt), true);
        }

        // Yaw: input.yaw or input.steer
        const yawVal = input.yaw !== 0 ? input.yaw : input.steer;
        if (Math.abs(yawVal) > 0.05) {
          const yawTorque = vec3Scale(up, -yawVal * config.airYawTorque);
          body.applyTorqueImpulse(vec3Scale(yawTorque, dt), true);
        }

        // Dedicated Air Roll (Q / E or roll input)
        if (Math.abs(input.roll) > 0.05) {
          const rollTorque = vec3Scale(fwd, input.roll * config.airRollTorque);
          body.applyTorqueImpulse(vec3Scale(rollTorque, dt), true);
        }
      }
    }

    // Velocity clamp to maximum absolute physical bounds
    linvel = body.linvel();
    const currentSpeed = vec3Length(linvel);
    const absoluteMaxSpeed = config.maxBoostSpeed + 2; // small headroom
    if (currentSpeed > absoluteMaxSpeed) {
      const clampedVel = vec3Scale(vec3Normalize(linvel), absoluteMaxSpeed);
      body.setLinvel(clampedVel, true);
    }
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

  const getSnapshot = (): PlayerStateSnapshot => {
    return {
      id,
      team,
      transform: getTransform(),
      boost: Math.round(boostUnits * 10) / 10,
      isGrounded: grounded,
      isBoosting: boosting,
      isDodging: isDodgingActive,
      score,
      lastInputSeq,
    };
  };

  return {
    id,
    team,
    body,
    chassisCollider,
    cabinCollider,
    get boostUnits() { return boostUnits; },
    set boostUnits(v: number) { boostUnits = clamp(v, 0, config.maxBoostUnits); },
    get unlimitedBoost() { return unlimitedBoost; },
    set unlimitedBoost(v: boolean) { unlimitedBoost = v; },
    get score() { return score; },
    set score(v: number) { score = v; },
    get lastInputSeq() { return lastInputSeq; },
    update,
    reset,
    addBoost,
    getSnapshot,
    getTransform,
    isGrounded: () => grounded,
    isBoosting: () => boosting,
    isDodging: () => isDodgingActive,
  };
}
