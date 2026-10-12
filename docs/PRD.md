# Aerial Arena - Product Requirements Document (MVP)

## 1. Product Summary
- **Working Title**: Aerial Arena
- **Genre**: 3D browser-based arcade car-soccer (physics-driven, original procedural assets and physics tuning)
- **Core Modes**:
  1. Solo Free Play (one player, one car, one ball, local client physics, reset/training tools)
  2. Online Quick Match 1v1 (exactly 2 human players paired via server queue, server-authoritative 60 Hz physics, zero bot fillers)
- **Tech Stack**:
  - TypeScript (strict)
  - Vite + Three.js (client WebGL rendering, original procedural assets, Web Audio synthesis)
  - Rapier 3D / WASM (`@dimforge/rapier3d-compat`) for deterministic 3D physics
  - Node.js + WebSocket for matchmaking, authoritative state sync, and snapshot replication
  - Vitest for automated tests across physics, matchmaking, and match rules

## 2. Core Constraints & Guarantees
- **Server Authority**: The server owns car transforms, ball transforms, collision outcomes, boost inventory, boost pad cooldowns, match timer, goals, scores, and phase transitions.
- **Fixed Physics Rate**: 60 Hz simulation step with accumulator and overrun bounds.
- **Compact Snapshots**: 20–30 Hz sequenced snapshots with client interpolation and local car prediction/reconciliation.
- **Visuals**:
  - 1 original car chassis with distinct Blue/Orange team materials.
  - 3 visual arena themes (Foundry, Neon Grid, Coastal Dome) built from identical physical dimensions, collision boundaries, and boost-pad layouts.
  - Two camera rigs: Ball Cam and Car Cam (toggle 'C').
- **No External Remote Assets**: Zero hotlinked external models, textures, or audio. 100% locally bundled or procedurally synthesized.
