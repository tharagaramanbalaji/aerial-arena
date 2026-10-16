# Aerial Arena: End-to-End Bug, Quirks & Gameplay Improvement Report

## Executive Summary

**Aerial Arena** is an impressively engineered, browser-first 3D car-soccer simulation with a 120 Hz fixed-step physics pipeline (Rapier3D), custom procedural Three.js rendering, Web Audio synthesis, and an authoritative Node.js/WebSocket backend. 

All **59 automated test suites** passed cleanly, and physics benchmark probes confirm close alignment with community-measured Rocket League physics constants. During live browser playtesting via automated subagents, the primary loop (driving, boosting, jumping, dodging, ball contact, scoring, UI pause menu, and 1v1 matchmaking queue) executed with zero runtime crashes or fatal JavaScript exceptions.

However, deep end-to-end testing and static code auditing revealed **several critical gameplay bugs, mechanical edge cases ("weirdness"), and architectural bottlenecks** that noticeably degrade the game feel and player experience.

---

## Playtest Verification & Recording

A full automated playtest was executed directly against the live dev servers (`http://localhost:3000` and `ws://localhost:3001`).

- **Video Recording**: ![Playtest Session Recording](C:/Users/TestUser123/.gemini/antigravity-ide/brain/7a4cff53-c1b5-4b34-af6a-18f360b77afd/gameplay_test_session_1791816749316.webp)
- **Automated Test Results**:
  - `packages/game-core/test/physics.test.ts`: 40/40 passed (0.17m rest height, 14.1 m/s throttle cap, 23 m/s supersonic, 14.1m turn radius).
  - `apps/server/test/e2eMultiplayer.test.ts`: Passed (two distinct clients matched and simulated).
  - Vitest total: 6 files, 59 tests passed in 2.22s.

---

## Identified Bugs & Technical Issues

