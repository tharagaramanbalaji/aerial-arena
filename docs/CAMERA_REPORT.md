# Camera Debug Report

## How Rocket League's camera works (research)
Sources: Epic's help page, plus community guides (see links at the end).

| Setting | What it does in RL | Common pro values |
|---|---|---|
| FOV | Field of view (60–110) | 108–110 |
| Distance | How far behind the car (100–400 uu) | 260–280 uu (≈2.7 m) |
| Height | How high above the car (40–200 uu) | ≈100–105 uu (≈1.0 m) |
| Angle | Downward tilt (−15…0) | −3 to −5 |
| Stiffness | How much the camera stretches back at speed; higher = locked tighter to the car | 0.35–0.46 |
| Swivel speed | How fast the camera turns, including right-stick manual look (1–10) | 4.5–10 (preset 5.2) |
| Transition speed | Speed of switching Ball Cam ↔ Car Cam (1–2) | 1.0–1.2 |
| Camera shake | Speed/impact shake | Usually off |

Public sources do not document the exact camera math, such as roll handling on walls.

## Problems found in our camera
1. Position followed the car with one lerp, so it lagged sideways in turns and vertically on jumps. RL's stiffness only changes the stretch distance.
2. There was no speed stretch, so stiffness didn't behave like RL's.
3. Ball Cam had no swing limit, so it whipped at about 1100°/s when the ball passed overhead or sat on the hood.
4. There was no Transition Speed; mode switches used the follow speed.
5. There was no manual look (right stick), so RL's swivel setting had nothing to control.
6. The view direction was slerped in 3D, so near-180° swings could rotate through vertical.
7. Teleports (resets, respawns) glided across the field instead of snapping.
8. Shake was per-frame random jitter.
9. Setting ranges didn't match RL (FOV up to 120, swivel 1–15).

## Fixes
- The view is now a yaw angle plus a pitch angle, smoothed separately with a 330°/s swing cap, plus a final look stage capped at 300°/s.
- Ball Cam near zone: when the ball is within 1.5–4.5 m horizontally, the aim blends toward the car's heading.
- Stiffness now works like RL's: the camera stretches back by `(1 − stiffness) × speed × 0.055`. Horizontal follow is tight (30/s) and vertical follow softer (14/s).
- New Transition Speed setting (1–2, default 1.2) for Ball Cam ↔ Car Cam switches.
- Right-stick manual look: up to 180° (look behind), scaled by Swivel Speed, returns to center on release.
- The arena clamp applies to the camera's target, not the camera, so walls don't cause jumps. Teleports snap. Shake is a smooth rumble.
- Settings now match RL's ranges: FOV 60–110, distance 1–4 m, swivel 1–10 (default 5.2), transition 1–2.

## Benchmark (`window.__cameraBench()` in dev; 8 scripted scenarios at a fixed 60 fps)

| Scenario | Max °/s before → after | Swings* before → after | Car in frame before → after |
|---|---|---|---|
| Straight boost | 154 → 154 | 0 → 0 | 100 → 100% |
| Hard turn at speed | 106 → 106 | 0 → 0 | 100 → 100% |
| Powerslide 180 | 201 → 201 | 0 → 0 | 100 → 100% |
| Ball passes overhead | **1125 → 300** | **4 → 0** | 91 → 100% |
| Dribble on hood | **1124 → 300** | **4 → 0** | 92 → 100% |
| Jump + front flip | 2 → 2 | 0 → 0 | 100 → 100% |
| Wall ride (Ball Cam) | **2219 → ~300** | **1 → 0** | 98 → 91% |
| Toggle cam while driving | **548 → 192** | 0 → 0 | 100 → 100% |

\*Swing = the view turning more than 120° within 0.4 s. Roll stayed at 0° in every run.

The wall-ride after values come from the final configuration's run (fixed 300°/s cap, one run before the last). Letting the camera turn faster while pinned against a wall raised car framing to 95–97% but brought back 3 swings, so smoothness was chosen.

## Known limits / next ideas
- During wall rides the car is in frame 91% of the time, because the camera is held inside the arena under the car.
- The Ball Cam tilt cap still uses fixed angles; it could adapt to ball speed.
- There's no mouse-look option for keyboard players (RL doesn't have one either).

Sources: [Epic: camera settings in Rocket League](https://www.epicgames.com/help/en-US/rocket-league-c5719357623323/basics-c7261959845275/what-are-camera-settings-in-rocket-league-a5720054403995), [wpreset pro settings](https://wpreset.com/best-rocket-league-camera-settings-for-pro-level-gameplay/), [Gfinity camera guide](https://www.gfinityesports.com/guides/best-rocket-league-camera-settings), [bo3.gg camera guide](https://bo3.gg/games/articles/best-camera-settings-rocket-league).
