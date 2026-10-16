# Aerial Arena

Aerial Arena is an original, browser-first 3D car-soccer game in the style of Rocket League. It uses RL-proportioned physics built from community-measured values (RocketSim / RLBot, converted at 1 uu = 1 cm), a server-authoritative 120 Hz simulation, real 1v1 matchmaking, Ball Cam / Car Cam, and solo Free Play. All visuals and sounds are procedural and original; no Rocket League assets are used.

---

## Features

- **RL-style physics** (`packages/game-core`, tuned in `PHYSICS_TUNING.md`)
  - RL scale: 1.2 m car hitbox, 0.91 m ball radius, 82 × 102 × 20 m arena, gravity −6.5 m/s², 120 Hz ticks.
  - Throttle-torque and steer-angle curves vs speed, slip-based grip, powerslide, sticky force for wall driving.
  - Tap/hold jump, double jump, directional dodges with RL impulses, flip cancel, RL air-control torques, air roll, 5.5 rad/s spin cap.
  - Boost: 33.3/s drain, 0.1 s minimum tap, 33 at kickoff, 6 big + 28 small pads with cooldowns.
  - RL car-ball "extra impulse" for punchy touches; bumps and supersonic demolitions.
  - Curved floor-to-wall and wall-to-ceiling ramps; goal counts when the whole ball is over the line.
- **Server-authoritative 1v1** (`apps/server`)
  - Atomic in-memory queue (humans only), 5:00 clock, 3-2-1 kickoffs on the 5 RL spawn positions, goal pause and reset, sudden-death overtime, 10 s reconnect grace with forfeit.
  - 30 Hz snapshots, client interpolation buffer; a stalled client (hidden tab) is treated as neutral input.
- **Free Play**: the same simulation run locally, with training shortcuts.
- **Visuals**
  - Striped turf with team-tinted halves.
  - Glass hex walls with chevron strips, glowing goal frames and nets.
  - Crowd stands, floodlights, sky.
  - Original Octane-proportioned car, hex-panel ball.
  - Boost trails, supersonic streaks, goal explosions, bloom.
  - Three themes on identical geometry: **Champions Field** (day), **Foundry Night**, **Neon Grid**.
- **RL-style camera & HUD**: 110° FOV, 2.7 m / 1.0 m / −4° chase cam, Ball Cam & Car Cam, skewed scoreboard, circular boost meter.

---

## Controls

| Input | Action |
|---|---|
| **W / S** (↑ / ↓) | Throttle / brake & reverse · in the air: nose down / nose up |
| **A / D** (← / →) | Steer · in the air: yaw |
| **Space** | Jump (hold for height) · second press = double jump · second press + direction = dodge/flip |
| **Left Shift** | Boost |
| **Left Ctrl** | Powerslide · held in the air: A/D become air roll |
| **Q / E** | Air roll left / right |
| **C** | Toggle Ball Cam / Car Cam |
| **Esc** | Menu (does not pause online matches) |
| **H** | Show / hide the controls card |
| **R / Backspace** | Free Play: reset ball / reset car |
| **U** | Free Play: toggle unlimited boost |
| **1 / 2 / 3** | Free Play: pop ball up / lob ball toward you / ball on hood |
| **Gamepad** | RT/LT throttle, left stick steer & pitch, A jump, B boost, X powerslide/air roll, Y camera, LB/RB air roll, Start menu |

All keyboard/mouse bindings can be changed in **Settings → Controls**: click a binding, then press a key or mouse button. Camera settings are in **Settings → Camera**: FOV, distance, height, angle, stiffness, swivel speed, Ball Cam max tilt, shake, and Ball Cam toggle or hold. Settings are saved in the browser.

### Custom car model
Put a `car.glb` in `apps/client/public/models/` and reload. The game fits it to the hitbox, recolors its paint per team and spins its wheels. See `apps/client/public/models/README.md` for naming rules and the optional `car.json`.

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
│   │   │   ├── renderer/        # Arena (shared geometry), car, ball, effects, themes
│   │   │   ├── ui/              # Accessible HUD & menu overlay
│   │   │   └── main.ts          # Main application coordinator
│   │   └── index.html
│   └── server/                  # Authoritative Node.js WebSocket server
│       ├── src/
│       │   ├── gameRoom.ts      # Authoritative room loop (120 Hz physics) & 30 Hz broadcaster
│       │   ├── matchmaker.ts    # Atomic 1v1 queue pairing & cancellation
│       │   ├── server.ts        # HTTP & WebSocket server instance
│       │   └── index.ts         # Server entry point
│       └── test/                # Matchmaker, room, and E2E multiplayer tests
├── packages/
│   ├── shared/                  # Contracts, constants, types, math helpers
│   └── game-core/               # Physics world, car controller, ball, arena geometry, pads, goals
│       ├── scripts/             # physicsProbe.ts (npm run probe:physics)
│       └── test/                # 44-scenario physics harness and match rules tests
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