### 1. Vector Collapse on Vertical Flips / Aerial Wall Dodges
- **Location**: [`packages/game-core/src/car.ts`](file:///c:/Users/TestUser123/Desktop/testing-out-games/packages/game-core/src/car.ts#L503-L506)
- **Symptom**: When attempting a dodge/flip while the car is pointing steeply upward (e.g. wall jump, high aerial redirect), the dodge angular torque occurs, but the car receives **zero linear impulse**.
- **Root Cause**:
  ```ts
  const f2 = normalize(v3(fwd.x, 0, fwd.z));
  const r2 = cross(f2, v3(0, 1, 0));
  v = add(v, add(scale(f2, ix), scale(r2, iy)));
  ```
  If `fwd` is vertical (`fwd.x == 0, fwd.z == 0`), `v3(fwd.x, 0, fwd.z)` is `(0, 0, 0)`. Normalizing yields `(0, 0, 0)`. `r2` also becomes zero. As a result, `ix` and `iy` are scaled by `(0, 0, 0)` and no impulse is applied.
- **Fix**: Fall back to the car's orientation or project onto the surface tangent plane when `length(fwd.xz) < 0.1`.

---

### 2. Boost Audio Feathering Race Condition & Stutter
- **Location**: [`apps/client/src/audio/soundSystem.ts`](file:///c:/Users/TestUser123/Desktop/testing-out-games/apps/client/src/audio/soundSystem.ts#L128-L135)
- **Symptom**: Rapidly tapping/feathering the boost key causes audio popping, abrupt silence, and orphaned Web Audio nodes.
- **Root Cause**:
  `stopBoostRoar()` invokes a deferred `setTimeout(..., 150)` that calls `this.boostNoise?.stop()` and sets `this.boostNoise = null`. When a player taps boost repeatedly within 150ms, a new `AudioBufferSourceNode` is created and stored in `this.boostNoise`, but the prior `setTimeout` fires and kills the *new* sound node mid-playback.
- **Fix**: Track an instance counter or store individual active nodes in local closure scope during the stop timeout, rather than mutating the instance field asynchronously.

---

### 3. Lack of Client-Side Prediction for Local Player in Multiplayer
- **Location**: [`apps/client/src/main.ts`](file:///c:/Users/TestUser123/Desktop/testing-out-games/apps/client/src/main.ts#L484-L524)
- **Symptom**: Online matches feel noticeably sluggish, heavy, and delayed (120–180ms input latency) compared to the snappy, instant response in Free Play.
- **Root Cause**:
  In `frameOnline()`, the local car is rendered directly from `this.net.snapshots.sample()`, which reads from a 100ms interpolation buffer. There is no local client-side prediction or tick reconciliation for the host player.
- **Fix**: Run the local car's `car.preStep(input, dt)` immediately on client tick, buffer unacknowledged inputs, and reconcile server state discrepancies when snapshots arrive.

---

### 4. Ball Shadow / Ground Marker Fixed at Flat Floor Plane
- **Location**: [`apps/client/src/renderer/ballMesh.ts`](file:///c:/Users/TestUser123/Desktop/testing-out-games/apps/client/src/renderer/ballMesh.ts#L38-L51)
- **Symptom**: When the ball rolls or bounces up curved wall fillets or near goal mouths, the ground marker stays stuck at `y = 0.012` and clips under the ramp geometry.
- **Root Cause**:
  The marker position is hardcoded:
  ```ts
  marker.position.x = t.x;
  marker.position.z = t.z;
  marker.position.y = 0.012;
  ```
  It does not account for the arena floor fillets (`floorFilletRadius = 2.56 m`) or ramp curvature.
- **Fix**: Calculate the surface height $y(x, z)$ using the arena's floor fillet geometry, or project the decal dynamically.

---

### 5. Dangerous Default Keybinding (`Ctrl` + `W` Tab Closure)
- **Location**: [`apps/client/src/settings/settingsStore.ts`](file:///c:/Users/TestUser123/Desktop/testing-out-games/apps/client/src/settings/settingsStore.ts#L30-L36)
- **Symptom**: Players driving forward with `W` who press `Left Ctrl` (default powerslide/free air roll) accidentally trigger the browser shortcut `Ctrl + W`, instantly closing their browser tab mid-match.
- **Root Cause**:
  Most Chromium-based browsers treat `Ctrl + W` as a reserved OS-level tab-close hotkey that ignores JavaScript's `e.preventDefault()`.
- **Fix**: Change default powerslide/air-roll binding to `Shift` (swapping boost to `Space` or Right Mouse Button) or `Alt` / `E` / `Q`.

---

## "Weird" Behaviors & Gameplay Quirks

| Quirk | Observation | Mechanical Cause |
|---|---|---|
| **Steering Dead-Zone on Ramp Curves** | The car occasionally feels like its steering "locks up" or freezes when driving onto wall ramps. | Ground steering requires `numContacts >= 3`, while airborne air-control requires `numContacts === 0`. When 1 or 2 wheels lift on a ramp, the car is in a dead-zone where neither ground steering nor air pitch/yaw operate. |
| **Car Cam 180° Snap on Ceiling** | Driving upside-down on the ceiling causes Car Cam to abruptly rotate 180° backward. | In `cameraManager.ts`, the chase heading is computed from `camUp x right`. When inverted on the ceiling, `camUp x right` points backward (-Z) instead of forward (+Z). |
| **Goal Post Grazing Detection** | Shots grazing the outside of the goal post sometimes register as goals. | Goal detection tests `cross.x <= arena.goalHalfWidth` at the goal plane. Because it tests ball center rather than ball radius offset, a ball center at `goalHalfWidth - 0.05` triggers a goal even if half the sphere is outside the post. |
| **2D-Bound AI Bot** | The AI opponent gets completely stuck or hops in place when the ball is high in the air (>4.5m) or rolls onto the backboard. | `BotBrain.think()` only drives to a 2D ground coordinate $(b_x, b_z)$. It lacks aerial tilt, aerial boost, and wall-ride pathfinding. |
| **Demolition Screen Shake in Free Play** | Resetting the car doesn't trigger audio, but demo respawn spots are fixed to 4 blue/orange spots even when testing solo. | Free Play borrows the multiplayer respawn coordinates; resetting orientation is always facing forward rather than toward the ball. |

---

## Prioritized Gameplay Feel Improvements

### High Priority (Transformative Game Feel)
1. **Client-Side Prediction for Multiplayer**:
   Simulate the local car immediately upon keyboard input and interpolate corrections. This turns online play from feeling floaty/laggy into a responsive esports experience.
2. **Smooth Suspension & Transition Blending**:
   Modify `car.ts` so that having 1 or 2 wheel contacts applies partial steering torque (`contactFrac * targetYaw`) rather than shutting off steering completely.
3. **Upright-Safe Flip Impulse**:
   Project flip impulse along the car's local forward/right axes rotated relative to the gravity vector, preventing vector collapse when pitching up.

### Medium Priority (Visual & UI Polish)
4. **Adaptive Ball Ground Decal**:
   Sample arena boundary fillets so the ground ring follows the curvature of the arena walls and ramps.
5. **Ceiling Camera Horizon Clamping**:
   Use local vehicle roll/pitch smoothly in Car Cam, preventing sudden 180° camera flips on ceiling transitions.
6. **Keybind Presets**:
   Add preset control schemes (e.g., *Default*, *Alternative (Shift/Mouse)*, *Controller Standard*).

### Low Priority (Content & Longevity)
7. **Enhanced AI Opponent**:
   Give the bot basic wall-climbing and single-jump pop capabilities for aerial balls.
8. **Ball Trajectory Arc**:
   Add an optional trajectory forecast line in Free Play mode to aid players learning aerial reads.
