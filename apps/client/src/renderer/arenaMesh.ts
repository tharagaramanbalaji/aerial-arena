import * as THREE from 'three';
import { ARENA_CONFIG, ArenaTheme, BoostPadSnapshot } from '@aerial-arena/shared';
import { ArenaGeometry, buildArenaGeometry } from '@aerial-arena/game-core';
import { THEMES, ThemePalette } from './themes.js';
import { createBoostPadVisuals } from './boostPadVisuals.js';

export interface ArenaVisual {
  root: THREE.Group;
  theme: ArenaTheme;
  palette: ThemePalette;
  sun: THREE.DirectionalLight;
  updatePads(snapshots: BoostPadSnapshot[], dt: number): void;
  triggerGoalExplosion(pos: { x: number; y: number; z: number }, team: 'blue' | 'orange'): void;
  update(dt: number): void;
  destroy(): void;
}

const cfg = ARENA_CONFIG;
/** Rows of the swept profile that form the opaque base band (fillet + lower wall strip). */
const BAND_EXTRA_ROWS = 2;
/** Stands start this far outside the walls: beyond the 8.8 m goal boxes so nothing pokes through. */
const STAND_OFFSET = 11;

/**
 * Builds the visual arena from the SAME procedural geometry used for collision.
 * Only materials, lights and the backdrop differ between themes.
 */
