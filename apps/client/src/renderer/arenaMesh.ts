import * as THREE from 'three';
import {
  ARENA_CONFIG,
  ArenaConfig,
  ArenaTheme,
  BOOST_PADS,
  BoostPadSnapshot,
} from '@aerial-arena/shared';

export interface ArenaVisual {
  root: THREE.Group;
  theme: ArenaTheme;
  updatePads(snapshots: BoostPadSnapshot[], dt: number): void;
  triggerGoalExplosion(pos: { x: number; y: number; z: number }, team: 'blue' | 'orange'): void;
  update(dt: number): void;
  destroy(): void;
}

export function createArenaMesh(
  theme: ArenaTheme = 'foundry',
  config: ArenaConfig = ARENA_CONFIG
): ArenaVisual {
  const root = new THREE.Group();

  const { length, width, height, goalWidth, goalHeight, goalDepth, cornerBevel } = config;
  const halfL = length / 2;
  const halfW = width / 2;
  const goalHalfW = goalWidth / 2;

  // Theme palettes
  interface ThemePalette {
    floorColor: number;
    lineColor: number;
    wallColor: number;
    trussColor: number;
    goalBlueColor: number;
    goalOrangeColor: number;
    ambientColor: number;
    ambientIntensity: number;
    directionalColor: number;
    directionalIntensity: number;
    fogColor: number;
  }

  const palettes: Record<ArenaTheme, ThemePalette> = {
    foundry: {
      floorColor: 0x1e293b,     // Dark charcoal steel
      lineColor: 0x64748b,      // Muted steel lines
      wallColor: 0x0f172a,      // Deep steel wall panels
      trussColor: 0xd97706,     // Warm industrial amber ribs
      goalBlueColor: 0x2563eb,
      goalOrangeColor: 0xea580c,
      ambientColor: 0xfef08a,
      ambientIntensity: 0.6,
      directionalColor: 0xffedd5,
      directionalIntensity: 1.2,
      fogColor: 0x0f172a,
    },
    neon_grid: {
      floorColor: 0x090d16,     // Very dark synthwave blue
      lineColor: 0x06b6d4,      // Bright cyan grid
      wallColor: 0x030712,      // Pitch black border
      trussColor: 0xd946ef,     // Magenta neon ribs
      goalBlueColor: 0x00f0ff,
      goalOrangeColor: 0xff0055,
      ambientColor: 0xa855f7,
      ambientIntensity: 0.8,
      directionalColor: 0x38bdf8,
      directionalIntensity: 1.0,
      fogColor: 0x090d16,
    },
    coastal_dome: {
      floorColor: 0x15803d,     // Rich green athletic turf
      lineColor: 0xffffff,      // Crisp white soccer lines
      wallColor: 0x38bdf8,      // Ocean glass panels
      trussColor: 0xf1f5f9,     // Clean white architectural dome
      goalBlueColor: 0x1d4ed8,
      goalOrangeColor: 0xc2410c,
      ambientColor: 0xbae6fd,
      ambientIntensity: 0.9,
      directionalColor: 0xffffff,
      directionalIntensity: 1.4,
      fogColor: 0x7dd3fc,
    },
  };

  const pal = palettes[theme];

  // 1. Lighting Setup
  const ambientLight = new THREE.AmbientLight(pal.ambientColor, pal.ambientIntensity);
  root.add(ambientLight);

  const mainLight = new THREE.DirectionalLight(pal.directionalColor, pal.directionalIntensity);
  mainLight.position.set(20, 35, 20);
  mainLight.castShadow = true;
  mainLight.shadow.mapSize.width = 2048;
  mainLight.shadow.mapSize.height = 2048;
  mainLight.shadow.camera.near = 10;
  mainLight.shadow.camera.far = 100;
  mainLight.shadow.camera.left = -halfW - 10;
  mainLight.shadow.camera.right = halfW + 10;
  mainLight.shadow.camera.top = halfL + 10;
  mainLight.shadow.camera.bottom = -halfL - 10;
  root.add(mainLight);

  const fillLight = new THREE.DirectionalLight(0xffffff, 0.4);
  fillLight.position.set(-20, 25, -20);
  root.add(fillLight);

  // 2. Playable Floor
  const floorGeom = new THREE.PlaneGeometry(width, length);
  floorGeom.rotateX(-Math.PI / 2);
  const floorMat = new THREE.MeshStandardMaterial({
    color: pal.floorColor,
    roughness: 0.8,
    metalness: 0.1,
  });
  const floorMesh = new THREE.Mesh(floorGeom, floorMat);
  floorMesh.receiveShadow = true;
  root.add(floorMesh);

  // 3. Field Markings (Center circle, midline, penalty boxes)
  const markingsGroup = new THREE.Group();
  markingsGroup.position.y = 0.02;

  const lineMat = new THREE.MeshBasicMaterial({ color: pal.lineColor, side: THREE.DoubleSide });

  // Center Line
  const centerLineGeom = new THREE.PlaneGeometry(width, 0.4);
  centerLineGeom.rotateX(-Math.PI / 2);
  const centerLine = new THREE.Mesh(centerLineGeom, lineMat);
  markingsGroup.add(centerLine);

  // Center Circle
  const circleGeom = new THREE.RingGeometry(8.8, 9.2, 48);
  circleGeom.rotateX(-Math.PI / 2);
  const circleMesh = new THREE.Mesh(circleGeom, lineMat);
  markingsGroup.add(circleMesh);

  // Perimeter boundary lines
  const boundSideGeom = new THREE.PlaneGeometry(0.4, length);
  boundSideGeom.rotateX(-Math.PI / 2);
  const leftBound = new THREE.Mesh(boundSideGeom, lineMat);
  leftBound.position.x = -halfW + 0.3;
  markingsGroup.add(leftBound);
  const rightBound = new THREE.Mesh(boundSideGeom, lineMat);
  rightBound.position.x = halfW - 0.3;
  markingsGroup.add(rightBound);

  root.add(markingsGroup);

  // 4. Stadium Walls & Framed Goals
  const wallMat = new THREE.MeshStandardMaterial({
    color: pal.wallColor,
    metalness: 0.4,
    roughness: 0.6,
  });

  const trussMat = new THREE.MeshStandardMaterial({
    color: pal.trussColor,
    metalness: 0.7,
    roughness: 0.3,
  });

  // Side Walls
  const sideWallGeom = new THREE.BoxGeometry(0.8, height, length);
  const leftWall = new THREE.Mesh(sideWallGeom, wallMat);
  leftWall.position.set(-halfW - 0.4, height / 2, 0);
  root.add(leftWall);

  const rightWall = new THREE.Mesh(sideWallGeom, wallMat);
  rightWall.position.set(halfW + 0.4, height / 2, 0);
  root.add(rightWall);

  // Ceiling
  const ceilingGeom = new THREE.PlaneGeometry(width, length);
  ceilingGeom.rotateX(Math.PI / 2);
  const ceilingMat = new THREE.MeshStandardMaterial({
    color: pal.wallColor,
    roughness: 0.9,
    metalness: 0.2,
  });
  const ceilingMesh = new THREE.Mesh(ceilingGeom, ceilingMat);
  ceilingMesh.position.y = height;
  root.add(ceilingMesh);

  // Architectural Trusses / Ribs along arena
  for (let z = -halfL + 12; z <= halfL - 12; z += 16) {
    const archGeom = new THREE.BoxGeometry(width + 2, 1.0, 1.0);
    const arch = new THREE.Mesh(archGeom, trussMat);
    arch.position.set(0, height - 0.5, z);
    root.add(arch);
  }

  // Goals Setup (Blue at -Z, Orange at +Z)
  const buildGoalVisual = (sign: number, goalColor: number) => {
    const goalGroup = new THREE.Group();
    const zBase = sign * halfL;
    const postMat = new THREE.MeshStandardMaterial({ color: 0xf8fafc, metalness: 0.8, roughness: 0.2 });
    const netMat = new THREE.MeshBasicMaterial({
      color: goalColor,
      wireframe: true,
      transparent: true,
      opacity: 0.6,
    });

    // Left Post
    const postGeom = new THREE.CylinderGeometry(0.35, 0.35, goalHeight, 16);
    const leftPost = new THREE.Mesh(postGeom, postMat);
    leftPost.position.set(-goalHalfW, goalHeight / 2, zBase);
    goalGroup.add(leftPost);

    // Right Post
    const rightPost = new THREE.Mesh(postGeom, postMat);
    rightPost.position.set(goalHalfW, goalHeight / 2, zBase);
    goalGroup.add(rightPost);

    // Crossbar
    const crossbarGeom = new THREE.CylinderGeometry(0.35, 0.35, goalWidth, 16);
    crossbarGeom.rotateZ(Math.PI / 2);
    const crossbar = new THREE.Mesh(crossbarGeom, postMat);
    crossbar.position.set(0, goalHeight, zBase);
    goalGroup.add(crossbar);

    // Goal Tunnel Back Netting
    const netBackGeom = new THREE.PlaneGeometry(goalWidth, goalHeight);
    if (sign < 0) netBackGeom.rotateY(Math.PI);
    const netBack = new THREE.Mesh(netBackGeom, netMat);
    netBack.position.set(0, goalHeight / 2, sign * (halfL + goalDepth));
    goalGroup.add(netBack);

    // Goal Tunnel Ceiling Netting
    const netTopGeom = new THREE.PlaneGeometry(goalWidth, goalDepth);
    netTopGeom.rotateX(Math.PI / 2);
    const netTop = new THREE.Mesh(netTopGeom, netMat);
    netTop.position.set(0, goalHeight, sign * (halfL + goalDepth / 2));
    goalGroup.add(netTop);

    // Glowing Goal Frame Light
    const goalLight = new THREE.PointLight(goalColor, 2.0, 25);
    goalLight.position.set(0, goalHeight * 0.8, zBase + sign * 2);
    goalGroup.add(goalLight);

    root.add(goalGroup);
  };

  buildGoalVisual(-1, pal.goalBlueColor);  // Blue Goal
  buildGoalVisual(1,  pal.goalOrangeColor); // Orange Goal

  // 5. Boost Pad Visuals
  interface PadVisualItem {
    id: number;
    type: 'small' | 'big';
    group: THREE.Group;
    rotor?: THREE.Mesh;
    light?: THREE.PointLight;
    activeMat: THREE.Material;
    dimMat: THREE.Material;
  }

  const padVisuals: PadVisualItem[] = [];

  const smallPadGeom = new THREE.CylinderGeometry(1.2, 1.4, 0.1, 24);
  const bigPedestalGeom = new THREE.CylinderGeometry(2.2, 2.5, 0.2, 6);
  const bigOrbGeom = new THREE.OctahedronGeometry(1.0, 1);

  const activePadMat = new THREE.MeshStandardMaterial({
    color: 0xfbbf24, // Glowing gold
    emissive: 0xd97706,
    emissiveIntensity: 0.6,
    roughness: 0.3,
  });

  const dimPadMat = new THREE.MeshStandardMaterial({
    color: 0x334155,
    roughness: 0.8,
  });

  for (const def of BOOST_PADS) {
    const padGroup = new THREE.Group();
    padGroup.position.set(def.x, 0, def.z);

    if (def.type === 'big') {
      // Big Pad Pedestal
      const pedestal = new THREE.Mesh(bigPedestalGeom, activePadMat);
      pedestal.position.y = 0.1;
      padGroup.add(pedestal);

      // Floating spinning energy orb
      const orb = new THREE.Mesh(bigOrbGeom, activePadMat);
      orb.position.y = 1.6;
      padGroup.add(orb);

      const light = new THREE.PointLight(0xf59e0b, 1.5, 8);
      light.position.y = 1.6;
      padGroup.add(light);

      root.add(padGroup);
      padVisuals.push({
        id: def.id,
        type: 'big',
        group: padGroup,
        rotor: orb,
        light,
        activeMat: activePadMat,
        dimMat: dimPadMat,
      });
    } else {
      // Small Floor Pad
      const padMesh = new THREE.Mesh(smallPadGeom, activePadMat);
      padMesh.position.y = 0.05;
      padGroup.add(padMesh);

      root.add(padGroup);
      padVisuals.push({
        id: def.id,
        type: 'small',
        group: padGroup,
        rotor: padMesh,
        activeMat: activePadMat,
        dimMat: dimPadMat,
      });
    }
  }

  // 6. Goal Explosion Particle System
  const particlesCount = 200;
  const particleGeom = new THREE.BufferGeometry();
  const particlePositions = new Float32Array(particlesCount * 3);
  const particleVelocities = new Float32Array(particlesCount * 3);
  particleGeom.setAttribute('position', new THREE.BufferAttribute(particlePositions, 3));

  const particleMat = new THREE.PointsMaterial({
    size: 0.6,
    color: 0xffedd5,
    transparent: true,
    opacity: 0,
  });

  const particleSystem = new THREE.Points(particleGeom, particleMat);
  root.add(particleSystem);
  let explosionLife = 0;

  const triggerGoalExplosion = (pos: { x: number; y: number; z: number }, team: 'blue' | 'orange') => {
    explosionLife = 1.5;
    particleMat.opacity = 1.0;
    particleMat.color.setHex(team === 'blue' ? 0x38bdf8 : 0xf97316);

    for (let i = 0; i < particlesCount; i++) {
      const idx = i * 3;
      particlePositions[idx] = pos.x;
      particlePositions[idx + 1] = pos.y;
      particlePositions[idx + 2] = pos.z;

      // Spherical burst
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.random() * Math.PI;
      const speed = 15 + Math.random() * 25;

      particleVelocities[idx] = Math.sin(phi) * Math.cos(theta) * speed;
      particleVelocities[idx + 1] = Math.cos(phi) * speed + 5;
      particleVelocities[idx + 2] = Math.sin(phi) * Math.sin(theta) * speed;
    }
    particleGeom.attributes.position.needsUpdate = true;
  };

  let orbTime = 0;

  const updatePads = (snapshots: BoostPadSnapshot[]) => {
    for (const snap of snapshots) {
      const visual = padVisuals.find((p) => p.id === snap.id);
      if (!visual) continue;

      if (visual.type === 'big') {
        const pedestal = visual.group.children[0] as THREE.Mesh;
        const orb = visual.rotor as THREE.Mesh;
        pedestal.material = snap.active ? visual.activeMat : visual.dimMat;
        orb.material = snap.active ? visual.activeMat : visual.dimMat;
        if (visual.light) visual.light.intensity = snap.active ? 1.5 : 0.1;
      } else {
        const mesh = visual.rotor as THREE.Mesh;
        mesh.material = snap.active ? visual.activeMat : visual.dimMat;
      }
    }
  };

  const update = (dt: number) => {
    orbTime += dt * 2;
    for (const visual of padVisuals) {
      if (visual.type === 'big' && visual.rotor) {
        visual.rotor.rotation.y = orbTime;
        visual.rotor.position.y = 1.6 + Math.sin(orbTime * 1.5) * 0.15;
      }
    }

    // Update explosion particles
    if (explosionLife > 0) {
      explosionLife -= dt;
      particleMat.opacity = Math.max(0, explosionLife / 1.5);
      for (let i = 0; i < particlesCount; i++) {
        const idx = i * 3;
        particlePositions[idx] += particleVelocities[idx] * dt;
        particlePositions[idx + 1] += particleVelocities[idx + 1] * dt;
        particlePositions[idx + 2] += particleVelocities[idx + 2] * dt;
        particleVelocities[idx + 1] -= 20 * dt; // Gravity
      }
      particleGeom.attributes.position.needsUpdate = true;
    }
  };

  const destroy = () => {
    root.traverse((child) => {
      if (child instanceof THREE.Mesh) {
        child.geometry.dispose();
      }
    });
  };

  return {
    root,
    theme,
    updatePads,
    triggerGoalExplosion,
    update,
    destroy,
  };
}
