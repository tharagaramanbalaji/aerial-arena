/**
 * Physics probe: replays scripted inputs through the real simulation and prints
 * measurements to compare against community-measured Rocket League behaviour.
 *
 *   npm run probe:physics
 */
import { PlayerInput, UU } from '@aerial-arena/shared';
import { createGameSimulation, GameSimulation } from '../src/physicsWorld.js';

const input = (o: Partial<PlayerInput> = {}): PlayerInput => ({
  seq: 1, timestamp: 0, throttle: 0, steer: 0, pitch: 0, yaw: 0, roll: 0,
  jump: false, jumpHeld: false, boost: false, powerslide: false, ...o,
});

let seq = 1;
function run(sim: GameSimulation, id: string, ticks: number, inp: Partial<PlayerInput>, each?: (t: number) => void) {
  for (let t = 0; t < ticks; t++) {
    sim.tick(new Map([[id, input({ seq: seq++, ...inp })]]));
    each?.(t);
  }
}

const fmt = (n: number, d = 2) => n.toFixed(d).padStart(8);
const uu = (m: number) => (m / UU).toFixed(0);

async function main() {
  // 1. Rest height
  {
    const sim = await createGameSimulation();
    const car = sim.addCar('c', 'blue', { x: 0, y: 0.4, z: -20 }, 0);
    run(sim, 'c', 240, {});
    const t = car.getTransform();
    console.log(`rest height        y=${fmt(t.y, 3)} m (RL 0.17)  grounded=${car.isGrounded()} |v|=${fmt(Math.hypot(t.vx, t.vy, t.vz), 3)}`);
    sim.destroy();
  }
  // 2. Throttle from rest: time to 1400 uu/s, speed after 3s
  {
    const sim = await createGameSimulation();
    const car = sim.addCar('c', 'blue', { x: 0, y: 0.17, z: -40 }, 0);
    run(sim, 'c', 60, {});
    let tTo14: number | null = null;
    run(sim, 'c', 360, { throttle: 1 }, (t) => {
      if (tTo14 === null && car.getTransform().vz >= 13.9) tTo14 = (t + 1) / 120;
    });
    console.log(`throttle           t(->13.9 m/s)=${tTo14?.toFixed(2)}s (analytic from RL throttle curve: 2.18s)  v(3s)=${fmt(car.getTransform().vz)} m/s = ${uu(car.getTransform().vz)} uu/s (RL 1410)`);
    sim.destroy();
  }
  // 3. Boost from rest: time to supersonic and max
  {
    const sim = await createGameSimulation();
    const car = sim.addCar('c', 'blue', { x: 0, y: 0.17, z: -45 }, 0);
    car.unlimitedBoost = true;
    run(sim, 'c', 60, {});
    let tSS: number | null = null;
    run(sim, 'c', 480, { throttle: 1, boost: true }, (t) => {
      if (tSS === null && car.isSupersonic()) tSS = (t + 1) / 120;
    });
    const v = car.getTransform();
    console.log(`boost              t(supersonic)=${tSS ?? 'never'}s (no reference; hypothesis check only)  vmax=${fmt(Math.hypot(v.vx, v.vz))} m/s (RL 23.0)`);
    sim.destroy();
  }
  // 4. Turning circle at ~10 m/s and full throttle
  {
    const sim = await createGameSimulation();
    const car = sim.addCar('c', 'blue', { x: 0, y: 0.17, z: -10 }, 0);
    run(sim, 'c', 60, {});
    run(sim, 'c', 90, { throttle: 1 });
    const v0 = car.getTransform().vz;
    let minX = 1e9, maxX = -1e9;
    run(sim, 'c', 600, { throttle: 1, steer: 1 }, () => {
      const t = car.getTransform();
      minX = Math.min(minX, t.x); maxX = Math.max(maxX, t.x);
    });
    const t = car.getTransform();
    console.log(`turning            entry v=${fmt(v0)}  steady v=${fmt(Math.hypot(t.vx, t.vz))}  circle diameter~${fmt(maxX - minX)} m  (right turn => x decreasing: ${minX < -1})`);
    sim.destroy();
  }
  // 5. Jump heights
  for (const [label, holdTicks, second] of [
    ['tap jump', 1, false],
    ['full jump', 30, false],
    ['double jump', 30, true],
  ] as const) {
    const sim = await createGameSimulation();
    const car = sim.addCar('c', 'blue', { x: 0, y: 0.17, z: -20 }, 0);
    run(sim, 'c', 60, {});
    let maxY = 0;
    const track = () => { maxY = Math.max(maxY, car.getTransform().y); };
    run(sim, 'c', 1, { jump: true, jumpHeld: true }, track);
    run(sim, 'c', holdTicks - 1, { jumpHeld: true }, track);
    if (second) {
      run(sim, 'c', 10, {}, track);
      run(sim, 'c', 1, { jump: true, jumpHeld: true }, track);
    }
    run(sim, 'c', 300, {}, track);
    console.log(`${label.padEnd(18)} apex=${fmt(maxY - 0.17)} m above rest (approx. community refs: full ~2.2-2.3, double ~4.6)`);
    sim.destroy();
  }
  // 6. Front flip: horizontal speed gain from rest
  {
    const sim = await createGameSimulation();
    const car = sim.addCar('c', 'blue', { x: 0, y: 0.17, z: -30 }, 0);
    run(sim, 'c', 60, {});
    run(sim, 'c', 1, { jump: true, jumpHeld: true });
    run(sim, 'c', 12, {});
    run(sim, 'c', 1, { jump: true, jumpHeld: true, pitch: -1 });
    let maxPitchRate = 0;
    run(sim, 'c', 80, { pitch: -1 }, () => {
      const t = car.getTransform();
      maxPitchRate = Math.max(maxPitchRate, Math.hypot(t.wx, t.wy, t.wz));
    });
    const t = car.getTransform();
    console.log(`front flip         vz after=${fmt(t.vz)} m/s (model: +5.0 initial impulse, then ground friction)  max spin=${fmt(maxPitchRate)} rad/s (cap 5.5) dodging=${car.isDodging()}`);
    sim.destroy();
  }
  // 7. Ball: drop bounce and a full-speed hit
  {
    const sim = await createGameSimulation();
    sim.ball.setTransform({ x: 0, y: 6, z: 0 });
    let apexAfter = 0, bounced = false, prevVy = 0;
    for (let t = 0; t < 600; t++) {
      sim.tick(new Map());
      const b = sim.ball.getTransform();
      if (prevVy < 0 && b.vy > 0) bounced = true;
      if (bounced) apexAfter = Math.max(apexAfter, b.y);
      prevVy = b.vy;
    }
    console.log(`ball drop 6m       first bounce apex=${fmt(apexAfter)} m (restitution 0.6 => ~${fmt(0.91 + 0.36 * (6 - 0.91))})`);
    sim.destroy();
  }
  {
    const sim = await createGameSimulation();
    const car = sim.addCar('c', 'blue', { x: 0, y: 0.17, z: -30 }, 0);
    car.unlimitedBoost = true;
    run(sim, 'c', 60, {});
    let hitSpeed = 0, carSpeed = 0;
    run(sim, 'c', 300, { throttle: 1, boost: true }, () => {
      const b = sim.ball.getTransform();
      const s = Math.hypot(b.vx, b.vy, b.vz);
      if (s > hitSpeed) { hitSpeed = s; carSpeed = car.getTransform().vz; }
    });
    console.log(`boosted hit        ball speed=${fmt(hitSpeed)} m/s from car ~${fmt(carSpeed)} m/s (model: rigid contact + extra impulse 0.55*relSpeed)`);
    sim.destroy();
  }
  // 8. Wall ride: drive into the side wall at speed, see if the car climbs and stays attached
  {
    const sim = await createGameSimulation();
    const car = sim.addCar('c', 'blue', { x: 20, y: 0.17, z: 0 }, Math.PI / 2); // facing +X
    car.unlimitedBoost = true;
    run(sim, 'c', 60, {});
    let maxY = 0, attachedTicks = 0;
    run(sim, 'c', 360, { throttle: 1 }, () => {
      const t = car.getTransform();
      maxY = Math.max(maxY, t.y);
      if (car.isGrounded() && t.y > 3) attachedTicks++;
    });
    console.log(`wall drive         max height=${fmt(maxY)} m, ticks grounded on wall above 3m=${attachedTicks}`);
    sim.destroy();
  }
}

main();
