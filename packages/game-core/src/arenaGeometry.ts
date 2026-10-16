/**
 * Procedural arena geometry shared by physics (Rapier trimesh) and rendering (Three.js).
 *
 * The playable volume is an octagonal footprint (rectangle with 45-degree corner
 * chamfers, every vertex rounded). A vertical profile is swept around it:
 *
 *   floor fillet (quarter circle, radius r(s)) -> vertical wall -> ceiling fillet (radius Rc)
 *
 * Next to each goal the floor fillet radius r(s) smoothly tapers to zero so the
 * goal mouth is a clean rectangular opening in a vertical wall. Quads inside the
 * goal mouth are omitted and a goal box is attached behind each opening.
 *
 * The flat floor and ceiling are NOT part of the shell: physics uses cuboids for
 * them (perfectly flat, no internal edges) and rendering uses the outline polygons.
 *
 * Pure math only: no Rapier or Three.js imports, so both the server and client use it.
 */
import { ARENA_CONFIG, ArenaConfig } from '@aerial-arena/shared';

export interface FootprintSample {
  x: number;
  z: number;
  nx: number; // outward horizontal normal
  nz: number;
  s: number; // arc length along the perimeter (m)
  goalSide: 0 | -1 | 1; // -1 / +1 if on the back wall containing the blue (-Z) / orange (+Z) goal
}

export const SurfaceZone = {
  FloorFillet: 0,
  Wall: 1,
  CeilingFillet: 2,
  GoalInterior: 3,
} as const;
export type SurfaceZone = (typeof SurfaceZone)[keyof typeof SurfaceZone];

export interface ArenaMeshData {
  positions: Float32Array; // xyz
  indices: Uint32Array; // triangles, wound so normals face into the playable volume
  perimeterU: Float32Array; // per-vertex arc length along the footprint (m)
  zone: Float32Array; // per-vertex SurfaceZone
  profileRow: Float32Array; // per-vertex row index along the swept profile (-1 for goal boxes)
}

export interface ArenaGeometry {
  config: ArenaConfig;
  footprint: FootprintSample[];
  shell: ArenaMeshData; // fillets + walls + goal boxes (no flat floor/ceiling)
  floorOutline: { x: number; z: number }[]; // where the floor fillet starts (y = 0)
  ceilingOutline: { x: number; z: number }[]; // where the ceiling fillet ends (y = height)
  goalHeightRow: number;
  /** Row where the floor fillet meets the vertical wall. */
  wallStartRow: number;
  rowsPerColumn: number;
  /** Shell vertices [0, ringVertexCount) are the swept ring; the rest are goal boxes. */
  ringVertexCount: number;
}

// Profile resolution (segments)
const FLOOR_FILLET_SEGS = 10;
const LOWER_WALL_SEGS = 5;
const UPPER_WALL_SEGS = 8;
const CEILING_FILLET_SEGS = 10;
const ARC_SEGS_PER_CORNER = 10;
const MAX_STRAIGHT_SPACING = 1.5; // m

function smoothstep(e0: number, e1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
}

