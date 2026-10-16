import { GameSnapshot, PlayerStateSnapshot, TransformSnapshot } from '@aerial-arena/shared';

export interface InterpolatedState {
  /** The newer of the two bracketing snapshots (discrete fields come from it). */
  base: GameSnapshot;
  players: Record<string, PlayerStateSnapshot>;
  ball: TransformSnapshot;
}

/**
 * Buffers authoritative snapshots and renders slightly in the past (interpolation delay)
 * so remote motion is smooth despite 30 Hz updates and network jitter.
 *
 * Server clock offset is estimated from the fastest-arriving packets (max of
 * serverTime - localReceiveTime), decaying slowly so it can adapt to drift.
 */
export class SnapshotBuffer {
  private buffer: { serverTime: number; snap: GameSnapshot }[] = [];
  private offset: number | null = null;
  public delayMs = 100;

  push(snap: GameSnapshot): void {
    const est = snap.serverTime - performance.now();
    if (this.offset === null || est > this.offset) this.offset = est;
    else this.offset += (est - this.offset) * 0.002;
    // Keep sorted and bounded
    if (this.buffer.length > 0 && snap.serverTime <= this.buffer[this.buffer.length - 1].serverTime) return;
    this.buffer.push({ serverTime: snap.serverTime, snap });
    if (this.buffer.length > 60) this.buffer.shift();
  }

  clear(): void {
    this.buffer = [];
    this.offset = null;
  }

  get latest(): GameSnapshot | null {
    return this.buffer.length ? this.buffer[this.buffer.length - 1].snap : null;
  }

  sample(): InterpolatedState | null {
    if (this.buffer.length === 0 || this.offset === null) return null;
    const renderTime = performance.now() + this.offset - this.delayMs;
    let i = this.buffer.length - 1;
    while (i > 0 && this.buffer[i - 1].serverTime > renderTime) i--;
    const newer = this.buffer[i];
    const older = i > 0 ? this.buffer[i - 1] : newer;
    if (newer === older || renderTime >= newer.serverTime) {
      // No bracketing pair: extrapolate briefly from the newest snapshot.
      const dt = Math.min(0.1, Math.max(0, (renderTime - newer.serverTime) / 1000));
      return this.build(newer.snap, newer.snap, 1, dt);
    }
    const span = newer.serverTime - older.serverTime;
    const alpha = span > 0 ? (renderTime - older.serverTime) / span : 1;
    return this.build(older.snap, newer.snap, Math.min(1, Math.max(0, alpha)), 0);
  }

  private build(a: GameSnapshot, b: GameSnapshot, t: number, extrapolate: number): InterpolatedState {
    const players: Record<string, PlayerStateSnapshot> = {};
    for (const [id, pb] of Object.entries(b.players)) {
      const pa = a.players[id] ?? pb;
      const teleported = pa.isDemoed !== pb.isDemoed || dist(pa.transform, pb.transform) > 6;
      players[id] = { ...pb, transform: lerpTransform(teleported ? pb.transform : pa.transform, pb.transform, t, extrapolate) };
    }
    const ballJump = dist(a.ball.transform, b.ball.transform) > 8;
    return {
      base: b,
      players,
      ball: lerpTransform(ballJump ? b.ball.transform : a.ball.transform, b.ball.transform, t, extrapolate),
    };
  }
}

function dist(a: TransformSnapshot, b: TransformSnapshot) {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}

export function lerpTransform(a: TransformSnapshot, b: TransformSnapshot, t: number, extrapolate = 0): TransformSnapshot {
  const l = (x: number, y: number) => x + (y - x) * t;
  // quaternion slerp (shortest path)
  let bx = b.qx, by = b.qy, bz = b.qz, bw = b.qw;
  let cos = a.qx * bx + a.qy * by + a.qz * bz + a.qw * bw;
  if (cos < 0) {
    bx = -bx; by = -by; bz = -bz; bw = -bw; cos = -cos;
  }
  let ka = 1 - t, kb = t;
  if (cos < 0.9995) {
    const th = Math.acos(cos);
    const s = Math.sin(th);
    ka = Math.sin((1 - t) * th) / s;
    kb = Math.sin(t * th) / s;
  }
  let qx = a.qx * ka + bx * kb, qy = a.qy * ka + by * kb, qz = a.qz * ka + bz * kb, qw = a.qw * ka + bw * kb;
  const n = Math.hypot(qx, qy, qz, qw) || 1;
  qx /= n; qy /= n; qz /= n; qw /= n;
  const vx = l(a.vx, b.vx), vy = l(a.vy, b.vy), vz = l(a.vz, b.vz);
  return {
    x: l(a.x, b.x) + vx * extrapolate,
    y: l(a.y, b.y) + vy * extrapolate,
    z: l(a.z, b.z) + vz * extrapolate,
    qx, qy, qz, qw,
    vx, vy, vz,
    wx: l(a.wx, b.wx), wy: l(a.wy, b.wy), wz: l(a.wz, b.wz),
  };
}