export function createArenaMesh(theme: ArenaTheme = 'coastal_dome'): ArenaVisual {
  const pal = THEMES[theme];
  const geo = buildArenaGeometry(cfg);
  const root = new THREE.Group();
  const disposables: { dispose(): void }[] = [];
  const track = <T extends { dispose(): void }>(d: T): T => {
    disposables.push(d);
    return d;
  };

  // ---------------------------------------------------------------- lighting
  const hemi = new THREE.HemisphereLight(pal.hemiSky, pal.hemiGround, pal.hemiIntensity);
  root.add(hemi);
  const sun = new THREE.DirectionalLight(pal.sunColor, pal.sunIntensity);
  sun.position.set(18, 60, 12);
  sun.target.position.set(0, 0, 0);
  sun.castShadow = true;
  sun.shadow.mapSize.set(4096, 4096);
  sun.shadow.camera.near = 20;
  sun.shadow.camera.far = 120;
  sun.shadow.camera.left = -cfg.halfWidth - 4;
  sun.shadow.camera.right = cfg.halfWidth + 4;
  sun.shadow.camera.top = cfg.halfLength + cfg.goalDepth + 2;
  sun.shadow.camera.bottom = -cfg.halfLength - cfg.goalDepth - 2;
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.02;
  root.add(sun, sun.target);

  // --------------------------------------------------------------- turf
  const fieldTex = track(createFieldTexture(pal, geo));
  const floorShape = new THREE.Shape(geo.floorOutline.map((p) => new THREE.Vector2(p.x, -p.z)));
  const floorGeom = track(new THREE.ShapeGeometry(floorShape));
  floorGeom.rotateX(-Math.PI / 2);
  setPlanarUV(floorGeom);
  const floorMat = track(new THREE.MeshStandardMaterial({ map: fieldTex, roughness: 0.92, metalness: 0 }));
  const floor = new THREE.Mesh(floorGeom, floorMat);
  floor.receiveShadow = true;
  root.add(floor);

  // Goal floors (inside each goal box)
  for (const sign of [-1, 1]) {
    const g = track(new THREE.PlaneGeometry(cfg.goalHalfWidth * 2, cfg.goalDepth));
    g.rotateX(-Math.PI / 2);
    const team = sign < 0 ? pal.blue : pal.orange;
    const m = track(
      new THREE.MeshStandardMaterial({
        color: new THREE.Color(pal.grassB).lerp(new THREE.Color(team), 0.25).multiplyScalar(0.7),
        roughness: 0.9,
      })
    );
    const mesh = new THREE.Mesh(g, m);
    mesh.position.set(0, 0.002, sign * (cfg.halfLength + cfg.goalDepth / 2));
    mesh.receiveShadow = true;
    root.add(mesh);
  }

  // ------------------------------------------------- shell: band + glass
  const shell = geo.shell;
  const bandRow = geo.wallStartRow + BAND_EXTRA_ROWS;
  const bandIdx: number[] = [];
  const glassIdx: number[] = [];
  for (let t = 0; t < shell.indices.length; t += 3) {
    const a = shell.indices[t], b = shell.indices[t + 1], c = shell.indices[t + 2];
    const ring = a < geo.ringVertexCount && b < geo.ringVertexCount && c < geo.ringVertexCount;
    const maxRow = Math.max(shell.profileRow[a], shell.profileRow[b], shell.profileRow[c]);
    (ring && maxRow <= bandRow ? bandIdx : glassIdx).push(a, b, c);
  }
  const makeShellGeom = (idx: number[]) => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(shell.positions, 3));
    g.setAttribute('perimeterU', new THREE.BufferAttribute(shell.perimeterU, 1));
    g.setAttribute('zone', new THREE.BufferAttribute(shell.zone, 1));
    g.setAttribute('profileRow', new THREE.BufferAttribute(shell.profileRow, 1));
    g.setIndex(idx);
    g.computeVertexNormals();
    return track(g);
  };

  const bandMat = track(createBandMaterial(pal, geo.wallStartRow, bandRow));
  const band = new THREE.Mesh(makeShellGeom(bandIdx), bandMat);
  band.receiveShadow = true;
  root.add(band);

  const glassMat = track(createGlassMaterial(pal));
  const glass = new THREE.Mesh(makeShellGeom(glassIdx), glassMat);
  glass.renderOrder = 2;
  root.add(glass);

  // Flat ceiling: a faint hex canopy so the volume reads as enclosed
  const ceilShape = new THREE.Shape(geo.ceilingOutline.map((p) => new THREE.Vector2(p.x, -p.z)));
  const ceilGeom = track(new THREE.ShapeGeometry(ceilShape));
  ceilGeom.rotateX(-Math.PI / 2);
  ceilGeom.translate(0, cfg.height, 0);
  {
    const n = ceilGeom.attributes.position.count;
    ceilGeom.setAttribute('perimeterU', new THREE.BufferAttribute(new Float32Array(n), 1));
    ceilGeom.setAttribute('zone', new THREE.BufferAttribute(new Float32Array(n).fill(4), 1));
    ceilGeom.setAttribute('profileRow', new THREE.BufferAttribute(new Float32Array(n), 1));
  }
  const ceiling = new THREE.Mesh(ceilGeom, glassMat);
  ceiling.renderOrder = 2;
  root.add(ceiling);

  // ------------------------------------------------------------- goals
  const goalLights: THREE.PointLight[] = [];
  const frameMats: THREE.MeshStandardMaterial[] = [];
  for (const sign of [-1, 1] as const) {
    const teamColor = sign < 0 ? pal.blue : pal.orange;
    const frameMat = track(
      new THREE.MeshStandardMaterial({ color: teamColor, emissive: teamColor, emissiveIntensity: 2.2, roughness: 0.4 })
    );
    frameMats.push(frameMat);
    const z = sign * (cfg.halfLength - 0.02);
    const t = 0.22; // frame thickness
    const postGeom = track(new THREE.BoxGeometry(t, cfg.goalHeight + t, 0.18));
    const barGeom = track(new THREE.BoxGeometry(cfg.goalHalfWidth * 2 + t * 2, t, 0.18));
    for (const sx of [-1, 1]) {
      const post = new THREE.Mesh(postGeom, frameMat);
      post.position.set(sx * (cfg.goalHalfWidth + t / 2), (cfg.goalHeight + t) / 2, z);
      root.add(post);
    }
    const bar = new THREE.Mesh(barGeom, frameMat);
    bar.position.set(0, cfg.goalHeight + t / 2, z);
    root.add(bar);
    // Interior glow
    const light = new THREE.PointLight(teamColor, 18, 16, 2);
    light.position.set(0, cfg.goalHeight * 0.6, sign * (cfg.halfLength + cfg.goalDepth * 0.6));
    root.add(light);
    goalLights.push(light);
  }

  // -------------------------------------------------------- boost pads
  const padVisuals = createBoostPadVisuals();
  root.add(padVisuals.root);
  disposables.push({ dispose: padVisuals.destroy });

  // ------------------------------------------------------- stadium + sky
  root.add(createStadium(pal, geo, track));
  root.add(createSky(pal, track));

  // --------------------------------------------------------- behaviour
  let flashTime = 0;
  let flashSign = 1;
  let time = 0;

  const updatePads = (snapshots: BoostPadSnapshot[]) => padVisuals.update(snapshots, 0);

  const triggerGoalExplosion = (pos: { x: number; y: number; z: number }) => {
    flashTime = 1.6;
    flashSign = pos.z < 0 ? 0 : 1;
  };

  const update = (dt: number) => {
    time += dt;
    glassMat.uniforms.uTime.value = time;
    padVisuals.update(null, dt);
    if (flashTime > 0) {
      flashTime = Math.max(0, flashTime - dt);
      const k = flashTime / 1.6;
      goalLights[flashSign].intensity = 18 + 220 * k * k;
      frameMats[flashSign].emissiveIntensity = 2.2 + 10 * k;
      glassMat.uniforms.uFlash.value = k;
      glassMat.uniforms.uFlashSign.value = flashSign === 0 ? -1 : 1;
    }
  };

  const destroy = () => {
    for (const d of disposables) d.dispose();
  };

  return { root, theme, palette: pal, sun, updatePads, triggerGoalExplosion, update, destroy };
}

