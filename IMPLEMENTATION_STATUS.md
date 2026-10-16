# Aerial Arena — Implementation Status

_Last updated: 2026-10-12 (RL-fidelity rebuild)_

## Summary of the rebuild

The first MVP was playable but did not feel or look like Rocket League. This rebuild:

1. **Rescaled everything to RL proportions.** Car 1.2 m (was 3.5 m), ball radius 0.91 m (was 1.8 m), field 81.9 × 102.4 × 20.4 m, gravity −6.5 m/s² (was −9.81).
2. **Rewrote the car controller** around community-measured RL curves: throttle torque vs speed, steer angle vs speed, slip-based lateral friction, powerslide, sticky force, variable jump, double jump, RL dodge impulse/torque/Z-damping/flip-cancel, RL air-control torques and damping, the 5.5 rad/s spin cap, boost with a minimum tap, and auto-roll/auto-flip.
3. **Added RL's car-ball "extra impulse"**, plus bumps and supersonic demolitions.
4. **Replaced the box arena** with a procedural swept-profile arena: octagonal footprint, curved floor-to-wall and wall-to-ceiling fillets, and goal mouths cut into the end walls. The same geometry drives the Rapier trimesh and the renderer.
5. **Rebuilt the visuals** from RL reference screenshots, studied for proportions and style only; no RL assets are used:
   - striped turf with markings and team-tinted halves
   - glass hex walls with chevron base strips, glowing goal frames and nets
   - stands with crowd, floodlights, sky
   - an original Octane-proportioned car, a hex-panel ball
   - boost trail, supersonic streaks, goal explosion, bloom
6. **RL-style camera.** 110° horizontal FOV, 2.7 m distance, 1.0 m height, −4° pitch, Ball Cam orbiting around the car, wall-aligned Car Cam, and passing through the see-through walls.
7. **RL-style HUD.** Skewed score boxes with clock, circular boost meter, and Ball Cam/Car Cam tag.
8. **Online smoothness and safety.** Snapshot interpolation buffer; stalled clients (hidden tab, lost focus) are now treated as neutral input instead of replaying held keys.

## Update 2 (feedback round, 2026-10-12)

- **Ball Cam no longer drops low.** The camera keeps its height and distance behind the car and only tilts toward a high ball. The tilt cap is derived from FOV, height and distance, so the car stays in frame; checked at 4:3 and at 2.6:1 ultra-wide.
- **Boost pads rebuilt** as neon 3D props:
  - big pads: machined octagonal base, neon-edged claw arms, flame petals, light beam, plasma-shader orb
  - small pads: instanced hex base, neon ring and core
  - all pads: a cooldown ring that fills while recharging
- **Floodlights rebuilt** as discrete lamp banks, plus neon team-colored strips on the roof lip and the stands.
- **Boost meter is now a speedometer-style gauge**: needle, ticks, km/h readout, SUPERSONIC lamp.
- **Settings**: rebindable keyboard/mouse controls (2 slots per action), RL-style camera settings, invert air pitch, volume; saved in localStorage.
- **Flips**: the RL rule is kept (one flip per jump, recharged on landing). An added flip lock blocks any new jump or flip until the current flip finishes, and server-buffered jump presses are cleared during countdowns. Two new tests cover this.
- **Custom car models**: `apps/client/public/models/car.glb` (+ optional `car.json`) replaces the built-in car visually. Verified with a generated test model: auto-fit, team recolor, wheel spin, flame placement.

## Feature checklist

- [x] 120 Hz fixed-step simulation (bounded accumulator, max 8 substeps/frame) shared by server and Free Play
- [x] RL-scale arena, car hitbox, ball, gravity, boost pad layout (6 big + 28 small) and 5 kickoff spawns
- [x] Driving, braking, coasting, reverse, speed-dependent steering, powerslide
- [x] Jump (tap/hold), double jump, directional dodges incl. flip cancel, air control with RL axes, air roll (Q/E or Ctrl+A/D)
- [x] Wall and ramp driving with sticky force; falls off the ceiling as in RL; jump off walls
- [x] Boost resource, pads with cooldowns, Free Play unlimited boost
- [x] Car-ball extra impulse, bumps, supersonic demolitions with 3 s respawn
- [x] Goal = entire ball over the line, swept, awarded once
- [x] Server-authoritative 1v1 with in-memory queue, countdown, goal pause/reset, 5:00 clock, ball-touches-floor-at-0:00 rule, sudden-death OT, forfeit after 10 s disconnect
- [x] Three themes on identical geometry: Champions Field (day), Foundry Night, Neon Grid
- [x] Ball Cam / Car Cam (C, or Y on gamepad), HUD label
- [x] Keyboard + gamepad (standard mapping)
- [x] Free Play: reset ball (R), reset car (Backspace), unlimited boost (U), pop ball up (1), lob ball toward me (2), ball on hood (3), goal-reset toggle

## Verification performed (2026-10-12)

| Gate | Result |
|---|---|
| `npm run typecheck` | pass (all 4 workspaces) |
| `npm test` | **59/59 pass** (update 2; was 57/57): 44 physics, 5 match rules, 1 Rapier init, 7 matchmaker, 5 room (incl. new stalled-client test), 1 two-socket E2E |
| `npm run build` | pass (client bundle 2.69 MB / 932 kB gzip, mostly Rapier WASM) |
| `npm run probe:physics` | see PHYSICS_TUNING.md |
| Free Play in browser | driven via the built-in browser: boosting, ball hit (35.7 m/s), wall ride, all 3 themes rendered; no console errors |
| Two-browser Quick Match | two tabs paired, server moved Blue from input, Blue scored, Orange client got the goal and score 1–0, kickoff countdown restarted |
| Disconnect | closed one tab: the other showed the disconnect banner, then Victory by forfeit after 10 s |
| External network requests | none; all textures, models and sounds are procedural |

Browser checks were run in a hidden automation pane, so frames were driven manually. Frame rate on real hardware has **not** been measured.

## Known limitations / next slices

1. **No client-side prediction online.** The local car is rendered from interpolated server snapshots (~100 ms behind), so online controls feel delayed compared with Free Play. Next step: run the local car through the shared `createGameSimulation` and reconcile with `lastInputSeq` acknowledgements.
2. **No client auto-reconnect.** The server supports `game/reconnect` with a resume token, but the client does not attempt it after a dropped socket, so a dropped player forfeits after 10 s.
3. **Car-car friction is too high** (≈2.9 vs RL 0.09). This is a consequence of solving the other contact pairs with Rapier's Multiply combine rule. Bumps/demos are explicit, but sustained car-car scraping is grippier than RL.
4. **Car-wall restitution is 0** (RL 0.3), for the same reason.
5. Arena fillet radii (2.56 m), powerslide yaw grip and auto-roll strength are hypotheses (see PHYSICS_TUNING.md).
6. Bundle size warning from Vite (Rapier WASM is inlined by `rapier3d-compat`).

## Reproduction notes

- Physics probe: `npm run probe:physics` prints measured values vs references.
- Two-browser test: `npm run dev`, open http://localhost:3000 twice, click **Quick Match** in both.