/** Perimeter samples of the rounded octagon, in loop order. */
export function buildFootprint(config: ArenaConfig = ARENA_CONFIG): FootprintSample[] {
  const W = config.halfWidth;
  const L = config.halfLength;
  const c = config.cornerCut;
  const rc = config.cornerRoundRadius;
  const gw = config.goalHalfWidth;
  const taper = config.goalFilletTaper;

  const verts: [number, number][] = [
    [W, -(L - c)],
    [W, L - c],
    [W - c, L],
    [-(W - c), L],
    [-W, L - c],
    [-W, -(L - c)],
    [-(W - c), -L],
    [W - c, -L],
  ];
  const n = verts.length;

  const norm = (x: number, z: number): [number, number] => {
    const len = Math.hypot(x, z);
    return [x / len, z / len];
  };

  // Precompute the arc for each rounded vertex.
  interface Corner {
    a: [number, number]; // arc start (on incoming edge)
    b: [number, number]; // arc end (on outgoing edge)
    center: [number, number];
    startAngle: number;
    sweep: number;
  }
  const corners: Corner[] = [];
  for (let i = 0; i < n; i++) {
    const prev = verts[(i - 1 + n) % n];
    const cur = verts[i];
    const next = verts[(i + 1) % n];
    const dIn = norm(cur[0] - prev[0], cur[1] - prev[1]);
    const dOut = norm(next[0] - cur[0], next[1] - cur[1]);
    const turn = Math.acos(Math.min(1, Math.max(-1, dIn[0] * dOut[0] + dIn[1] * dOut[1])));
    const t = rc * Math.tan(turn / 2);
    const a: [number, number] = [cur[0] - dIn[0] * t, cur[1] - dIn[1] * t];
    const b: [number, number] = [cur[0] + dOut[0] * t, cur[1] + dOut[1] * t];
    // Inward normal of the incoming edge: pick the perpendicular that points toward the origin.
    let inN: [number, number] = [-dIn[1], dIn[0]];
    if (inN[0] * -a[0] + inN[1] * -a[1] < 0) inN = [-inN[0], -inN[1]];
    const center: [number, number] = [a[0] + inN[0] * rc, a[1] + inN[1] * rc];
    const startAngle = Math.atan2(a[1] - center[1], a[0] - center[0]);
    let endAngle = Math.atan2(b[1] - center[1], b[0] - center[0]);
    let sweep = endAngle - startAngle;
    while (sweep > Math.PI) sweep -= 2 * Math.PI;
    while (sweep < -Math.PI) sweep += 2 * Math.PI;
    corners.push({ a, b, center, startAngle, sweep });
  }

  const samples: FootprintSample[] = [];
  let s = 0;
  let last: [number, number] | null = null;
  const push = (x: number, z: number, nx: number, nz: number, goalSide: 0 | -1 | 1) => {
    if (last) s += Math.hypot(x - last[0], z - last[1]);
    last = [x, z];
    samples.push({ x, z, nx, nz, s, goalSide });
  };

  for (let i = 0; i < n; i++) {
    const from = corners[(i - 1 + n) % n].b;
    const to = corners[i].a;
    const dir = norm(to[0] - from[0], to[1] - from[1]);
    let outN: [number, number] = [dir[1], -dir[0]];
    if (outN[0] * from[0] + outN[1] * from[1] < 0) outN = [-outN[0], -outN[1]];
    const segLen = Math.hypot(to[0] - from[0], to[1] - from[1]);

    // Parameter positions along this straight segment (excluding the end, which the arc emits).
    const isBackWall = Math.abs(dir[1]) < 1e-6 && Math.abs(from[1]) > L - 1e-3;
    const goalSide: 0 | -1 | 1 = isBackWall ? (from[1] > 0 ? 1 : -1) : 0;
    const ts: number[] = [];
    const uniformCount = Math.max(1, Math.ceil(segLen / MAX_STRAIGHT_SPACING));
    for (let k = 0; k < uniformCount; k++) ts.push((k / uniformCount) * segLen);
    if (isBackWall) {
      // Mandatory breakpoints at the posts plus dense sampling through the taper zone.
      const xs: number[] = [];
      for (const sign of [-1, 1]) {
        xs.push(sign * gw);
        for (let k = 1; k <= 8; k++) xs.push(sign * (gw + (taper * k) / 8));
      }
      for (let k = -4; k <= 4; k++) xs.push((gw * k) / 4.5);
      for (const x of xs) {
        const t = (x - from[0]) / dir[0];
        if (t > 0 && t < segLen) ts.push(t);
      }
    }
    ts.sort((p, q) => p - q);
    const filtered: number[] = [];
    for (const t of ts) {
      if (filtered.length === 0 || t - filtered[filtered.length - 1] > 0.05) filtered.push(t);
    }
    for (const t of filtered) {
      const x = from[0] + dir[0] * t;
      const z = from[1] + dir[1] * t;
      push(isBackWall && Math.abs(Math.abs(x) - gw) < 1e-4 ? Math.sign(x) * gw : x, z, outN[0], outN[1], goalSide);
    }

    // Rounded corner arc (emit start, interior points; the end is the next segment's start).
    const cr = corners[i];
    for (let k = 0; k < ARC_SEGS_PER_CORNER; k++) {
      const ang = cr.startAngle + (cr.sweep * k) / ARC_SEGS_PER_CORNER;
      const x = cr.center[0] + Math.cos(ang) * rc;
      const z = cr.center[1] + Math.sin(ang) * rc;
      push(x, z, Math.cos(ang), Math.sin(ang), 0);
    }
  }
  return samples;
}

/** Floor fillet radius at a footprint sample (tapers to 0 beside the goal posts). */
export function floorFilletRadiusAt(sample: FootprintSample, config: ArenaConfig = ARENA_CONFIG): number {
  if (sample.goalSide === 0) return config.floorFilletRadius;
  const ax = Math.abs(sample.x);
  return config.floorFilletRadius * smoothstep(config.goalHalfWidth, config.goalHalfWidth + config.goalFilletTaper, ax);
}