# Print measured car/ball behaviour vs RL reference values
npm run probe:physics
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
4. In Browser 1, click **Quick Match**.
   - Notice the status updates to *"Searching for Opponent..."* with an active elapsed timer.
5. In Browser 2, click **Quick Match**.
   - Both browser clients are immediately paired into the same room.
   - One browser is **Blue** (defends −Z), the other **Orange** (defends +Z); both use the same random RL kickoff spawn, mirrored.
   - Both screens show the 3-second countdown ("3", "2", "1", "GO!").
6. Drive cars using `W`, `A`, `S`, `D`, `Space` (jump), and `Left Shift` (boost).
7. Strike the ball into the opponent's goal:
   - Scoring triggers a goal explosion and horn sound effect.
   - The HUD updates the score by 1 point.
   - A 3-second reset pause occurs before resetting cars and ball for the next kickoff.
8. Toggle `C` to test **Ball Cam** vs **Car Cam**.
9. Test cancellation: click **Cancel** while in queue to verify atomic ticket removal.
10. Test disconnect: close one tab during a live match to observe the 10-second grace countdown and subsequent forfeit result for the remaining player.

---

## Playing Online

### Private match (play with a friend)
1. Click **Private Match → Create room**. You get a 5-character code (e.g. `N4WJU`) and an invite link (`…/?room=N4WJU`).
2. Your friend opens the invite link (the code is pre-filled) or types the code under **Join**.
3. The match starts for both of you: host is Blue, guest is Orange. Codes are single-use and expire after 15 minutes or when the host leaves.

**Quick Match** still pairs any two players who are searching at the same time.

### Where to test
| Setup | How |
|---|---|
| Same computer | `npm run dev`, open http://localhost:3000 in two browser windows. |
| Same Wi-Fi / LAN | `npm run dev`, then your friend opens `http://<your LAN IP>:3000` (find it with `ipconfig`). Allow Node through Windows Firewall when asked (ports 3000 and 3001). |
| Over the internet | Deploy (below). Tunnels like `cloudflared` also work, but the dev client expects the server on port 3001 of the same host; set `VITE_SERVER_URL` if you tunnel the two ports separately. |

## Deployment

The server can also serve the built game, so production is **one service on one port** (HTTP + WebSocket):

```bash
npm run build:client   # builds apps/client/dist
npm start              # serves the game + match server on $PORT (default 3001)
```

The client finds the server automatically:
- in dev (page on :3000), it uses `:3001`
- when deployed, it uses the same origin (`wss://` on https)

Set `VITE_SERVER_URL` at build time only if the client and server live on different domains.

### Docker
```bash
docker build -t aerial-arena .
docker run -p 8080:8080 aerial-arena   # then open http://localhost:8080
```

### Hosting on Render + Neon (free, accounts persist)
The game runs on Render; player accounts live in a free [Neon](https://neon.tech) Postgres database, so they survive Render's restarts.

**1. Create the database (Neon)**
1. Sign up at [neon.tech](https://neon.tech) and create a project (any name; pick the region closest to your Render region).
2. On the project dashboard click **Connect**, keep **Connection pooling** on, and copy the connection string (`postgresql://...neon.tech/neondb?sslmode=require...`). It contains a password, so don't commit or share it.

The server creates its tables on first start; there is nothing to run in Neon.

**2. Deploy the game (Render)**
1. Go to [render.com](https://render.com), sign up with GitHub, then choose **New + → Blueprint** and select this repo.
2. Render reads `render.yaml` and asks for **DATABASE_URL**. Paste the Neon connection string.
3. Click **Apply**. Render builds the Dockerfile and gives you a URL like `https://aerial-arena.onrender.com`. Share it; invite links work there too.
4. Check the deploy log for `Player database: Postgres (DATABASE_URL)`.

To change the database later: Render dashboard → the service → **Environment** → edit `DATABASE_URL` → Save (it redeploys).

**Free plan limits:**
- Render sleeps the service after about 15 minutes idle; the first visit then takes about a minute.
- Neon suspends the database when idle; the first login after that takes a second or two longer.
- Without `DATABASE_URL`, the server falls back to SQLite on Render's disk, which is wiped on every restart.

Other hosts work too, if they support long-lived WebSockets and a persistent process (Railway, Fly.io, a VPS). Point them at the `Dockerfile` and set `DATABASE_URL` (or `DATA_DIR` on a persistent volume). Static/serverless hosts (Vercel, Netlify, GitHub Pages) cannot run the match server.

### Accounts & data
- Players create a username and password, or continue as a guest.
- The server stores accounts, online wins/losses/goals, and bot results in Postgres when `DATABASE_URL` is set (Neon in production), otherwise in SQLite (via sql.js, no native build) at `$DATA_DIR/aerial-arena.sqlite` for local development.
- Passwords are hashed with scrypt; sessions are random tokens stored as hashes.
- Online results are recorded by the server. Bot results are reported by the client, so they don't count toward the leaderboard.
- Run a **single instance**: matches, rooms and the database live in that one process.
