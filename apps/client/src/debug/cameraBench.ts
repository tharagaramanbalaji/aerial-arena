import * as THREE from 'three';
import { BALL_CONFIG, CAR_CONFIG } from '@aerial-arena/shared';

/**
 * Dev-only camera benchmark (window.__cameraBench() in `npm run dev`).
 * Drives scripted Free Play scenarios at a fixed 60 fps through the real game loop and
 * measures what makes a chase camera feel good or bad:
 *  - p95 / max angular speed of the view direction (deg/s): smoothness, whip
 *  - swings: view direction turning > 120 deg within 0.4 s (disorienting flips)
 *  - car in frame / ball in frame (% of frames): framing quality
 *  - max roll (deg): horizon stability; min camera height above the floor (m)
 */
export interface CamMetrics {
  p95: number;
  max: number;
  swings: number;
  carInFrame: number;
  ballInFrame: number;
  maxRoll: number;
  minHeight: number;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type App = any;

const key = (code: string, down: boolean) => window.dispatchEvent(new KeyboardEvent(down ? 'keydown' : 'keyup', { code }));

interface Scenario {
  name: string;
  mode: 'ball_cam' | 'car_cam';
  frames: number;
  setup(app: App): void;
  /** Keys held at frame i (others released); can also poke the sim. */
  keys(i: number, app: App): string[];
}

const SCENARIOS: Scenario[] = [
  { name: 'straight boost', mode: 'ball_cam', frames: 180, setup: (a) => place(a, 8, -40, 0, 0, -10), keys: () => ['KeyW', 'ShiftLeft'] },
  { name: 'hard turn @speed', mode: 'car_cam', frames: 180, setup: (a) => place(a, 0, -30, 0), keys: (i) => (i < 60 ? ['KeyW', 'ShiftLeft'] : ['KeyW', 'KeyD']) },
  { name: 'powerslide 180', mode: 'car_cam', frames: 150, setup: (a) => place(a, 0, -30, 0), keys: (i) => (i < 70 ? ['KeyW'] : ['KeyW', 'KeyD', 'KeyX']) },
  {
    name: 'ball passes overhead', mode: 'ball_cam', frames: 150,
    setup: (a) => { place(a, 0, -20, 0); a.freePlay.sim.ball.setTransform({ x: 0, y: 3, z: -8 }, { x: 0, y: 7, z: -12 }); },
    keys: () => [],
  },
  { name: 'dribble on hood', mode: 'ball_cam', frames: 180, setup: (a) => { place(a, 0, -30, 0); a.freePlay.ballOnHood(); }, keys: () => ['KeyW'] },
  { name: 'jump + front flip', mode: 'car_cam', frames: 150, setup: (a) => place(a, 0, -30, 0), keys: (i) => (i < 40 ? ['KeyW'] : i < 48 ? ['KeyW', 'Space'] : i > 56 && i < 60 ? ['KeyW', 'Space'] : ['KeyW']) },
  { name: 'wall ride (ball cam)', mode: 'ball_cam', frames: 240, setup: (a) => place(a, 22, -5, Math.PI / 2), keys: (i) => (i < 150 ? ['KeyW', 'ShiftLeft'] : ['KeyW', 'KeyA']) },
  {
    name: 'toggle cam while driving', mode: 'ball_cam', frames: 150, setup: (a) => place(a, 10, -30, 0.4, -10, 10),
    keys: (i, a) => { if (i === 40 || i === 100) a.ui.setCameraMode(a.cameraManager.toggleMode()); return ['KeyW']; },
  },
];

function place(app: App, x: number, z: number, yaw: number, bx = 0, bz = 0) {
  const fp = app.freePlay;
  fp.car.reset({ x, y: CAR_CONFIG.restHeight, z }, yaw, 100);
  fp.sim.ball.reset({ x: bx, y: BALL_CONFIG.restHeight, z: bz });
}

export async function runCameraBench(app: App): Promise<Record<string, CamMetrics>> {
  if (app.state !== 'free_play') {
    document.getElementById('btn-free')?.click();
    await new Promise((r) => setTimeout(r, 1500));
  }
  const cm = app.cameraManager;
  const cam: THREE.PerspectiveCamera = cm.camera;
  const results: Record<string, CamMetrics> = {};
  const dt = 1 / 60;
  const held = new Set<string>();
  const setKeys = (keys: string[]) => {
    for (const k of [...held]) if (!keys.includes(k)) { key(k, false); held.delete(k); }
    for (const k of keys) if (!held.has(k)) { key(k, true); held.add(k); }
  };
  for (const sc of SCENARIOS) {
    setKeys([]);
    sc.setup(app);
    cm.setMode(sc.mode);
    cm.snap();
    const dirs: THREE.Vector3[] = [];
    const speeds: number[] = [];
    let carIn = 0, ballIn = 0, maxRoll = 0, minH = Infinity;
    for (let i = 0; i < sc.frames; i++) {
      setKeys(sc.keys(i, app));
      app.lastTime = performance.now() - dt * 1000; // fixed 60 fps step through the real loop
      app.loop();
      const d = cam.getWorldDirection(new THREE.Vector3());
      if (dirs.length) speeds.push(THREE.MathUtils.radToDeg(d.angleTo(dirs[dirs.length - 1])) / dt);
      dirs.push(d);
      const t = app.freePlay.car.getTransform();
      const b = app.freePlay.sim.ball.getTransform();
      const inFrame = (p: THREE.Vector3) => {
        const n = p.clone().project(cam);
        return n.z < 1 && Math.abs(n.x) <= 1 && Math.abs(n.y) <= 1;
      };
      if (inFrame(new THREE.Vector3(t.x, t.y + 0.2, t.z))) carIn++;
      if (inFrame(new THREE.Vector3(b.x, b.y, b.z))) ballIn++;
      const camUp = new THREE.Vector3(0, 1, 0).applyQuaternion(cam.quaternion);
      const camRight = new THREE.Vector3(1, 0, 0).applyQuaternion(cam.quaternion);
      maxRoll = Math.max(maxRoll, Math.abs(THREE.MathUtils.radToDeg(Math.asin(THREE.MathUtils.clamp(camRight.y, -1, 1)))));
      void camUp;
      minH = Math.min(minH, cam.position.y);
    }
    setKeys([]);
    let swings = 0;
    const win = Math.round(0.4 / dt);
    for (let i = win; i < dirs.length; i += 4) if (dirs[i].angleTo(dirs[i - win]) > THREE.MathUtils.degToRad(120)) swings++;
    const sorted = [...speeds].sort((a, b) => a - b);
    results[sc.name] = {
      p95: Math.round(sorted[Math.floor(sorted.length * 0.95)] ?? 0),
      max: Math.round(sorted[sorted.length - 1] ?? 0),
      swings,
      carInFrame: Math.round((carIn / sc.frames) * 100),
      ballInFrame: Math.round((ballIn / sc.frames) * 100),
      maxRoll: Math.round(maxRoll),
      minHeight: Math.round(minH * 100) / 100,
    };
  }
  cm.setMode('ball_cam');
  app.ui.setCameraMode('ball_cam');
  return results;
}
