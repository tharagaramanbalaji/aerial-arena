import * as THREE from 'three';
import { ARENA_CONFIG, BALL_CONFIG, TransformSnapshot } from '@aerial-arena/shared';

export interface BallVisual {
  root: THREE.Group;
  update(t: TransformSnapshot): void;
  destroy(): void;
}

/**
 * Clean procedural ball (silver shell, dark seam bands, glowing blue nodes) plus a soft
 * ground marker so its height is easy to read.
 */
export function createBallMesh(): BallVisual {
  const root = new THREE.Group();
  const { map, emissive } = createPanelTextures(1024, 512);
  const geom = new THREE.SphereGeometry(BALL_CONFIG.radius, 64, 32);
  const mat = new THREE.MeshStandardMaterial({
    map,
    bumpMap: map,
    bumpScale: 3,
    emissiveMap: emissive,
    emissive: 0xffffff,
    emissiveIntensity: 1.6,
    metalness: 0.35,
    roughness: 0.32,
  });
  const ball = new THREE.Mesh(geom, mat);
  ball.castShadow = true;
  root.add(ball);

  // Ground marker: soft dark disc directly below the ball, fading with height.
  const markerTex = createDiscTexture();
  const markerGeom = new THREE.PlaneGeometry(1, 1);
  markerGeom.rotateX(-Math.PI / 2);
  const markerMat = new THREE.MeshBasicMaterial({ map: markerTex, transparent: true, depthWrite: false, opacity: 0.5 });
  const marker = new THREE.Mesh(markerGeom, markerMat);
  marker.position.y = 0.012;
  marker.renderOrder = 1;
  root.add(marker);

  const update = (t: TransformSnapshot) => {
    ball.position.set(t.x, t.y, t.z);
    ball.quaternion.set(t.qx, t.qy, t.qz, t.qw);
    const h = Math.max(0, t.y - BALL_CONFIG.radius);
    marker.position.x = t.x;
    marker.position.z = t.z;
    const size = BALL_CONFIG.radius * 2.2 * (1 + h * 0.04);
    marker.scale.set(size, 1, size);
    // Only draw on the flat floor; near the curved ramps it would clip into the geometry.
    const edge = Math.min(ARENA_CONFIG.halfWidth - 2.6 - Math.abs(t.x), ARENA_CONFIG.halfLength - 2.6 - Math.abs(t.z),
      (ARENA_CONFIG.halfWidth + ARENA_CONFIG.halfLength - ARENA_CONFIG.cornerCut - 3.7 - Math.abs(t.x) - Math.abs(t.z)) / Math.SQRT2);
    const inGoal = Math.abs(t.z) > ARENA_CONFIG.halfLength && Math.abs(t.x) < ARENA_CONFIG.goalHalfWidth;
    const fade = inGoal ? 1 : Math.min(1, Math.max(0, edge / 1.5));
    markerMat.opacity = Math.max(0.12, 0.55 - h * 0.025) * fade;
  };

  return {
    root,
    update,
    destroy: () => {
      geom.dispose();
      mat.dispose();
      map.dispose();
      emissive.dispose();
      markerGeom.dispose();
      markerMat.dispose();
      markerTex.dispose();
    },
  };
}

function createPanelTextures(w: number, h: number) {
  const base = document.createElement('canvas');
  const glow = document.createElement('canvas');
  base.width = glow.width = w;
  base.height = glow.height = h;
  const bctx = base.getContext('2d')!;
  const gctx = glow.getContext('2d')!;
  const bimg = bctx.createImageData(w, h);
  const gimg = gctx.createImageData(w, h);
  for (let j = 0; j < h; j++) {
    const theta = (Math.PI * (j + 0.5)) / h;
    const st = Math.sin(theta);
    const y = Math.cos(theta);
    for (let i = 0; i < w; i++) {
      const ph = (2 * Math.PI * (i + 0.5)) / w;
      const x = -Math.cos(ph) * st;
      const z = Math.sin(ph) * st;
      // Two-tone armored ball: alternating silver / gunmetal panels (by octant), honeycomb mesh
      // on the dark panels, fine grooves on the light ones, dark seams with blue light lines and
      // glowing blue nodes where the seams meet.
      const ax = Math.abs(x), ay = Math.abs(y), az = Math.abs(z);
      const band = Math.min(ax, ay, az);
      const node = Math.max(ax, ay, az);
      const dark = (x > 0 ? 1 : 0) ^ (y > 0 ? 1 : 0) ^ (z > 0 ? 1 : 0);
      let r: number, g: number, b: number;
      if (dark) {
        // honeycomb in (longitude, latitude) space
        const hu = (ph * 18) / Math.PI, hv = (theta * 18) / Math.PI / 0.866;
        const row = Math.floor(hv);
        const cu = hu + (row % 2) * 0.5;
        const du = Math.abs(cu - Math.floor(cu) - 0.5), dv = Math.abs(hv - row - 0.5);
        const edge = Math.max(du * 1.15 + dv * 0.6, dv * 1.2) > 0.52;
        r = edge ? 38 : 92; g = edge ? 41 : 98; b = edge ? 48 : 108;
      } else {
        const groove = Math.abs(Math.sin(theta * 70)) < 0.12;
        r = groove ? 170 : 206; g = groove ? 175 : 211; b = groove ? 182 : 218;
      }
      if (band < 0.07) { r = 28; g = 31; b = 38; }
      else if (band < 0.085) { r = 120; g = 126; b = 136; }
      let gl = 0;
      if (band < 0.01) gl = 140;
      if (node > 0.978) { r = 25; g = 70; b = 110; gl = 255; }
      else if (node > 0.96) { r = 45; g = 50; b = 60; }
      const o = (j * w + i) * 4;
      bimg.data[o] = r; bimg.data[o + 1] = g; bimg.data[o + 2] = b; bimg.data[o + 3] = 255;
      gimg.data[o] = gl * 0.2; gimg.data[o + 1] = gl * 0.65; gimg.data[o + 2] = gl; gimg.data[o + 3] = 255;
    }
  }
  bctx.putImageData(bimg, 0, 0);
  gctx.putImageData(gimg, 0, 0);
  const map = new THREE.CanvasTexture(base);
  map.colorSpace = THREE.SRGBColorSpace;
  map.anisotropy = 8;
  const emissive = new THREE.CanvasTexture(glow);
  emissive.colorSpace = THREE.SRGBColorSpace;
  return { map, emissive };
}

function createDiscTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const ctx = c.getContext('2d')!;
  const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
  g.addColorStop(0, 'rgba(0,0,0,0.9)');
  g.addColorStop(0.55, 'rgba(0,0,0,0.5)');
  g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 128, 128);
  return new THREE.CanvasTexture(c);
}