export function buildArenaGeometry(config: ArenaConfig = ARENA_CONFIG): ArenaGeometry {
  const footprint = buildFootprint(config);
  const H = config.height;
  const Rc = config.ceilingFilletRadius;
  const gh = config.goalHeight;
  const gw = config.goalHalfWidth;

  const positions: number[] = [];
  const perimeterU: number[] = [];
  const zone: number[] = [];
  const profileRow: number[] = [];
  const indices: number[] = [];

  const rowsPerColumn = FLOOR_FILLET_SEGS + 1 + LOWER_WALL_SEGS + UPPER_WALL_SEGS + CEILING_FILLET_SEGS;
  const goalHeightRow = FLOOR_FILLET_SEGS + LOWER_WALL_SEGS;
  const floorOutline: { x: number; z: number }[] = [];
  const ceilingOutline: { x: number; z: number }[] = [];

  for (let col = 0; col < footprint.length; col++) {
    const smp = footprint[col];
    const r = floorFilletRadiusAt(smp, config);
    const { x: px, z: pz, nx, nz } = smp;
    const pushV = (hx: number, y: number, zn: SurfaceZone) => {
      // hx = horizontal inset from the wall line (positive = toward the field)
      profileRow.push(positions.length / 3 - col * rowsPerColumn);
      positions.push(px - nx * hx, y, pz - nz * hx);
      perimeterU.push(smp.s);
      zone.push(zn);
    };
    // Floor fillet: phi 0 (floor tangent) -> 90 deg (wall tangent)
    for (let k = 0; k <= FLOOR_FILLET_SEGS; k++) {
      const phi = (k / FLOOR_FILLET_SEGS) * (Math.PI / 2);
      pushV(r - r * Math.sin(phi), r - r * Math.cos(phi), k === FLOOR_FILLET_SEGS ? SurfaceZone.Wall : SurfaceZone.FloorFillet);
    }
    for (let k = 1; k <= LOWER_WALL_SEGS; k++) {
      pushV(0, r + ((gh - r) * k) / LOWER_WALL_SEGS, SurfaceZone.Wall);
    }
    for (let k = 1; k <= UPPER_WALL_SEGS; k++) {
      pushV(0, gh + ((H - Rc - gh) * k) / UPPER_WALL_SEGS, SurfaceZone.Wall);
    }
    for (let k = 1; k <= CEILING_FILLET_SEGS; k++) {
      const psi = (k / CEILING_FILLET_SEGS) * (Math.PI / 2);
      pushV(Rc - Rc * Math.cos(psi), H - Rc + Rc * Math.sin(psi), SurfaceZone.CeilingFillet);
    }
    floorOutline.push({ x: px - nx * r, z: pz - nz * r });
    ceilingOutline.push({ x: px - nx * Rc, z: pz - nz * Rc });
  }

  const ringVertexCount = positions.length / 3;
  const cols = footprint.length;
  const vid = (col: number, row: number) => col * rowsPerColumn + row;
  const inGoalMouth = (col: number) => {
    const smp = footprint[col];
    return smp.goalSide !== 0 && Math.abs(smp.x) <= gw + 1e-4;
  };

  // Determine winding once: the first quad's normal must point into the field.
  let flip = false;
  {
    const a = vid(0, goalHeightRow + 1);
    const b = vid(1, goalHeightRow + 1);
    const c = vid(1, goalHeightRow + 2);
    const n = triNormal(positions, a, b, c);
    const inward = { x: -footprint[0].nx, z: -footprint[0].nz };
    flip = n.x * inward.x + n.z * inward.z < 0;
  }

  const pushTri = (a: number, b: number, c: number) => {
    if (triArea(positions, a, b, c) < 1e-8) return; // drop degenerate fillet triangles at the goal
    if (flip) indices.push(a, c, b);
    else indices.push(a, b, c);
  };

  for (let col = 0; col < cols; col++) {
    const next = (col + 1) % cols;
    const holeColumnPair = inGoalMouth(col) && inGoalMouth(next);
    for (let row = 0; row < rowsPerColumn - 1; row++) {
      if (holeColumnPair && row < goalHeightRow) continue;
      const a = vid(col, row);
      const b = vid(next, row);
      const c = vid(next, row + 1);
      const d = vid(col, row + 1);
      pushTri(a, b, c);
      pushTri(a, c, d);
    }
  }

  // Goal boxes behind each opening (walls + roof + back). Normals face into the goal.
  const L = config.halfLength;
  const D = config.goalDepth;
  const addQuad = (p0: number[], p1: number[], p2: number[], p3: number[], inward: [number, number, number], u: number) => {
    const base = positions.length / 3;
    for (const p of [p0, p1, p2, p3]) {
      positions.push(p[0], p[1], p[2]);
      perimeterU.push(u);
      zone.push(SurfaceZone.GoalInterior);
      profileRow.push(-1);
    }
    const n = triNormal(positions, base, base + 1, base + 2);
    const ok = n.x * inward[0] + n.y * inward[1] + n.z * inward[2] >= 0;
    if (ok) indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
    else indices.push(base, base + 2, base + 1, base, base + 3, base + 2);
  };
  for (const sign of [-1, 1]) {
    const z0 = sign * L;
    const z1 = sign * (L + D);
    const SUB = 4;
    for (let i = 0; i < SUB; i++) {
      const za = z0 + ((z1 - z0) * i) / SUB;
      const zb = z0 + ((z1 - z0) * (i + 1)) / SUB;
      // side walls
      addQuad([-gw, 0, za], [-gw, 0, zb], [-gw, gh, zb], [-gw, gh, za], [1, 0, 0], 0);
      addQuad([gw, 0, za], [gw, 0, zb], [gw, gh, zb], [gw, gh, za], [-1, 0, 0], 0);
      // roof
      addQuad([-gw, gh, za], [gw, gh, za], [gw, gh, zb], [-gw, gh, zb], [0, -1, 0], 0);
    }
    for (let i = 0; i < SUB; i++) {
      const xa = -gw + (2 * gw * i) / SUB;
      const xb = -gw + (2 * gw * (i + 1)) / SUB;
      addQuad([xa, 0, z1], [xb, 0, z1], [xb, gh, z1], [xa, gh, z1], [0, 0, -sign], 0);
    }
  }

  return {
    config,
    footprint,
    shell: {
      positions: new Float32Array(positions),
      indices: new Uint32Array(indices),
      perimeterU: new Float32Array(perimeterU),
      zone: new Float32Array(zone),
      profileRow: new Float32Array(profileRow),
    },
    floorOutline,
    ceilingOutline,
    goalHeightRow,
    wallStartRow: FLOOR_FILLET_SEGS,
    rowsPerColumn,
    ringVertexCount,
  };
}

