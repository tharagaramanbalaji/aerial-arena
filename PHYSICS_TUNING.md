# Physics Tuning

All tunables live in `packages/shared/src/constants.ts` (units in names/comments).
World: **Y up, 1 unit = 1 m**, Z = field length (Blue goal at −Z), car local frame forward = +Z, up = +Y, right = −X.

## Where the numbers come from

Rocket League's physics is not officially documented. The values below come from **community reverse-engineering**:
[RocketSim](https://github.com/ZealanL/RocketSim) (MIT license; `RLConst.h`, `CarConfig.cpp`, `Car.cpp`, `Ball.cpp`) and the RLBot community. They are converted at **1 Unreal unit (uu) = 1 cm**. They are labelled *community-measured*, not official. Values marked **HYPOTHESIS** are our own tuning guesses.

The rebuild (October 2026) replaced the previous hand-picked constants, which were not modelled on any reference. The car was 3.5 m long in a 100 m field (about 3× too large relative to the field), gravity was 9.81, and there was no ball-hit model.

## Key parameters

| Area | Parameter | Value | Source |
|---|---|---|---|
| World | gravity | −6.5 m/s² | community (−650 uu/s²) |
| World | physics tick | 120 Hz | community (RL runs at 120 Hz) |
| Arena | half width / half length / height | 40.96 / 51.20 / 20.44 m | community |
| Arena | corner chamfer | \|x\|+\|z\| ≤ 80.64 m | community |
| Arena | floor & ceiling fillet radius | 2.56 m | HYPOTHESIS |
| Arena | goal half width / height / depth | 8.93 / 6.43 / 8.80 m | community |
| Car | hitbox L×W×H (Octane) | 1.205 × 0.867 × 0.387 m, offset (fwd 0.139, up 0.208) | community |
| Car | rest height of body origin | 0.17 m | community |
| Car | mass ratio car : ball | 180 : 30 | community |
| Car | throttle accel vs speed | 16 m/s² × curve [(0,1),(14,0.1),(14.1,0)] | community |
| Car | brake / coast decel | 35 / 5.25 m/s² | community |
| Car | max speed / supersonic | 23.0 / 22.0 m/s | community |
| Car | steer angle vs speed | 0.534 rad @0 … 0.035 rad @30 m/s; curvature = tan(angle)/0.85 m | community |
| Car | powerslide steer angle | 0.392 rad @0 → 0.126 rad @25 m/s | community |
| Car | lateral friction vs slip | 1.0 → 0.2; ×0.1 at full powerslide | community |
| Car | powerslide yaw grip | 0.12 per tick | HYPOTHESIS |
| Car | sticky force | 0.5 g always + (1−\|n.y\|) g while throttling/moving | community |
| Car | suspension | 160 1/s² per wheel, damping 12.5 1/s | HYPOTHESIS (tuned to rest at 0.17 m) |
| Jump | impulse / hold accel / hold time | 2.917 m/s / 14.58 m/s² / 0.025–0.2 s | community |
| Jump | double-jump window | 1.25 s after jump ends | community |
| Dodge | initial velocity | 5 m/s (forward ×1, side ×1.9, back ×2.5 scaled by speed) | community |
| Dodge | torque / duration / Z-damp | 224 (pitch) / 260 (roll) rad/s², 0.65 s, 0.35 per tick 0.15–0.21 s | community |
| Air | pitch / yaw / roll accel | 12.46 / 9.11 / 38.35 rad/s² | community (×2π/65536×1000) |
| Air | damping pitch / yaw / roll | 2.88 / 1.92 / 4.79 1/s | community |
| Air | angular speed cap | 5.5 rad/s | community |
| Boost | consumption / ground accel / air accel | 33.3 /s, 9.92 m/s², 10.58 m/s² | community |
| Boost | min tap / kickoff amount | 0.1 s / 33.3 | community |
| Ball | radius / restitution / drag | 0.9125 m / 0.6 / 0.03 | community |
| Ball | max speed / spin | 60 m/s / 6 rad/s | community |
| Ball hit | extra impulse | dir = relPos (y×0.35, forward part ×0.65), × relSpeed × curve [(0,.65),(5,.65),(23,.55),(46,.30)] | community |
| Contacts | friction ball–arena / car–arena / car–ball | 0.21 / 0.30 / 2.0 | community, solved into per-collider Multiply values |
| Bumps | demolition | supersonic front hit, 3 s respawn | community |

## Implementation notes (deviations from RocketSim)

- **Velocity-level vehicle model.** RocketSim uses a Bullet raycast vehicle with per-wheel friction impulses. We use four suspension rays for support and pitch/roll, but apply drive, brake, lateral friction and steering as velocity changes along the surface. Steering sets yaw rate = speed × curvature, which reproduces RL turning circles: the measured 14.1 m diameter at 14 m/s vs about 12.9 m from the RL curvature table.
- **Extra hit impulse is deferred one tick.** Rapier's first car–ball contact is often speculative. If the extra velocity is added immediately, the next tick's rigid contact absorbs it. It is computed from the pre-contact relative velocity and added after the following solve.
- **No CCD.** Rapier's CCD clamps motion near surfaces, which ate jump and hit velocity. At 120 Hz the fastest car (0.19 m/tick) and ball (0.5 m/tick) move less than their own half-extents per tick, so discrete contacts are sufficient. The chaos/containment test covers this.
- **Restitution.** Car colliders use 0 restitution so car–ball is 0 (as in RL). This also makes car–wall 0 instead of RL's 0.3.
- **Auto-roll / auto-flip** are simplified approximations (HYPOTHESIS gains).

## Measured results (`npm run probe:physics`, 2026-10-12)

| Scenario | Measured | Reference |
|---|---|---|
| Parked height | 0.170 m | 0.17 m |
| Throttle 0 → 13.9 m/s | 2.20 s; caps at 14.10 m/s | analytic from curve 2.18 s; 14.1 m/s |
| Boost from rest → supersonic | 1.6 s; caps 23.0 m/s | cap 23.0 |
| Turning circle at 14 m/s | ~14.1 m diameter | ~12.9 m from curvature table |
| Tap / full / double jump apex | 0.77 / 2.32 / 4.63 m | approx. community full ~2.2–2.3, double ~4.6 |
| Front flip | +4.5 m/s forward after landing friction, spin capped 5.5 rad/s | +5.0 m/s initial |
| Ball dropped from 6 m | first bounce apex 2.67 m | 2.74 m for e = 0.6 |
| Full-boost hit on still ball | ball 30.8 m/s | rigid + extra impulse model |
| Throttle-only wall climb | 9.9 m, attached 75 ticks above 3 m | — |

## Automated scenario tests

`packages/game-core/test/physics.test.ts` (44 tests, tolerance-based):
- parking height
- throttle cap, brake/reverse, coasting
- boost cap and supersonic timing
- speed-dependent turn radius, steering sign, powerslide slip
- tap/full/double jump heights
- dodge impulse, spin cap and second-action limit
- double-jump window expiry, jump-edge de-duplication
- air-control axes and roll-is-fastest
- boost drain, minimum boost tap, kickoff boost and pad cooldowns
- ball bounce and rolling
- boosted hit (extra impulse) and slow dribble
- wall rebound and rolling up the curved ramp
- 60 m/s goal scored once, ball on the line not a goal, post graze, lingering ball counts once
- floor-to-wall drive, steering along the wall, jumping off the wall
- falling off the ceiling, auto-flip from the roof
- 20 s chaos containment
- demolition with respawn, bump
- mirrored kickoffs, no duplicate bodies on reset
- open goal mouth / solid back wall, smooth ramp normals

## Open tuning questions

- Fillet radii (2.56 m) are guesses. RL's actual wall/ceiling curvature should be checked against footage.
- Car–wall restitution is 0 instead of 0.3 (a single Multiply rule can't satisfy all pairs).
- Powerslide yaw grip (0.12/tick) and auto-roll strength (25 rad/s²) are tuned by feel only.
