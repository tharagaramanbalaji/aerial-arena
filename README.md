# Aerial Arena

Aerial Arena is an original, browser-first, physics-driven 3D car-soccer game. Inspired by the movement mechanics and flow of the car-soccer genre, it features 100% original procedural visuals, custom arcade physics, a server-authoritative 60 Hz simulation, an in-memory 1v1 matchmaking queue, dual camera rigs (Ball Cam and Car Cam), and solo Free Play.

---

## Features

- **Authoritative Real-Time 1v1 Multiplayer**:
  - Two human players paired via an atomic in-memory queue (no bots, no fakes).
  - Fixed 60 Hz physics simulation on the server using Rapier 3D WASM (`@dimforge/rapier3d-compat`).
  - 30 Hz compact sequenced snapshots with client interpolation.
  - Reconnect grace window (10s) with session tokens and forfeit handling.
- **Solo Free Play**:
  - Offline-ready solo sandbox with local Rapier 3D simulation.
  - Practice controls: reset ball (`R`), reset car (`Backspace`), toggle unlimited boost (`U`), launch ball (`1`), practice shot toward goal (`2`).
- **Original Stylized Visuals & Three Arenas**:
  - One original aerodynamic sports car silhouette with team-color materials (Blue sapphire vs Orange amber).
  - 3 visually distinct procedural arenas sharing identical physical dimensions and boost pad coordinates:
    1. **Foundry**: Industrial sports arena with warm floodlights and exposed steel trusses.
    2. **Neon Grid**: Synthwave night arena with dark turf and cyan/magenta glowing gridlines.
    3. **Coastal Dome**: Bright airy stadium with daylight glass dome and athletic turf.
- **Responsive Arcade Vehicle Physics**:
  - Speed-sensitive ground drive, reverse, and braking.
  - Powerslide handbrake drift (`Left Ctrl`) with reduced lateral grip.
  - Variable-height first jump (`Space` hold window).
  - Second airborne action: Directional flip/dodge with directional inputs, or neutral double-jump.
  - Supersonic boost propulsion (`Left Shift`) along car nose with resource depletion (100 units).
  - 28 boost pads (6 big +100 pads, 22 small +12 pads) with authoritative cooldowns.
  - Continuous Collision Detection (CCD) dynamic ball with realistic wall and ceiling rebounds.
  - Swept goal-plane crossing detector with debounce.
- **Dual Camera Rigs**:
  - **Ball Cam**: Dynamic framing pointing toward the ball while keeping the car framed in the lower-middle foreground.
  - **Car Cam**: Horizon-stabilized chase camera following car travel heading without nauseating rolls.
  - Toggle key: `C`.
- **Zero External Remote Assets**:
  - All 3D meshes and stadium geometry are procedurally generated in Three.js.
  - Sound effects (engine rumble, boost roar, jump whoosh, ball impacts, goal explosion, countdown beeps) are 100% procedurally synthesized in real-time via the Web Audio API.

---

## Controls

| Key | Action | Context |
|---|---|---|
| **W / Up Arrow** | Accelerate | Ground & Air Pitch |
| **S / Down Arrow** | Brake / Reverse | Ground & Air Pitch |
| **A / D or Left / Right** | Steer (Ground) / Air Yaw | Driving & Aerials |
| **Space** | Jump / Double Jump / Directional Dodge | Vehicle Action |
| **Left Shift** | Boost | Continuous Acceleration |
| **Left Ctrl** | Powerslide | Handbrake Drift |
| **Q / E** | Air Roll Left / Right | Airborne Maneuvering |
| **C** | Toggle Ball Cam / Car Cam | Local Camera Rig |
| **R** | Reset Ball to Center | Solo Free Play Only |
| **Backspace** | Reset Car to Kickoff | Solo Free Play Only |
| **U** | Toggle Unlimited Boost | Solo Free Play Only |
| **1** | Launch Ball Upward | Solo Free Play Only |
| **2** | Practice Shot Toward Goal | Solo Free Play Only |
| **Esc** | Match Menu / Settings | In-Game Pause |

---

## Project Architecture