function triNormal(p: number[], a: number, b: number, c: number) {
  const ax = p[a * 3], ay = p[a * 3 + 1], az = p[a * 3 + 2];
  const e1x = p[b * 3] - ax, e1y = p[b * 3 + 1] - ay, e1z = p[b * 3 + 2] - az;
  const e2x = p[c * 3] - ax, e2y = p[c * 3 + 1] - ay, e2z = p[c * 3 + 2] - az;
  return { x: e1y * e2z - e1z * e2y, y: e1z * e2x - e1x * e2z, z: e1x * e2y - e1y * e2x };
}

function triArea(p: number[], a: number, b: number, c: number): number {
  const n = triNormal(p, a, b, c);
  return 0.5 * Math.hypot(n.x, n.y, n.z);
}

/**
 * Clamp a point into the playable volume shrunk by `margin`, including the curved floor and
 * ceiling ramps (near a wall, the allowed space shrinks by the ramp's inset at that height).
 * Used by the camera so it never shows the outside of the arena.
 */
export function clampInsideArena(
  p: { x: number; y: number; z: number },
  margin: number,
  config: ArenaConfig = ARENA_CONFIG
): { x: number; y: number; z: number } {
  const y = Math.max(margin, Math.min(config.height - margin, p.y));
  // Horizontal inset of a quarter-circle ramp of radius r at height h above its tangent plane.
  const rampInset = (r: number, h: number) => (h >= r ? 0 : r * (1 - Math.sqrt(Math.max(0, 1 - (1 - h / r) ** 2))));
  const inset = Math.max(rampInset(config.floorFilletRadius, y), rampInset(config.ceilingFilletRadius, config.height - y)) + margin;
  const insideGoal =
    Math.abs(p.x) < config.goalHalfWidth - margin && y < config.goalHeight - margin && Math.abs(p.z) > config.halfLength - inset;
  const W = config.halfWidth - inset;
  const L = insideGoal ? config.halfLength + config.goalDepth - margin : config.halfLength - inset;
  let x = Math.max(-W, Math.min(W, p.x));
  let z = Math.max(-L, Math.min(L, p.z));
  if (!insideGoal) {
    // Corner chamfer: |x| + |z| <= halfWidth + halfLength - cornerCut (shrunk by the inset)
    const limit = config.halfWidth + config.halfLength - config.cornerCut - inset * Math.SQRT2;
    const over = Math.abs(x) + Math.abs(z) - limit;
    if (over > 0) {
      x -= Math.sign(x) * over * 0.5;
      z -= Math.sign(z) * over * 0.5;
    }
  } else {
    x = Math.max(-(config.goalHalfWidth - margin), Math.min(config.goalHalfWidth - margin, x));
  }
  return { x, y, z };
}
