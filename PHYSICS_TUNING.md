# Aerial Arena - Physics Tuning & Specification

This document details the physical parameters, units, starting hypotheses, and test scenarios for Aerial Arena.
All gameplay physics is simulated with `@dimforge/rapier3d-compat` at a fixed 60 Hz (dt = 1/60 s = 0.01667 s).
World coordinates: Three.js convention (Y-up, +Z forward towards Orange goal, -Z forward towards Blue goal or car local +Z/-Z, X lateral). 1 world unit = 1 meter.

## 1. Arena Geometry Specifications
| Parameter | Unit | Value | Description |
|---|---|---|---|
| `length` | m | 100.0 | Full field interior length along Z axis (-50 to +50) |
| `width` | m | 68.0 | Full field interior width along X axis (-34 to +34) |
| `height` | m | 22.0 | Arena ceiling height above floor |
| `cornerBevel` | m | 8.0 | Corner transition radius/bevel |
| `wallRampRadius`| m | 4.0 | Curve blending floor to wall |
| `goalWidth` | m | 17.0 | Goal opening width along X axis (-8.5 to +8.5) |
| `goalHeight` | m | 6.0 | Goal crossbar height above floor |
| `goalDepth` | m | 8.0 | Depth of goal tunnel behind the goal line |

## 2. Car Chassis & Kinematics Tuning
| Parameter | Unit | Value | Notes & Hypothesis |
|---|---|---|---|
| `length` | m | 3.5 | Vehicle bounding length |
| `width` | m | 1.8 | Vehicle bounding width |
| `height` | m | 1.1 | Vehicle bounding height |
| `mass` | kg | 1200.0 | Dynamic rigid body mass |
| `maxForwardSpeed` | m/s | 23.0 | Approx 82.8 km/h without boost |
| `maxBoostSpeed` | m/s | 34.0 | Approx 122.4 km/h with boost |
| `reverseSpeed` | m/s | 12.0 | Max reversing speed |
| `groundDriveForce`| N | 16000.0| Throttle driving acceleration force |
| `brakeForce` | N | 24000.0| Braking deceleration force |
| `steerAngleMax` | rad | 0.55 (~31.5°)| Max front wheel steering at low speed |
| `steerSensitivity`| scalar | 0.45 | High-speed steering falloff factor |
| `lateralFriction` | scalar | 0.95 | Normal lateral tire grip (prevents sliding) |
| `powerslideFriction`| scalar| 0.22 | Reduced grip during handbrake/powerslide |
| `firstJumpImpulse` | N·s | 3800.0 | Instantaneous upward impulse on initial Space press |
| `jumpHoldForce` | N | 6500.0 | Upward force while holding Space (up to 0.2s) |
| `jumpHoldDuration`| s | 0.20 | Maximum hold window for variable jump height |
| `doubleJumpImpulse`| N·s| 3500.0 | Second jump impulse if neutral stick |
| `dodgeImpulse` | N·s | 6000.0 | Directional dodge/flip impulse (pitch/roll/yaw) |
| `dodgeWindow` | s | 1.25 | Time window after leaving ground to execute 2nd jump |
| `boostAcceleration`| m/s²| 18.0 | Forward acceleration applied along car nose |
| `boostConsumption` | units/s| 33.3 | Depletes 100 units in ~3.0 seconds |
| `maxBoostUnits` | units | 100.0 | Standard tank capacity |
| `airPitchTorque`| N·m | 4200.0 | Pitch rate control while airborne |
| `airYawTorque` | N·m | 3800.0 | Yaw rate control while airborne |
| `airRollTorque` | N·m | 4500.0 | Dedicated air-roll (Q / E or roll modifier) |
| `airAngularDamping`| scalar | 2.5 | Damping on angular velocities while airborne |

## 3. Ball Physics Tuning
| Parameter | Unit | Value | Description |
|---|---|---|---|
| `radius` | m | 1.8 | Spherical collider radius |
| `mass` | kg | 30.0 | Ball mass relative to 1200kg car (~1:40 ratio) |
| `gravity` | m/s² | -9.81 | Standard gravity |
| `restitution` | scalar | 0.65 | Restitution on arena bounce (responsive bounce) |
| `carRestitution`| scalar | 0.80 | Restitution on car-ball collision |
| `friction` | scalar | 0.35 | Rolling friction |
| `linearDamping` | scalar | 0.05 | Atmospheric drag |
| `angularDamping`| scalar | 0.10 | Spin dissipation |
| `maxSpeed` | m/s | 42.0 | Maximum allowable ball speed |

## 4. Boost Pads
| Type | Amount | Cooldown | Radius | Positions |
|---|---|---|---|---|
| Small Pad | +12 units | 4.0 s | 1.5 m | Mirrored midfield and lane paths (28 locations) |
| Big Pad | +100 units (full)| 10.0 s | 2.5 m | 6 perimeter locations (corners and sides) |

## 5. Camera Settings
| Rig | FOV | Distance | Height | Angle / Pitch | Smooth Speed |
|---|---|---|---|---|---|
| `Car Cam` | 85° | 8.5 m | 3.2 m | -12° | Pos: 12.0, Rot: 10.0 |
| `Ball Cam`| 90° | 9.0 m | 3.5 m | Dynamic toward ball | Pos: 15.0, Target: 18.0 |

## 6. Repeatable Test Scenarios
- **SCEN-01 (Drive Acceleration)**: Rest to 20 m/s in ~1.5s; clamp at `maxForwardSpeed`.
- **SCEN-02 (Braking & Reverse)**: Drive at 20 m/s, hold S; vehicle slows to stop in < 1.0s, then enters reverse up to 12 m/s.
- **SCEN-03 (Variable Jump)**: Tap Space (0.016s) yields ~1.8m height; Hold Space (0.2s) yields ~3.2m height.
- **SCEN-04 (Dodge Impulse)**: Jump + forward input triggers forward flip with additional forward impulse.
- **SCEN-05 (Powerslide Turn)**: High-speed steering with Ctrl held allows slip angle > 45° with maintained momentum.
- **SCEN-06 (Ball Wall Rebound)**: Launch ball at 20 m/s into wall; rebounds at ~13 m/s with correct normal reflection.
- **SCEN-07 (High-Speed Goal Swept Detection)**: Ball launched at 35 m/s crossing goal line within 1 tick triggers goal detection without skipping.