```
aerial-arena/
├── apps/
│   ├── client/                  # Vite + Three.js client application
│   │   ├── src/
│   │   │   ├── audio/           # Procedural Web Audio API sound synthesizer
│   │   │   ├── camera/          # Ball Cam & Car Cam rigs
│   │   │   ├── freeplay/        # Solo Free Play manager (local Rapier simulation)
│   │   │   ├── input/           # Keyboard capture & edge triggers
│   │   │   ├── net/             # WebSocket network client & snapshot buffer
│   │   │   ├── renderer/        # Three.js car, ball, and 3 arena themes
│   │   │   ├── ui/              # Accessible HUD & menu overlay
│   │   │   └── main.ts          # Main application coordinator
│   │   └── index.html
│   └── server/                  # Authoritative Node.js WebSocket server
│       ├── src/
│       │   ├── gameRoom.ts      # 60 Hz authoritative room loop & 30 Hz broadcaster
│       │   ├── matchmaker.ts    # Atomic 1v1 queue pairing & cancellation
│       │   ├── server.ts        # HTTP & WebSocket server instance
│       │   └── index.ts         # Server entry point
│       └── test/                # Matchmaker, room, and E2E multiplayer tests
├── packages/
│   ├── shared/                  # Contracts, constants, types, math helpers
│   └── game-core/               # Physics world, car controller, ball, arena, pads, goals
│       └── test/                # 15-scenario physics harness and match rules tests
├── docs/                        # PRD and architectural specifications
├── PHYSICS_TUNING.md            # Physics constants, units, hypotheses, and tuning log
└── IMPLEMENTATION_STATUS.md     # Verification gates and release tracking
```

---

## Getting Started

### Prerequisites
- Node.js >= 18.x (tested on Node.js v22.11.0)
- npm >= 9.x (tested on npm 10.9.0)

### 1. Installation
```bash
npm install
```

### 2. Run Client and Server Together
```bash
npm run dev
```
- Client runs at: `http://localhost:3000`
- Server runs at: `http://localhost:3001` (WebSocket at `ws://localhost:3001`)

Alternatively, run in separate terminals:
```bash
# Terminal 1: Server
npm run dev:server

# Terminal 2: Client
npm run dev:client
```

### 3. Run Automated Tests
```bash
# Run all tests (physics harness, matchmaking, rules, E2E multiplayer)
npm test

# Run physics tests only
npm run test:physics
```

### 4. Run Typecheck & Production Build
```bash
# Typecheck all workspaces with strict TypeScript settings
npm run typecheck

# Build shared packages, server, and client for production
npm run build
```

---

## Local Two-Browser 1v1 Playtest Instructions

1. Start the dev server: `npm run dev`.
2. Open Browser Window 1 at `http://localhost:3000`.
3. Open Browser Window 2 (or an Incognito window) at `http://localhost:3000`.
4. In Browser 1, click **"Play Quick Match (1v1)"**.
   - Notice the status updates to *"Searching for Opponent..."* with an active elapsed timer.
5. In Browser 2, click **"Play Quick Match (1v1)"**.
   - Both browser clients are immediately paired into the same room.
   - Browser 1 is assigned **Blue Team** (spawns at -Z facing +Z).
   - Browser 2 is assigned **Orange Team** (spawns at +Z facing -Z).
   - Both screens show the 3-second countdown ("3", "2", "1", "GO!").
6. Drive cars using `W`, `A`, `S`, `D`, `Space` (jump), and `Left Shift` (boost).
7. Strike the ball into the opponent's goal:
   - Scoring triggers a goal explosion and horn sound effect.
   - The HUD updates the score by 1 point.
   - A 3-second reset pause occurs before resetting cars and ball for the next kickoff.
8. Toggle `C` to test **Ball Cam** vs **Car Cam**.
9. Test cancellation: click **Cancel Search** while in queue to verify atomic ticket removal.
10. Test disconnect: close one tab during a live match to observe the 10-second grace countdown and subsequent forfeit result for the remaining player.

---

## Production Deployment Notes

- **Static Client**: The `apps/client/dist` directory produced by `npm run build` can be hosted on any static file server or CDN (e.g. Cloudflare Pages, Vercel, S3).
- **Persistent Server**: `apps/server` requires a persistent Node.js process supporting WebSockets. Set environment variables `PORT=3001` and `HOST=0.0.0.0`.
- **WSS Reverse Proxy**: In production with HTTPS, terminate TLS via Nginx/Caddy and proxy WebSocket traffic to port 3001 with header forwarding (`Upgrade $http_upgrade`).