// ===========================================================================
// Field texture
// ===========================================================================

function createFieldTexture(pal: ThemePalette, geo: ArenaGeometry): THREE.CanvasTexture {
  const W = cfg.halfWidth;
  const L = cfg.halfLength;
  const ppm = 20; // pixels per meter
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(W * 2 * ppm);
  canvas.height = Math.round(L * 2 * ppm);
  const ctx = canvas.getContext('2d')!;
  const px = (x: number) => (x + W) * ppm;
  const pz = (z: number) => (z + L) * ppm;

  // Base + mown stripes (bands across the width, like a real pitch)
  ctx.fillStyle = pal.grassA;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  if (!pal.gridLines) {
    const bands = 20;
    const bandH = canvas.height / bands;
    ctx.fillStyle = pal.grassB;
    for (let i = 0; i < bands; i += 2) ctx.fillRect(0, i * bandH, canvas.width, bandH);
  }

  // Grass speckle
  const rand = mulberry32(1337);
  for (let i = 0; i < 90000 * pal.grassNoise; i++) {
    const light = rand() > 0.5;
    ctx.fillStyle = light ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.07)';
    ctx.fillRect(rand() * canvas.width, rand() * canvas.height, 2 + rand() * 3, 2 + rand() * 4);
  }

  // Team halves: tint growing toward each goal
  const tint = (color: string, fromZ: number, toZ: number) => {
    const g = ctx.createLinearGradient(0, pz(fromZ), 0, pz(toZ));
    g.addColorStop(0, hexWithAlpha(color, 0));
    g.addColorStop(1, hexWithAlpha(color, pal.tintAlpha));
    ctx.fillStyle = g;
    const y0 = Math.min(pz(fromZ), pz(toZ));
    ctx.fillRect(0, y0, canvas.width, Math.abs(pz(toZ) - pz(fromZ)));
  };
  tint(pal.blueTint, 0, -L);
  tint(pal.orangeTint, 0, L);

  if (pal.gridLines) {
    ctx.save();
    ctx.strokeStyle = hexWithAlpha(pal.lineColor, 0.18);
    ctx.lineWidth = 2;
    for (let x = -W; x <= W; x += 4) line(ctx, px(x), 0, px(x), canvas.height);
    for (let z = -L; z <= L; z += 4) line(ctx, 0, pz(z), canvas.width, pz(z));
    ctx.restore();
  }

  // Markings
  ctx.save();
  ctx.strokeStyle = hexWithAlpha(pal.lineColor, pal.lineAlpha);
  ctx.fillStyle = hexWithAlpha(pal.lineColor, pal.lineAlpha);
  ctx.lineWidth = 0.28 * ppm;
  ctx.lineJoin = 'round';
  if (pal.gridLines) {
    ctx.shadowColor = pal.lineColor;
    ctx.shadowBlur = 18;
  }
  // Boundary, inset from where the ramp begins
  ctx.beginPath();
  geo.floorOutline.forEach((p, i) => {
    const f = geo.footprint[i];
    const x = px(p.x - f.nx * 0.7);
    const y = pz(p.z - f.nz * 0.7);
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.closePath();
  ctx.stroke();
  // Halfway line, centre circle and spot
  line(ctx, px(-W), pz(0), px(W), pz(0));
  ctx.beginPath();
  ctx.arc(px(0), pz(0), 10 * ppm, 0, Math.PI * 2);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(px(0), pz(0), 0.45 * ppm, 0, Math.PI * 2);
  ctx.fill();
  // Goal boxes with a "D"
  const boxHalf = cfg.goalHalfWidth + 9;
  const boxDepth = 13;
  for (const s of [-1, 1]) {
    const zl = s * (L - 0.7);
    const zb = s * (L - boxDepth);
    ctx.beginPath();
    ctx.moveTo(px(-boxHalf), pz(zl));
    ctx.lineTo(px(-boxHalf), pz(zb));
    ctx.lineTo(px(boxHalf), pz(zb));
    ctx.lineTo(px(boxHalf), pz(zl));
    ctx.stroke();
    ctx.beginPath();
    if (s > 0) ctx.arc(px(0), pz(zb), 6 * ppm, Math.PI, Math.PI * 2);
    else ctx.arc(px(0), pz(zb), 6 * ppm, 0, Math.PI);
    ctx.stroke();
  }
  ctx.restore();

  // Team-colored goal lines across each mouth
  for (const s of [-1, 1]) {
    ctx.strokeStyle = '#' + new THREE.Color(s < 0 ? pal.blue : pal.orange).getHexString();
    ctx.lineWidth = 0.45 * ppm;
    line(ctx, px(-cfg.goalHalfWidth), pz(s * (L - 0.25)), px(cfg.goalHalfWidth), pz(s * (L - 0.25)));
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.flipY = false;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 16;
  tex.generateMipmaps = true;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  return tex;
}

/** UVs for floor-like meshes straight from world XZ (matches createFieldTexture). */
function setPlanarUV(g: THREE.BufferGeometry) {
  const pos = g.attributes.position;
  const uv = new Float32Array(pos.count * 2);
  for (let i = 0; i < pos.count; i++) {
    uv[i * 2] = (pos.getX(i) + cfg.halfWidth) / (cfg.halfWidth * 2);
    uv[i * 2 + 1] = (pos.getZ(i) + cfg.halfLength) / (cfg.halfLength * 2);
  }
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
}

// ===========================================================================
// Shell materials
// ===========================================================================

/** Opaque floor ramp + lower wall strip with team chevrons. Lit + receives shadows. */
function createBandMaterial(pal: ThemePalette, wallStartRow: number, bandRow: number): THREE.MeshStandardMaterial {
  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.75, metalness: 0.1 });
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uBlue = { value: new THREE.Color(pal.blue) };
    shader.uniforms.uOrange = { value: new THREE.Color(pal.orange) };
    shader.uniforms.uRamp = { value: new THREE.Color(pal.grassB) };
    shader.uniforms.uWallStart = { value: wallStartRow };
    shader.uniforms.uBandRow = { value: bandRow };
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
        attribute float perimeterU; attribute float profileRow;
        varying float vU; varying float vRow; varying vec3 vWPos;`
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        vU = perimeterU; vRow = profileRow; vWPos = (modelMatrix * vec4(position, 1.0)).xyz;`
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
        uniform vec3 uBlue; uniform vec3 uOrange; uniform vec3 uRamp;
        uniform float uWallStart; uniform float uBandRow;
        varying float vU; varying float vRow; varying vec3 vWPos;
        vec3 bandEmissive = vec3(0.0);`
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
        vec3 team = mix(uBlue, uOrange, smoothstep(-2.0, 2.0, vWPos.z));
        if (vRow < uWallStart + 0.01) {
          // curved ramp: dark turf with a faint team tint
          // curved ramp: the turf continues up to the wall (as in RL), lightly team-tinted
          diffuseColor.rgb = mix(uRamp, team * 0.5, 0.08) * (0.92 + 0.08 * step(0.5, fract(vU / 5.12)));
        } else {
          float t = clamp((vRow - uWallStart) / (uBandRow - uWallStart), 0.0, 1.0);
          float dir = vWPos.z < 0.0 ? 1.0 : -1.0;
          float c = fract(vU / 1.6 * dir + abs(t - 0.5) * 0.9);
          float chev = smoothstep(0.0, 0.04, c) * (1.0 - smoothstep(0.28, 0.32, c));
          float edge = 1.0 - smoothstep(0.0, 0.08, abs(t - 0.96));
          vec3 base = vec3(0.05, 0.06, 0.08);
          diffuseColor.rgb = mix(base, team, chev * 0.85);
          bandEmissive = team * (chev * 0.9 + edge * 1.6);
        }`
      )
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
        totalEmissiveRadiance += bandEmissive;`
      );
  };
  return mat;
}

/** Translucent glass walls/ceiling with a hex lattice; goal interiors glow in team color. */
function createGlassMaterial(pal: ThemePalette): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    uniforms: {
      uBlue: { value: new THREE.Color(pal.blue) },
      uOrange: { value: new THREE.Color(pal.orange) },
      uTint: { value: new THREE.Color(pal.wallTint) },
      uAlpha: { value: pal.wallAlpha },
      uHexAlpha: { value: pal.hexAlpha },
      uHalfLength: { value: cfg.halfLength },
      uTime: { value: 0 },
      uFlash: { value: 0 },
      uFlashSign: { value: 1 },
    },
    vertexShader: /* glsl */ `
      attribute float perimeterU; attribute float zone;
      varying float vU; varying float vZone; varying vec3 vWPos; varying vec3 vNormal;
      void main() {
        vU = perimeterU; vZone = zone;
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vWPos = wp.xyz;
        vNormal = normalize(mat3(modelMatrix) * normal);
        gl_Position = projectionMatrix * viewMatrix * wp;
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uBlue; uniform vec3 uOrange; uniform vec3 uTint;
      uniform float uAlpha; uniform float uHexAlpha; uniform float uHalfLength;
      uniform float uTime; uniform float uFlash; uniform float uFlashSign;
      varying float vU; varying float vZone; varying vec3 vWPos; varying vec3 vNormal;

      float hexDist(vec2 p) { p = abs(p); return max(dot(p, normalize(vec2(1.0, 1.7320508))), p.x); }
      // Returns (cell-local offset, distance to cell center: 0 center .. 0.5 edge).
      vec3 hexCell(vec2 uv) {
        vec2 r = vec2(1.0, 1.7320508); vec2 h = r * 0.5;
        vec2 a = mod(uv, r) - h; vec2 b = mod(uv - h, r) - h;
        vec2 gv = dot(a, a) < dot(b, b) ? a : b;
        return vec3(gv, hexDist(gv));
      }
      float hexEdge(vec2 uv) {
        vec2 r = vec2(1.0, 1.7320508); vec2 h = r * 0.5;
        vec2 a = mod(uv, r) - h; vec2 b = mod(uv - h, r) - h;
        vec2 gv = dot(a, a) < dot(b, b) ? a : b;
        return smoothstep(0.43, 0.49, hexDist(gv));
      }
      void main() {
        vec3 team = mix(uBlue, uOrange, smoothstep(-2.0, 2.0, vWPos.z));
        float endF = smoothstep(uHalfLength - 22.0, uHalfLength, abs(vWPos.z));
        vec3 viewDir = normalize(cameraPosition - vWPos);
        float fres = pow(1.0 - abs(dot(normalize(vNormal), viewDir)), 3.0);
        vec3 col; float alpha;
        if (vZone > 2.5 && vZone < 3.5) {
          // goal interior net
          float e = hexEdge(vec2(vWPos.x + vWPos.z, vWPos.y) / 0.55);
          col = team * (1.2 + e * 1.8);
          alpha = 0.28 + e * 0.55;
        } else {
          // Smoked, structured glass (RL-style): dark tinted base that gets more opaque near the
          // floor, honeycomb cells with a bevelled lit rim and a top-lit inner gradient (fake
          // depth), vertical frame seams every 8 m, horizontal rails, and a sheen toward the top.
          float isCeil = step(3.5, vZone) + step(1.5, vZone) * step(vZone, 2.5);
          vec2 huv = vZone > 3.5 ? vWPos.xz / 2.4 : vec2(vU, vWPos.y) / 1.35;
          vec3 cell = hexCell(huv);
          // Rims fade with distance so far walls read as deep smoked glass, not white frost.
          float camDist = length(cameraPosition - vWPos);
          float rim = smoothstep(0.43, 0.48, cell.z) * mix(1.0, 0.25, smoothstep(15.0, 60.0, camDist));
          float bevel = smoothstep(0.30, 0.42, cell.z) * (1.0 - rim);
          float topLit = clamp(0.5 + cell.y * 0.9, 0.0, 1.0);
          float h = clamp(vWPos.y / 20.0, 0.0, 1.0);
          vec3 smoke = mix(vec3(0.020, 0.030, 0.055), team * 0.18, 0.25 + 0.5 * endF);
          col = smoke * (0.75 + 0.5 * topLit);
          col += mix(uTint, team, 0.45 + 0.45 * endF) * (rim * 0.55 + bevel * 0.12 * topLit);
          float seamV = 1.0 - smoothstep(0.0, 0.035, abs(fract(vU / 8.0) - 0.5) * 2.0 - 0.965);
          float rail = (1.0 - smoothstep(0.0, 0.07, abs(vWPos.y - 8.0))) + (1.0 - smoothstep(0.0, 0.07, abs(vWPos.y - 14.5)));
          float frame = (1.0 - isCeil) * max(seamV * step(4.0, vWPos.y), rail);
          col = mix(col, vec3(0.16, 0.18, 0.22) + team * 0.25, frame * 0.85);
          col += vec3(0.04, 0.05, 0.07) * h * (1.0 - isCeil); // sky sheen toward the top
          float base = mix(0.62, 0.36, smoothstep(2.0, 18.0, vWPos.y));
          alpha = mix(base, 0.22, isCeil) * (uAlpha / 0.08 * 0.15 + 0.85);
          alpha += rim * uHexAlpha * 0.45 + frame * 0.4 + fres * 0.15;
          float shimmer = smoothstep(0.0, 1.0, sin(vWPos.y * 0.35 - uTime * 1.2) * 0.5 + 0.5) * endF * 0.05;
          col += team * shimmer;
        }
        float flash = uFlash * step(0.0, vWPos.z * uFlashSign) * smoothstep(10.0, uHalfLength, abs(vWPos.z));
        col += team * flash * 3.0;
        alpha = clamp(alpha + flash * 0.4, 0.0, 0.93);
        gl_FragColor = vec4(col, alpha);
        #include <colorspace_fragment>
      }`,
  });
}

// ===========================================================================
// Stadium + sky
// ===========================================================================

function createStadium(pal: ThemePalette, geo: ArenaGeometry, track: <T extends { dispose(): void }>(d: T) => T): THREE.Group {
  const group = new THREE.Group();
  const fp = geo.footprint;
  const perimeter = fp[fp.length - 1].s;

  // Ring band helper: quads between offset distances / heights around the footprint
  const ring = (d0: number, y0: number, d1: number, y1: number, material: THREE.Material, uRepeat = 1) => {
    const pos: number[] = [];
    const uv: number[] = [];
    const idx: number[] = [];
    const n = fp.length;
    for (let i = 0; i <= n; i++) {
      const p = fp[i % n];
      const u = ((i === n ? perimeter : p.s) / perimeter) * uRepeat;
      pos.push(p.x + p.nx * d0, y0, p.z + p.nz * d0, p.x + p.nx * d1, y1, p.z + p.nz * d1);
      uv.push(u, 0, u, 1);
      if (i < n) {
        const a = i * 2;
        idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
      }
    }
    const g = track(new THREE.BufferGeometry());
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(idx);
    g.computeVertexNormals();
    const mesh = new THREE.Mesh(g, material);
    group.add(mesh);
    return mesh;
  };

  const standMat = track(new THREE.MeshStandardMaterial({ color: pal.standColor, roughness: 0.85, side: THREE.DoubleSide }));
  const crowdTex = track(createCrowdTexture());
  crowdTex.wrapS = THREE.RepeatWrapping;
  const crowdMat = track(
    new THREE.MeshStandardMaterial({
      map: crowdTex,
      emissiveMap: crowdTex,
      emissive: new THREE.Color(1, 1, 1).multiplyScalar(pal.crowdBrightness * 0.6),
      roughness: 1,
      side: THREE.DoubleSide,
    })
  );
  // Ground skirt outside the arena
  ring(0.2, -0.02, STAND_OFFSET, -0.02, standMat);
  // Seating tiers: riser (crowd) + tread
  const tiers = 7;
  for (let k = 0; k < tiers; k++) {
    const d0 = STAND_OFFSET + k * 3.2;
    const y0 = 1.5 + k * 3.6;
    ring(d0, y0, d0 + 0.01, y0 + 3.0, crowdMat, 60);
    ring(d0, y0 + 3.0, d0 + 3.2, y0 + 3.6, standMat);
    ring(d0, y0 - 0.0, d0, y0, standMat);
  }
  // Outer wall behind the top tier and a roof canopy with floodlight strip
  const top = 1.5 + tiers * 3.6;
  const outer = STAND_OFFSET + tiers * 3.2;
  ring(outer, top, outer, top + 10, standMat);
  ring(STAND_OFFSET, 0, STAND_OFFSET, 1.5, standMat);
  const roofMat = track(new THREE.MeshStandardMaterial({ color: pal.roofColor, roughness: 0.7, metalness: 0.3, side: THREE.DoubleSide }));
  ring(outer, top + 10, -1, cfg.height + 8, roofMat);

  // Neon team-colored strips: roof lip and the front edge of the stands
  const blue = new THREE.Color(pal.blue);
  const orange = new THREE.Color(pal.orange);
  const strip = (d: number, y0: number, y1: number, glow: number) => {
    const pos: number[] = [];
    const col: number[] = [];
    const idx: number[] = [];
    const n = fp.length;
    const c = new THREE.Color();
    for (let i = 0; i <= n; i++) {
      const p = fp[i % n];
      const t = THREE.MathUtils.smoothstep(p.z, -6, 6);
      c.copy(blue).lerp(orange, t).multiplyScalar(glow);
      pos.push(p.x + p.nx * d, y0, p.z + p.nz * d, p.x + p.nx * d, y1, p.z + p.nz * d);
      col.push(c.r, c.g, c.b, c.r, c.g, c.b);
      if (i < n) idx.push(i * 2, i * 2 + 2, i * 2 + 1, i * 2 + 1, i * 2 + 2, i * 2 + 3);
    }
    const g = track(new THREE.BufferGeometry());
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    g.setIndex(idx);
    group.add(new THREE.Mesh(g, stripMat));
  };
  const stripMat = track(new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide }));
  strip(-0.95, cfg.height + 7.75, cfg.height + 8.05, 2.6);
  strip(STAND_OFFSET - 0.05, 1.35, 1.55, 2.2);

  // Floodlight banks under the roof lip, each aimed at the pitch
  const housingGeom = track(new THREE.BoxGeometry(2.4, 0.75, 0.55));
  const lensGeom = track(new THREE.PlaneGeometry(2.15, 0.5));
  lensGeom.translate(0, 0, 0.285);
  const housingMat = track(new THREE.MeshStandardMaterial({ color: 0x2a2e36, metalness: 0.75, roughness: 0.35 }));
  const lensMat = track(new THREE.MeshBasicMaterial({ color: new THREE.Color(1, 0.96, 0.88).multiplyScalar(1.2 + pal.floodlightIntensity) }));
  const spacing = 6.5;
  const count = Math.floor(perimeter / spacing);
  const housings = new THREE.InstancedMesh(housingGeom, housingMat, count);
  const lenses = new THREE.InstancedMesh(lensGeom, lensMat, count);
  const dummy = new THREE.Object3D();
  let si = 0;
  for (let k = 0; k < count; k++) {
    const target = k * spacing;
    while (si < fp.length - 1 && fp[si + 1].s < target) si++;
    const p = fp[si];
    dummy.position.set(p.x + p.nx * 0.6, cfg.height + 7.3, p.z + p.nz * 0.6);
    dummy.lookAt(p.x * 0.35, 0, p.z * 0.35);
    dummy.updateMatrix();
    housings.setMatrixAt(k, dummy.matrix);
    lenses.setMatrixAt(k, dummy.matrix);
  }
  group.add(housings, lenses);
  return group;
}

function createSky(pal: ThemePalette, track: <T extends { dispose(): void }>(d: T) => T): THREE.Group {
  const group = new THREE.Group();
  const skyGeom = track(new THREE.SphereGeometry(700, 48, 24));
  const skyMat = track(
    new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      uniforms: {
        uTop: { value: new THREE.Color(pal.skyTop) },
        uHorizon: { value: new THREE.Color(pal.skyHorizon) },
        uBottom: { value: new THREE.Color(pal.skyBottom) },
      },
      vertexShader: `varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
      fragmentShader: `uniform vec3 uTop; uniform vec3 uHorizon; uniform vec3 uBottom; varying vec3 vDir;
        void main(){ float h = vDir.y; vec3 c = h > 0.0 ? mix(uHorizon, uTop, pow(smoothstep(0.0, 0.6, h), 0.7)) : mix(uHorizon, uBottom, smoothstep(0.0, 0.2, -h));
        gl_FragColor = vec4(c, 1.0);
        #include <colorspace_fragment>
        }`,
    })
  );
  group.add(new THREE.Mesh(skyGeom, skyMat));
  if (pal.stars) {
    const rand = mulberry32(7);
    const pts: number[] = [];
    for (let i = 0; i < 1600; i++) {
      const th = rand() * Math.PI * 2;
      const y = 0.08 + rand() * 0.92;
      const r = Math.sqrt(1 - y * y);
      pts.push(Math.cos(th) * r * 650, y * 650, Math.sin(th) * r * 650);
    }
    const g = track(new THREE.BufferGeometry());
    g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    const m = track(new THREE.PointsMaterial({ color: 0xffffff, size: 1.6, sizeAttenuation: false, transparent: true, opacity: 0.8 }));
    group.add(new THREE.Points(g, m));
  }
  return group;
}

function createCrowdTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 64;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#1b1d24';
  ctx.fillRect(0, 0, c.width, c.height);
  const rand = mulberry32(99);
  const shirts = ['#2f6bff', '#ff7a1a', '#ffffff', '#e8e8e8', '#ffd23a', '#3fbf6f', '#ff4a6a', '#5bd6ff', '#9b6bff'];
  for (let row = 0; row < 4; row++) {
    for (let x = 0; x < c.width; x += 6) {
      const y = 6 + row * 15 + (rand() - 0.5) * 3;
      ctx.fillStyle = shirts[Math.floor(rand() * shirts.length)];
      ctx.fillRect(x + rand() * 2, y + 4, 4, 7); // body
      ctx.fillStyle = '#d9a982';
      ctx.fillRect(x + 1 + rand(), y, 3, 3); // head
    }
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export function createGlowTexture(color: string): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const ctx = c.getContext('2d')!;
  const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
  g.addColorStop(0, color);
  g.addColorStop(0.25, color.replace(/,\s*[\d.]+\)$/, ',0.55)'));
  g.addColorStop(1, color.replace(/,\s*[\d.]+\)$/, ',0)'));
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 128, 128);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// ===========================================================================
// helpers
// ===========================================================================

function line(ctx: CanvasRenderingContext2D, x0: number, y0: number, x1: number, y1: number) {
  ctx.beginPath();
  ctx.moveTo(x0, y0);
  ctx.lineTo(x1, y1);
  ctx.stroke();
}

/** '#rrggbb' -> canvas rgba() string (sRGB, no color-management conversion). */
function hexWithAlpha(hex: string, a: number): string {
  const n = parseInt(hex.replace('#', ''), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
