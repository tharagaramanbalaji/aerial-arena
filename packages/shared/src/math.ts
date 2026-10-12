export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export interface Quat {
  x: number;
  y: number;
  z: number;
  w: number;
}

export function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

export function clamp01(v: number): number {
  return clamp(v, 0, 1);
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export function vec3(x = 0, y = 0, z = 0): Vec3 {
  return { x, y, z };
}

export function vec3Add(a: Vec3, b: Vec3): Vec3 {
  return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z };
}

export function vec3Sub(a: Vec3, b: Vec3): Vec3 {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}

export function vec3Scale(v: Vec3, s: number): Vec3 {
  return { x: v.x * s, y: v.y * s, z: v.z * s };
}

export function vec3Dot(a: Vec3, b: Vec3): number {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

export function vec3Cross(a: Vec3, b: Vec3): Vec3 {
  return {
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x,
  };
}

export function vec3LengthSq(v: Vec3): number {
  return v.x * v.x + v.y * v.y + v.z * v.z;
}

export function vec3Length(v: Vec3): number {
  return Math.sqrt(vec3LengthSq(v));
}

export function vec3Normalize(v: Vec3): Vec3 {
  const len = vec3Length(v);
  if (len < 1e-6) return { x: 0, y: 0, z: 0 };
  return vec3Scale(v, 1 / len);
}

export function vec3Distance(a: Vec3, b: Vec3): number {
  return vec3Length(vec3Sub(a, b));
}

export function vec3Lerp(a: Vec3, b: Vec3, t: number): Vec3 {
  return {
    x: lerp(a.x, b.x, t),
    y: lerp(a.y, b.y, t),
    z: lerp(a.z, b.z, t),
  };
}

export function quatIdentity(): Quat {
  return { x: 0, y: 0, z: 0, w: 1 };
}

export function quatFromAxisAngle(axis: Vec3, rad: number): Quat {
  const norm = vec3Normalize(axis);
  const half = rad * 0.5;
  const s = Math.sin(half);
  return {
    x: norm.x * s,
    y: norm.y * s,
    z: norm.z * s,
    w: Math.cos(half),
  };
}

export function quatFromEuler(pitch: number, yaw: number, roll: number): Quat {
  const c1 = Math.cos(yaw * 0.5);
  const c2 = Math.cos(pitch * 0.5);
  const c3 = Math.cos(roll * 0.5);
  const s1 = Math.sin(yaw * 0.5);
  const s2 = Math.sin(pitch * 0.5);
  const s3 = Math.sin(roll * 0.5);

  return {
    x: s1 * s2 * c3 + c1 * c2 * s3,
    y: s1 * c2 * c3 + c1 * s2 * s3,
    z: c1 * s2 * c3 - s1 * c2 * s3,
    w: c1 * c2 * c3 - s1 * s2 * s3,
  };
}

export function quatMultiply(a: Quat, b: Quat): Quat {
  return {
    w: a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z,
    x: a.w * b.x + a.x * b.w + a.y * b.z - a.z * b.y,
    y: a.w * b.y - a.x * b.z + a.y * b.w + a.z * b.x,
    z: a.w * b.z + a.x * b.y - a.y * b.x + a.z * b.w,
  };
}

export function quatRotateVector(q: Quat, v: Vec3): Vec3 {
  const u = { x: q.x, y: q.y, z: q.z };
  const s = q.w;
  const dotUV = vec3Dot(u, v);
  const crossUV = vec3Cross(u, v);
  const crossU_crossUV = vec3Cross(u, crossUV);

  return {
    x: 2 * dotUV * u.x + (s * s - vec3Dot(u, u)) * v.x + 2 * s * crossUV.x,
    y: 2 * dotUV * u.y + (s * s - vec3Dot(u, u)) * v.y + 2 * s * crossUV.y,
    z: 2 * dotUV * u.z + (s * s - vec3Dot(u, u)) * v.z + 2 * s * crossUV.z,
  };
}

export function quatSlerp(a: Quat, b: Quat, t: number): Quat {
  let cosHalfTheta = a.w * b.w + a.x * b.x + a.y * b.y + a.z * b.z;

  let bx = b.x;
  let by = b.y;
  let bz = b.z;
  let bw = b.w;

  if (cosHalfTheta < 0) {
    bw = -bw;
    bx = -bx;
    by = -by;
    bz = -bz;
    cosHalfTheta = -cosHalfTheta;
  }

  if (Math.abs(cosHalfTheta) >= 1.0) {
    return { x: a.x, y: a.y, z: a.z, w: a.w };
  }

  const halfTheta = Math.acos(cosHalfTheta);
  const sinHalfTheta = Math.sqrt(1.0 - cosHalfTheta * cosHalfTheta);

  if (Math.abs(sinHalfTheta) < 0.001) {
    return {
      x: a.x * 0.5 + bx * 0.5,
      y: a.y * 0.5 + by * 0.5,
      z: a.z * 0.5 + bz * 0.5,
      w: a.w * 0.5 + bw * 0.5,
    };
  }

  const ratioA = Math.sin((1 - t) * halfTheta) / sinHalfTheta;
  const ratioB = Math.sin(t * halfTheta) / sinHalfTheta;

  return {
    x: a.x * ratioA + bx * ratioB,
    y: a.y * ratioA + by * ratioB,
    z: a.z * ratioA + bz * ratioB,
    w: a.w * ratioA + bw * ratioB,
  };
}
